/**
 * Unit tests for the lazy OAuth2 auth behaviour introduced in v0.4.8.
 *
 * Core contract:
 *   - initialize() NEVER opens a browser; it only does a fast
 *     validate/refresh of any existing tokens.
 *   - When no valid tokens are present, initialize() skips the API
 *     connection test and permission discovery (both require a valid token).
 *   - When valid tokens ARE present, initialize() runs the API test and
 *     permission discovery as before.
 *   - The CallToolRequestSchema handler calls ensureOAuth2Tokens() before
 *     executing any tool when auth type is OAuth2, so the browser flow is
 *     triggered on the first tool call rather than during startup.
 */

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

// Mock TokenPersistence so no filesystem / keychain access occurs
jest.mock('../../../src/auth/token-persistence.js', () => ({
  TokenPersistence: jest.fn().mockImplementation(() => ({
    load: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../../../src/core/registry.js', () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    size: jest.fn().mockReturnValue(0),
    listTools: jest.fn().mockReturnValue([]),
    getTool: jest.fn(),
  })),
}));

jest.mock('../../../src/core/protocol.js', () => ({
  MCPProtocolHandler: jest.fn().mockImplementation(() => ({
    invokeTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
  })),
}));

jest.mock('../../../src/auth/permission-discovery.js', () => ({
  PermissionDiscoveryService: jest.fn().mockImplementation(() => ({
    discoverUserPermissions: jest.fn().mockResolvedValue({
      accessLevel: 'read',
      isReadOnly: true,
      permissions: new Set(['notes:read']),
    }),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ProductboardMCPServer, ServerDependencies } from '../../../src/core/server.js';
import { AuthenticationType } from '../../../src/auth/types.js';
import type { Config } from '../../../src/utils/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOAuth2Dependencies(tokenCache: Record<string, unknown> = {}): ServerDependencies {
  const mockMCPServer = {
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    setRequestHandler: jest.fn(),
  };
  const mockTransport = {};

  const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  (Server as jest.Mock).mockImplementation(() => mockMCPServer);
  (StdioServerTransport as jest.Mock).mockImplementation(() => mockTransport);

  const authManager: any = {
    getTokenCache: jest.fn().mockReturnValue(tokenCache),
    validateCredentials: jest.fn().mockResolvedValue(!!tokenCache.accessToken),
    loadTokenCache: jest.fn(),
    isTokenExpired: jest.fn().mockReturnValue(false),
    getAuthHeaders: jest.fn().mockReturnValue({}),
  };

  return {
    config: {
      logLevel: 'error',
      logPretty: false,
      nodeEnv: 'production',
      auth: {
        type: AuthenticationType.OAUTH2,
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        fullAccess: false,
      },
      api: {
        baseUrl: 'https://api.productboard.com/v2',
        timeout: 5000,
        retryAttempts: 0,
        retryDelay: 0,
      },
      rateLimit: { global: 100, windowMs: 60000 },
      cache: { enabled: false, ttl: 300, maxSize: 100 },
      resources: { enabled: false, refreshInterval: 300_000 },
      prompts: { enabled: false, templatesPath: './prompts' },
    } as unknown as Config,
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
    } as any,
    authManager,
    apiClient: {
      testConnection: jest.fn().mockResolvedValue(true),
    } as any,
    toolRegistry: {
      registerTool: jest.fn(),
      size: jest.fn().mockReturnValue(0),
      listTools: jest.fn().mockReturnValue([]),
      getTool: jest.fn(),
    } as any,
    rateLimiter: {} as any,
    cache: {
      get: jest.fn().mockReturnValue(null),
      set: jest.fn(),
      getCacheKey: jest.fn().mockReturnValue('key'),
      shouldCache: jest.fn().mockReturnValue(false),
    } as any,
    protocolHandler: {
      invokeTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    } as any,
    permissionDiscovery: {
      discoverUserPermissions: jest.fn().mockResolvedValue({
        accessLevel: 'read',
        isReadOnly: true,
        permissions: new Set(['notes:read']),
      }),
    } as any,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initialize() — OAuth2 lazy auth', () => {
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.NODE_ENV;
  });
  afterAll(() => {
    if (originalEnv !== undefined) process.env.NODE_ENV = originalEnv;
    else delete process.env.NODE_ENV;
  });
  afterEach(() => jest.clearAllMocks());

  describe('when no OAuth2 tokens are present', () => {
    beforeEach(() => {
      // Force non-test mode so the auth / API / permissions code paths run
      delete process.env.NODE_ENV;
    });
    afterEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('completes initialize() without calling the API connection test', async () => {
      const deps = makeOAuth2Dependencies({}); // no tokens
      const server = new ProductboardMCPServer(deps);

      await server.initialize();

      expect(deps.apiClient.testConnection).not.toHaveBeenCalled();
    });

    it('completes initialize() without running permission discovery', async () => {
      const deps = makeOAuth2Dependencies({}); // no tokens
      const server = new ProductboardMCPServer(deps);

      await server.initialize();

      expect(deps.permissionDiscovery.discoverUserPermissions).not.toHaveBeenCalled();
    });

    it('completes initialize() successfully (does not throw)', async () => {
      const deps = makeOAuth2Dependencies({});
      const server = new ProductboardMCPServer(deps);

      await expect(server.initialize()).resolves.toBeUndefined();
    });
  });

  describe('when valid OAuth2 tokens are present', () => {
    beforeEach(() => {
      delete process.env.NODE_ENV;
    });
    afterEach(() => {
      process.env.NODE_ENV = 'test';
    });

    it('does NOT run the API connection test (uses token-info endpoint instead)', async () => {
      // For OAuth2 we skip testConnection() — it calls GET /entities which
      // requires entities:read scope and always 403s for contributor-role
      // (notes-only) tokens. Permission discovery via /oauth2/token/info is
      // scope-agnostic and serves as the connectivity check instead.
      const deps = makeOAuth2Dependencies({ accessToken: 'valid-token' });
      const server = new ProductboardMCPServer(deps);

      await server.initialize();

      expect(deps.apiClient.testConnection).not.toHaveBeenCalled();
    });

    it('runs permission discovery', async () => {
      const deps = makeOAuth2Dependencies({ accessToken: 'valid-token' });
      const server = new ProductboardMCPServer(deps);

      await server.initialize();

      expect(deps.permissionDiscovery.discoverUserPermissions).toHaveBeenCalledTimes(1);
    });
  });
});

describe('CallToolRequestSchema handler — OAuth2 pre-call auth check', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'; // init runs in test mode (fast, no network)
    jest.clearAllMocks();
  });

  it('calls ensureOAuth2Tokens before executing a tool when auth type is OAuth2', async () => {
    const deps = makeOAuth2Dependencies({ accessToken: 'valid-token' });
    const server = new ProductboardMCPServer(deps);

    // Replace the private method with a spy so we can verify it is called
    const ensureSpy = jest
      .spyOn(server as any, 'ensureOAuth2Tokens')
      .mockResolvedValue(undefined);

    await server.initialize();

    const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
    const mockMCPServer = (Server as jest.Mock).mock.results.slice(-1)[0].value;

    const toolCallHandler = mockMCPServer.setRequestHandler.mock.calls.find(
      (call: any[]) => call[0] === 'CallToolRequestSchema',
    )?.[1];
    expect(toolCallHandler).toBeDefined();

    await toolCallHandler({
      params: { name: 'pb_note_list', arguments: {} },
    });

    expect(ensureSpy).toHaveBeenCalledTimes(1);
    expect(ensureSpy).toHaveBeenCalledWith(
      deps.authManager,
      deps.config.auth,
      deps.logger,
    );
  });

  it('does NOT call ensureOAuth2Tokens when auth type is bearer', async () => {
    // Override to bearer auth
    const deps = makeOAuth2Dependencies({ accessToken: 'valid-token' });
    (deps.config.auth as any).type = AuthenticationType.BEARER_TOKEN;

    const server = new ProductboardMCPServer(deps);
    const ensureSpy = jest.spyOn(server as any, 'ensureOAuth2Tokens');

    await server.initialize();

    const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
    const mockMCPServer = (Server as jest.Mock).mock.results.slice(-1)[0].value;

    const toolCallHandler = mockMCPServer.setRequestHandler.mock.calls.find(
      (call: any[]) => call[0] === 'CallToolRequestSchema',
    )?.[1];

    await toolCallHandler({
      params: { name: 'pb_feature_list', arguments: {} },
    });

    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('surfaces an auth failure as a tool execution error rather than crashing the process', async () => {
    const deps = makeOAuth2Dependencies({});
    const server = new ProductboardMCPServer(deps);

    jest
      .spyOn(server as any, 'ensureOAuth2Tokens')
      .mockRejectedValue(new Error('OAuth token exchange failed'));

    await server.initialize();

    const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
    const mockMCPServer = (Server as jest.Mock).mock.results.slice(-1)[0].value;

    const toolCallHandler = mockMCPServer.setRequestHandler.mock.calls.find(
      (call: any[]) => call[0] === 'CallToolRequestSchema',
    )?.[1];

    // Should reject (surfaced as tool error) rather than crash the process
    await expect(
      toolCallHandler({ params: { name: 'pb_note_list', arguments: {} } }),
    ).rejects.toThrow('OAuth token exchange failed');

    // The process should still be alive (no process.exit called)
    expect(process.exitCode).not.toBe(1);
  });
});
