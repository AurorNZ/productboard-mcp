import { readFileSync } from 'fs';
import { join } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

function getPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}
const pkg = { version: getPackageVersion() };

import {
  ServerMetrics,
  HealthStatus,
} from './types.js';
import { MCPProtocolHandler } from './protocol.js';
import { ToolRegistry } from './registry.js';
import { AuthenticationManager } from '@auth/index.js';
import { AuthenticationType } from '@auth/types.js';
import { PermissionDiscoveryService } from '@auth/permission-discovery.js';
import { TokenPersistence } from '@auth/token-persistence.js';
import { startCallbackServer, OAuthCallbackError } from '@auth/oauth-callback-server.js';
import { execFile } from 'child_process';
import { UserPermissions, AccessLevel } from '@auth/permissions.js';
import { ProductboardAPIClient } from '@api/index.js';
import { RateLimiter, CacheModule } from '@middleware/index.js';
import { Config, Logger } from '@utils/index.js';
import { ServerError, ProtocolError, ToolExecutionError } from '@utils/errors.js';

export interface ServerDependencies {
  config: Config;
  logger: Logger;
  authManager: AuthenticationManager;
  apiClient: ProductboardAPIClient;
  toolRegistry: ToolRegistry;
  rateLimiter: RateLimiter;
  cache: CacheModule;
  protocolHandler: MCPProtocolHandler;
  permissionDiscovery: PermissionDiscoveryService;
  userPermissions?: UserPermissions;
}

export class ProductboardMCPServer {
  private server?: Server;
  private transport?: StdioServerTransport;
  private dependencies: ServerDependencies;
  private startTime: Date;
  private metrics: ServerMetrics;

  constructor(dependencies: ServerDependencies) {
    this.dependencies = dependencies;
    this.startTime = new Date();
    this.metrics = {
      uptime: 0,
      requestsTotal: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      averageResponseTime: 0,
      activeConnections: 0,
    };
  }

  static async create(config: Config): Promise<ProductboardMCPServer> {
    const logger = new Logger({
      level: config.logLevel,
      pretty: config.logPretty,
    });

    // For OAuth2: load persisted tokens BEFORE constructing AuthenticationManager,
    // which requires clientId in its constructor.
    let resolvedClientId = config.auth.clientId;
    let persistence: TokenPersistence | undefined;
    let persistedCache: import('@auth/token-persistence.js').PersistedOAuthData['cache'] | undefined;

    if (config.auth.type === AuthenticationType.OAUTH2) {
      persistence = new TokenPersistence();
      const persisted = await persistence.load();
      persistedCache = persisted?.cache;

      // Scope mismatch detection: if the user toggled PRODUCTBOARD_FULL_ACCESS
      // since the last authorization, the stored scope no longer matches what we
      // would request. Clear the tokens so the browser flow runs afresh with
      // the correct scope on the next startup.
      if (persisted?.cache && persisted.scope !== undefined) {
        const expectedScope = (config.auth.fullAccess ?? false)
          ? 'entities:read entities:write entities:delete notes:read notes:write notes:delete'
          : 'entities:read notes:read notes:write';
        if (persisted.scope !== expectedScope) {
          process.stderr.write(
            '\nProductboard access level has changed — stored tokens have been cleared.\n' +
            'Please re-authorize when prompted.\n',
          );
          await persistence.clear();
          persistedCache = undefined;
        }
      }

      if (!resolvedClientId) {
        throw new ServerError(
          'OAuth2 authentication requires PRODUCTBOARD_OAUTH_CLIENT_ID to be set.',
        );
      }
    }

    const authConfig = {
      type: config.auth.type,
      credentials: {
        type: config.auth.type,
        token: config.auth.token,
        clientId: resolvedClientId,
        clientSecret: config.auth.clientSecret,
        redirectUri: config.auth.redirectUri,
        fullAccess: config.auth.fullAccess ?? false,
      },
      baseUrl: config.api.baseUrl,
    };

    const authManager = new AuthenticationManager(authConfig, logger);

    // Set credentials from configuration
    if (config.auth.type === AuthenticationType.BEARER_TOKEN && config.auth.token) {
      authManager.setCredentials({
        type: AuthenticationType.BEARER_TOKEN,
        token: config.auth.token,
      });
    } else if (config.auth.type === AuthenticationType.OAUTH2 && resolvedClientId) {
      authManager.setCredentials({ type: AuthenticationType.OAUTH2, clientId: resolvedClientId });

      // Load any previously persisted tokens so the user doesn't re-auth on every start
      if (persistedCache?.accessToken || persistedCache?.refreshToken) {
        authManager.loadTokenCache(persistedCache);
      }
    }
    
    const rateLimiter = new RateLimiter(
      config.rateLimit.global,
      config.rateLimit.windowMs,
      config.rateLimit.perTool,
    );

    const apiClient = new ProductboardAPIClient(
      config.api,
      authManager,
      logger,
      rateLimiter,
    );

    const cache = new CacheModule(config.cache);
    const toolRegistry = new ToolRegistry(logger);
    const protocolHandler = new MCPProtocolHandler(toolRegistry, logger);
    const permissionDiscovery = new PermissionDiscoveryService(apiClient, logger, authManager);

    const dependencies: ServerDependencies = {
      config,
      logger,
      authManager,
      apiClient,
      toolRegistry,
      rateLimiter,
      cache,
      protocolHandler,
      permissionDiscovery,
    };

    return new ProductboardMCPServer(dependencies);
  }

