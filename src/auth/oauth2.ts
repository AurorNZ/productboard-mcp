import { AuthHeaders, TokenResponse, OAuth2Config } from './types.js';
import { ProductboardAPIError } from '@api/errors.js';
import axios, { AxiosError } from 'axios';
import crypto from 'crypto';

export class OAuth2Auth {
  private config: OAuth2Config;
  private state: string | null = null;
  private codeVerifier: string | null = null;

  constructor(config: OAuth2Config) {
    this.config = config;
  }

  generateState(): string {
    this.state = crypto.randomBytes(32).toString('hex');
    return this.state;
  }

  private generateCodeVerifier(): string {
    // 96 random bytes → 128-char base64url string, all unreserved chars [A-Za-z0-9_-]
    return crypto.randomBytes(96).toString('base64url').slice(0, 128);
  }

  private generateCodeChallenge(verifier: string): string {
    // S256: base64url(sha256(verifier)) — no padding
    return crypto.createHash('sha256').update(verifier).digest('base64url');
  }

  getAuthorizationUrl(): string {
    const state = this.generateState();
    this.codeVerifier = this.generateCodeVerifier();
    const challenge = this.generateCodeChallenge(this.codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(this.config.scope && { scope: this.config.scope }),
    });

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  validateState(state: string): boolean {
    return this.state === state;
  }

  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    if (!this.codeVerifier) {
      throw new ProductboardAPIError(
        'PKCE code verifier not available — call getAuthorizationUrl() first',
        'OAUTH_PKCE_ERROR',
      );
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: this.config.clientId,
        redirect_uri: this.config.redirectUri,
        code_verifier: this.codeVerifier,
        ...(this.config.clientSecret && { client_secret: this.config.clientSecret }),
      });

      const response = await axios.post<TokenResponse>(
        this.config.tokenEndpoint,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
      );

      // Verifier is single-use — clear it after successful exchange
      this.codeVerifier = null;

      return response.data;
    } catch (error) {
      throw new ProductboardAPIError(
        'Failed to exchange authorization code for token',
        'OAUTH_TOKEN_EXCHANGE_ERROR',
        error instanceof Error ? error : undefined,
      );
    }
  }

  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    try {
      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        ...(this.config.clientSecret && { client_secret: this.config.clientSecret }),
      });

      const response = await axios.post<TokenResponse>(
        this.config.tokenEndpoint,
        params.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 10000,
        },
      );

      return response.data;
    } catch (error) {
      if (error instanceof AxiosError && error.response?.status === 401) {
        throw new ProductboardAPIError(
          'Refresh token is invalid or expired',
          'OAUTH_REFRESH_TOKEN_INVALID',
          error,
        );
      }
      throw new ProductboardAPIError(
        'Failed to refresh OAuth2 token',
        'OAUTH_REFRESH_ERROR',
        error instanceof Error ? error : undefined,
      );
    }
  }

  getHeaders(accessToken: string): AuthHeaders {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }
}
