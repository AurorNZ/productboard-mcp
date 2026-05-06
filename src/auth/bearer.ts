import { AuthHeaders } from './types.js';
import { ProductboardAPIError } from '@api/errors.js';
import axios, { AxiosError } from 'axios';
import { Logger } from '@utils/logger.js';

export class BearerTokenAuth {
  private readonly logger: Logger;

  constructor(_baseUrl: string, logger?: Logger) {
    // Accept an injected logger so the caller controls the log level.
    // Fall back to 'info' (never 'debug') to avoid accidental token exposure.
    this.logger = logger ?? new Logger({ level: 'info', name: 'bearer-auth' });
  }

  async validateToken(token: string): Promise<boolean> {
    if (process.env.NODE_ENV === "development") {
      this.logger.debug("Skipping token validation in development mode");
      return true;
    }
    
    if (process.env.SKIP_TOKEN_VALIDATION === "true") {
      // SECURITY: this flag disables all token validation. Never set in production.
      this.logger.warn("SKIP_TOKEN_VALIDATION is set — token validation disabled. Do not use in production.");
      return true;
    }

    try {
      const url = "https://api.productboard.com/v2/entities?type[]=feature";
      this.logger.debug('Validating bearer token against Productboard API');
      
      // Use /features endpoint for token validation (without parameters)
      const response = await axios.get(url, {
        headers: this.getHeaders(token),
        timeout: 5000,
      });

      this.logger.debug('Token validation successful', { status: response.status });
      return response.status === 200;
    } catch (error) {
      if (error instanceof AxiosError) {
        this.logger.error('Token validation failed', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        });
        
        if (error.response?.status === 401) {
          throw new ProductboardAPIError('Invalid API token', 'INVALID_TOKEN', undefined, 401);
        }
        
        if (error.response?.status === 403) {
          throw new ProductboardAPIError('API token lacks required permissions', 'INSUFFICIENT_PERMISSIONS', undefined, 403);
        }
      }
      
      this.logger.error('Token validation error', { error: error instanceof Error ? error.message : error });
      return false;
    }
  }

  getHeaders(token: string): AuthHeaders {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }
}