  async initialize(): Promise<void> {
    const { logger, authManager, apiClient } = this.dependencies;

    try {
      logger.info('Initializing Productboard MCP Server...');

      // Validate configuration
      const configValidation = this.dependencies.config;
      logger.debug('Configuration loaded', {
        authType: configValidation.auth?.type,
        apiBaseUrl: configValidation.api?.baseUrl,
        logLevel: configValidation.logLevel,
      });

      // Initialize MCP server first to start listening for protocol messages
      this.initializeMCPServer();

      // Skip network operations in test mode to allow unit testing without API access
      if (process.env.NODE_ENV !== 'test') {
        logger.info('Validating authentication...');

        const authConfig = this.dependencies.config.auth;
        if (authConfig.type === AuthenticationType.OAUTH2) {
          await this.ensureOAuth2Tokens(authManager, authConfig, logger);
        } else {
          const isAuthenticated = await authManager.validateCredentials();
          if (!isAuthenticated) {
            logger.error('Authentication validation failed');
            throw new ServerError('Authentication validation failed');
          }
        }

        logger.info('Authentication validated successfully');
      }

      // Test API connection (skip in test mode)
      if (process.env.NODE_ENV !== 'test') {
        logger.info('Testing API connection...');
        const connectionTest = await apiClient.testConnection();
        if (!connectionTest) {
          logger.error('API connection test failed');
          throw new ServerError('API connection test failed');
        }
        logger.info('API connection established');
      }

      // Discover user permissions (skip in test mode)
      if (process.env.NODE_ENV !== 'test') {
        logger.info('Discovering user permissions...');
        const userPermissions = await this.dependencies.permissionDiscovery.discoverUserPermissions();
        this.dependencies.userPermissions = userPermissions;
        logger.info('Permission discovery completed', {
          accessLevel: userPermissions.accessLevel,
          isReadOnly: userPermissions.isReadOnly,
          permissionCount: userPermissions.permissions.size,
        });
      }

      // Register tools based on permissions
      await this.registerTools();

      logger.info('Productboard MCP Server initialized successfully');
    } catch (error) {
      logger.fatal('Failed to initialize server', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    const { logger } = this.dependencies;

    if (!this.server || !this.transport) {
      throw new ServerError('Server not initialized');
    }

    try {
      logger.info('Starting Productboard MCP Server...');
      await this.server.connect(this.transport);
      logger.info('Productboard MCP Server started successfully');
    } catch (error) {
      logger.fatal('Failed to start server', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    const { logger } = this.dependencies;

    try {
      logger.info('Stopping Productboard MCP Server...');
      
      if (this.server) {
        await this.server.close();
      }

      logger.info('Productboard MCP Server stopped successfully');
    } catch (error) {
      logger.error('Error while stopping server', error);
      throw error;
    }
  }

  private async ensureOAuth2Tokens(
    authManager: AuthenticationManager,
    authConfig: { redirectUri?: string },
    logger: typeof this.dependencies.logger,
  ): Promise<void> {
    const config = this.dependencies.config;
    const expectedScope = (config.auth.fullAccess ?? false)
      ? 'entities:read entities:write entities:delete notes:read notes:write notes:delete'
      : 'entities:read notes:read notes:write';

    const cache = authManager.getTokenCache();
    const hasToken = !!(cache.accessToken || cache.refreshToken);

    if (hasToken) {
      // Tokens loaded from persistence — validate (will auto-refresh if expired)
      const persistence = new TokenPersistence();
      try {
        const isAuthenticated = await authManager.validateCredentials();
        if (isAuthenticated) {
          // If token was silently refreshed, persist the updated tokens
          const refreshed = authManager.getTokenCache();
          if (refreshed.accessToken !== cache.accessToken) {
            await persistence.save(refreshed, expectedScope);
          }
          return;
        }
      } catch {
        // Refresh token is expired or invalid — clear stored tokens and fall through to browser re-auth
        logger.warn('OAuth2 refresh token expired or invalid — clearing stored tokens and re-authorizing via browser');
        await persistence.clear();
        authManager.loadTokenCache({});
      }
      logger.warn('Stored OAuth2 tokens are no longer valid — starting re-authorization');
    }

    // No valid tokens — run the browser authorization flow
    const redirectUri = authConfig.redirectUri || 'http://localhost:3000/callback';
    const parsedUri = new URL(redirectUri);
    const port = parseInt(parsedUri.port || (parsedUri.protocol === 'https:' ? '443' : '80'));

    const authUrl = authManager.getOAuth2AuthorizationUrl();
    process.stderr.write(
      `\nProductboard authorization required.\nOpening browser...\n\n  ${authUrl}\n\nWaiting for authorization (5 min timeout)...\n`,
    );
    // execFile is used instead of exec so the URL is passed as a literal argument
    // rather than interpolated into a shell string, eliminating any shell-injection risk.
    if (process.platform === 'win32') {
      // `start` is a cmd.exe built-in; the empty string is a required placeholder
      // for the window title so the URL isn't misinterpreted as the title.
      execFile(process.env['COMSPEC'] ?? 'cmd.exe', ['/c', 'start', '', authUrl]);
    } else if (process.platform === 'darwin') {
      execFile('open', [authUrl]);
    } else {
      // Linux and other Unix-like systems
      execFile('xdg-open', [authUrl]);
    }

    try {
      const { code, state } = await startCallbackServer(port);
      await authManager.handleOAuth2Callback(code, state);
    } catch (err) {
      // If Productboard redirects back with an explicit error code the
      // authorization was denied. Two likely causes:
      //   1. Full access mode is enabled but the user's role is Contributor —
      //      they should disable "Full access mode" in the connector settings
      //      and re-authorize.
      //   2. The account has no access to this workspace at all (missing,
      //      deactivated, or the OAuth app was not granted access).
      if (
        err instanceof OAuthCallbackError &&
        (err.errorCode === 'access_denied' || err.errorCode === 'invalid_scope')
      ) {
        const fullAccessEnabled = config.auth.fullAccess ?? false;
        const hint = fullAccessEnabled
          ? 'Full access mode is enabled — this requires a Maker or Admin Productboard role.\n' +
            'If your role is Contributor, disable "Full access mode" in the connector settings and re-authorize.'
          : 'Your account may not have access to this Productboard workspace, or access may have been revoked.\n' +
            'Please contact your Productboard administrator to verify your account status.';
        const message = `Productboard authorization was denied.\n${hint}`;
        process.stderr.write(`\n${message}\n`);
        throw new ServerError(message);
      }
      throw err;
    }

    // Persist the new tokens alongside the scope that was authorized, so that
    // a future toggle of PRODUCTBOARD_FULL_ACCESS triggers a fresh authorization.
    const persistence = new TokenPersistence();
    await persistence.save(authManager.getTokenCache(), expectedScope);

    logger.info('OAuth2 authorization completed and tokens persisted');
  }

  private initializeMCPServer(): void {
    const { logger, toolRegistry } = this.dependencies;

    this.server = new Server(
      {
        name: 'productboard-mcp',
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.transport = new StdioServerTransport();

    // Tools handlers
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: toolRegistry.listTools(),
      };
    });

    // Tool execution handler
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startTime = Date.now();
      this.metrics.requestsTotal++;
      this.metrics.activeConnections++;

      try {
        // Validate request params
        if (!request.params || typeof request.params !== 'object') {
          throw new ProtocolError('Request params are required');
        }

        const { name, arguments: args } = request.params as { name?: string; arguments?: unknown };

        // Validate tool name
        if (!name || typeof name !== 'string') {
          throw new ProtocolError('Tool name is required and must be a string');
        }

        const result = await this.handleToolExecution(name, args);

        this.metrics.requestsSuccess++;
        this.updateResponseTime(Date.now() - startTime);

        return result;
      } catch (error) {
        this.metrics.requestsFailed++;
        logger.error('Tool execution failed', error);

        const params = request.params as Record<string, unknown> | undefined;
        const toolName = params && typeof params.name === 'string' ? params.name : 'unknown';

        // For read-only tools, return a safe, non-throwing result to avoid 500s in clients
        try {
          const tool = this.dependencies.toolRegistry.getTool(toolName);
          if (tool && tool.permissionMetadata?.minimumAccessLevel === AccessLevel.READ) {
            const message = error instanceof Error ? error.message : (typeof error === 'string' ? error : 'Unknown error during tool execution');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error executing ${toolName}: ${String(message)}`,
                },
              ],
            };
          }
        } catch (lookupError) {
          // If tool lookup fails, fall through to standard error handling
        }

        // Re-throw with proper error handling for non-read tools or unknown cases
        if (error instanceof ProtocolError || error instanceof ToolExecutionError) {
          throw error;
        }

        throw new ToolExecutionError(
          error instanceof Error ? error.message : 'Unknown error during tool execution',
          toolName,
          error instanceof Error ? error : undefined
        );
      } finally {
        this.metrics.activeConnections--;
      }
    });
  }

  private async handleToolExecution(toolName: string, params: unknown): Promise<unknown> {
    const { protocolHandler, cache, logger } = this.dependencies;

    // Check cache for read operations
    const cacheKey = cache.getCacheKey({ tool: toolName, method: toolName, params });
    const cachedResult = cache.get(cacheKey);
    if (cachedResult !== null) {
      logger.debug(`Cache hit for tool: ${toolName}`);
      return cachedResult;
    }

    // Execute tool
    const result = await protocolHandler.invokeTool(toolName, params);

    // Cache result if applicable
    if (cache.shouldCache({ tool: toolName, method: toolName, params })) {
      cache.set(cacheKey, result);
      logger.debug(`Cached result for tool: ${toolName}`);
    }

    return result;
  }


  private async registerTools(): Promise<void> {
    const { logger, toolRegistry, apiClient } = this.dependencies;
    logger.info('Registering Productboard tools...');

    try {
      // Import all available tools from the main index
      const allTools = await import('@tools/index.js');
      logger.info('All tools imported successfully');

      // Extract all tool constructors from the imported module
      const toolConstructors = Object.values(allTools).filter(
        (tool): tool is new (...args: any[]) => any => 
          typeof tool === 'function' && 
          tool.name.endsWith('Tool') &&
          tool.prototype &&
          typeof tool.prototype.execute === 'function'
      );

      logger.info(`Found ${toolConstructors.length} tool constructors to register`);

      // Register tools one by one with permission checking and error handling
      let registeredCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      const { userPermissions } = this.dependencies;

      for (const ToolConstructor of toolConstructors) {
        try {
          logger.debug(`Processing ${ToolConstructor.name}...`);
          
          // Create a tool instance
          const toolInstance = new ToolConstructor(apiClient, logger);
          
          // Check if user has permission to use this tool (only if permissions are available)
          if (userPermissions && !toolInstance.isAvailableForUser(userPermissions)) {
            const missingPermissions = toolInstance.getMissingPermissions(userPermissions);
            logger.debug(`Skipping ${ToolConstructor.name} - insufficient permissions. Missing: ${missingPermissions.join(', ')}`);
            skippedCount++;
            continue;
          }
          
          logger.debug(`Registering ${ToolConstructor.name}...`);
          toolRegistry.registerTool(toolInstance);
          registeredCount++;
          logger.debug(`${ToolConstructor.name} registered successfully`);
        } catch (error) {
          failedCount++;
          logger.error(`Failed to register ${ToolConstructor.name}:`, error);
          // Continue with other tools instead of failing completely
        }
      }

      // Log registration summary
      const totalProcessed = registeredCount + failedCount + skippedCount;
      logger.info(`Tool registration summary: ${registeredCount} registered, ${skippedCount} skipped (permissions), ${failedCount} failed out of ${totalProcessed} total tools`);
      
      if (failedCount > 0) {
        logger.warn(`Tool registration completed with ${failedCount} failures.`);
      }
      
      if (skippedCount > 0) {
        logger.info(`${skippedCount} tools were skipped due to insufficient permissions. Use a token with higher privileges to access more tools.`);
      }

      // Verify the registry size matches our expectations
      const actualRegisteredCount = toolRegistry.size();
      if (actualRegisteredCount !== registeredCount) {
        logger.warn(`Registry size mismatch: expected ${registeredCount}, actual ${actualRegisteredCount}`);
      }

    } catch (error) {
      logger.error('Failed to import or register tools:', error);
      throw error;
    }
  }


  private updateResponseTime(responseTime: number): void {
    const currentAverage = this.metrics.averageResponseTime;
    const totalRequests = this.metrics.requestsSuccess + this.metrics.requestsFailed;
    this.metrics.averageResponseTime =
      (currentAverage * (totalRequests - 1) + responseTime) / totalRequests;
  }

  getHealth(): HealthStatus {
    const uptime = Date.now() - this.startTime.getTime();
    
    return {
      status: 'healthy',
      version: pkg.version,
      uptime,
      checks: {
        api: true,
        auth: !this.dependencies.authManager.isTokenExpired(),
        rateLimit: true,
      },
    };
  }

  getMetrics(): ServerMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime.getTime(),
    };
  }
}