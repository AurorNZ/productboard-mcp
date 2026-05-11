#!/usr/bin/env node
import { config } from 'dotenv';
import { ProductboardMCPServer } from '@core/server.js';
import { ConfigManager } from '@utils/config.js';
import { Logger } from '@utils/logger.js';

// Load environment variables
config();

async function main(): Promise<void> {
  const configManager = new ConfigManager();
  const configuration = configManager.get();
  
  const logger = new Logger({
    level: configuration.logLevel,
    pretty: configuration.logPretty,
  });

  try {
    // Validate configuration
    const validation = configManager.validate();
    if (!validation.valid) {
      logger.fatal('Configuration validation failed', { errors: validation.errors });
      process.exit(1);
    }

    // Create and initialize server
    const server = await ProductboardMCPServer.create(configuration);
    await server.initialize();

    // Handle shutdown signals
    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      try {
        await server.stop();
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Exit cleanly when the MCP client closes its end of the stdio connection.
    // Without this, open handles (e.g. an OAuth callback HTTP server on
    // port 3000 waiting for a browser redirect) keep the process alive
    // indefinitely, blocking port reuse on the next connection attempt.
    process.stdin.on('close', () => shutdown('stdin close'));

    // Start server
    await server.start();
    
    logger.info('Server is running. Press Ctrl+C to stop.');
  } catch (error) {
    logger.fatal('Server startup failed', error);
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  process.stderr.write(`Unhandled error: ${error}\n`);
  process.exit(1);
});