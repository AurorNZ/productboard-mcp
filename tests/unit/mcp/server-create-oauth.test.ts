/**
 * Unit tests for ProductboardMCPServer.create() — OAuth2 scope-mismatch detection.
 *
 * These tests exercise the logic added in v0.4.6: when the persisted token cache
 * contains a `scope` field that differs from the scope implied by the current
 * PRODUCTBOARD_FULL_ACCESS setting, the server must clear the stale tokens and
 * force a fresh browser authorization on the next `initialize()` call.
 *
 * All heavy collaborators (AuthenticationManager, Logger, API client, etc.) are
 * mocked at the module level so that `create()` can run without any network or
 * filesystem access.
 */

import { AuthenticationType } from '../../../src/auth/types.js';
import type { Config } from '../../../src/utils/types.js';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Jest before any import)
// ---------------------------------------------------------------------------

jest.mock('@modelcontextprotocol/sdk/server/index.js');
jest.mock('@modelcontextprotocol/sdk/server/stdio.js');
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

// Token persistence — each test configures its own mock instance via
// mockImplementation() in beforeEach or the individual test body.
jest.mock('../../../src/auth/token-persistence.js');

// Auth, API, middleware, and core collaborators — provide minimal stubs so
// create() can reach the end of its factory without error.
jest.mock('../../../src/auth/manager.js', () => ({
  AuthenticationManager: jest.fn().mockImplementation(() => ({
    setCredentials: jest.fn(),
    loadTokenCache: jest.fn(),
    getTokenCache: jest.fn().mockReturnValue({}),
    getOAuth2AuthorizationUrl: jest.fn().mockReturnValue('http://example.com/auth'),
  })),
}));

jest.mock('../../../src/utils/logger.js', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  })),
}));

jest.mock('../../../src/api/client.js', () => ({
  ProductboardAPIClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/middleware/rateLimiter.js', () => ({
  RateLimiter: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/middleware/cache.js', () => ({
  CacheModule: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/core/registry.js', () => ({
  ToolRegistry: jest.fn().mockImplementation(() => ({ size: jest.fn().mockReturnValue(0) })),
}));

jest.mock('../../../src/core/protocol.js', () => ({
  MCPProtocolHandler: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../../src/auth/permission-discovery.js', () => ({
  PermissionDiscoveryService: jest.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ProductboardMCPServer } from '../../../src/core/server.js';
import { TokenPersistence } from '../../../src/auth/token-persistence.js';

const MockTokenPersistence = TokenPersistence as jest.MockedClass<typeof TokenPersistence>;

// ---------------------------------------------------------------------------
// Shared config fixture
// ---------------------------------------------------------------------------

const NARROW_SCOPE = 'notes:read notes:write';
const FULL_SCOPE =
  'entities:read entities:write entities:delete notes:read notes:write notes:delete';

function makeOAuth2Config(fullAccess: boolean): Config {
  return {
    logLevel: 'error',
    logPretty: false,
    nodeEnv: 'test',
    auth: {
      type: AuthenticationType.OAUTH2,
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      fullAccess,
    },
    api: {
      baseUrl: 'https://api.productboard.com/v2',
      timeout: 5000,
      retryAttempts: 3,
      retryDelay: 1000,
    },
    rateLimit: { global: 100, windowMs: 60000 },
    cache: { enabled: false, ttl: 300, maxSize: 100 },
    resources: { enabled: false, refreshInterval: 300_000 },
    prompts: { enabled: false, templatesPath: './prompts' },
  } as unknown as Config;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductboardMCPServer.create() — OAuth2 scope-mismatch detection', () => {
  let mockClear: jest.Mock;
  let mockLoad: jest.Mock;

  function setupPersistence(persistedData: object | null) {
    mockClear = jest.fn().mockResolvedValue(undefined);
    mockLoad = jest.fn().mockResolvedValue(persistedData);
    MockTokenPersistence.mockImplementation(() => ({
      load: mockLoad,
      save: jest.fn().mockResolvedValue(undefined),
      clear: mockClear,
    }) as unknown as TokenPersistence);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Scope matches — no action required
  // -------------------------------------------------------------------------

  it('keeps persisted tokens when stored scope matches the expected narrow scope', async () => {
    setupPersistence({
      cache: { accessToken: 'at', refreshToken: 'rt' },
      scope: NARROW_SCOPE,
    });

    await ProductboardMCPServer.create(makeOAuth2Config(false /* fullAccess */));

    expect(mockClear).not.toHaveBeenCalled();
  });

  it('keeps persisted tokens when stored scope matches the expected full scope', async () => {
    setupPersistence({
      cache: { accessToken: 'at', refreshToken: 'rt' },
      scope: FULL_SCOPE,
    });

    await ProductboardMCPServer.create(makeOAuth2Config(true /* fullAccess */));

    expect(mockClear).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Scope mismatch — tokens must be cleared
  // -------------------------------------------------------------------------

  it('clears tokens when full-access tokens are loaded but fullAccess is now disabled', async () => {
    // Stored when PRODUCTBOARD_FULL_ACCESS=true; user has since unchecked it.
    setupPersistence({
      cache: { accessToken: 'at', refreshToken: 'rt' },
      scope: FULL_SCOPE,
    });

    await ProductboardMCPServer.create(makeOAuth2Config(false /* fullAccess now off */));

    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('clears tokens when narrow-scope tokens are loaded but fullAccess is now enabled', async () => {
    // Stored when PRODUCTBOARD_FULL_ACCESS=false; user has since checked it.
    setupPersistence({
      cache: { accessToken: 'at', refreshToken: 'rt' },
      scope: NARROW_SCOPE,
    });

    await ProductboardMCPServer.create(makeOAuth2Config(true /* fullAccess now on */));

    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Backward compatibility — old tokens without a scope field
  // -------------------------------------------------------------------------

  it('does not clear tokens when the persisted data has no scope field (pre-v0.4.6 tokens)', async () => {
    // Tokens written by v0.4.5 and earlier do not include a scope field.
    setupPersistence({
      cache: { accessToken: 'at', refreshToken: 'rt' },
      // no `scope` key at all
    });

    await ProductboardMCPServer.create(makeOAuth2Config(false));

    expect(mockClear).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // No persisted tokens
  // -------------------------------------------------------------------------

  it('handles null persisted data gracefully (first-time auth)', async () => {
    setupPersistence(null);

    const server = await ProductboardMCPServer.create(makeOAuth2Config(false));

    expect(server).toBeInstanceOf(ProductboardMCPServer);
    expect(mockClear).not.toHaveBeenCalled();
  });
});
