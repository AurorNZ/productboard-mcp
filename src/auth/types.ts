export enum AuthenticationType {
  BEARER_TOKEN = 'bearer',
  OAUTH2 = 'oauth2',
}

export interface AuthHeaders {
  Authorization: string;
  [key: string]: string;
}

export interface Credentials {
  type: AuthenticationType;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  redirectUri?: string;
  scope?: string;
  /** When true, full write/delete entity scopes are requested. Requires Maker or Admin role. */
  fullAccess?: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  created_at?: number;
  scope?: string;
}

export interface TokenInfoResponse {
  application: { uid: string };
  resource_owner: { name: string; email: string };
  space: { name: string; domain: string };
  scopes: string[];
  expires_in: number;
  created_at: number;
}

export interface AuthConfig {
  type: AuthenticationType;
  credentials: Credentials;
  baseUrl?: string;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
}

export interface TokenCache {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface AuthManagerInterface {
  setCredentials(credentials: Credentials): void;
  validateCredentials(): Promise<boolean>;
  refreshCredentials(onRefreshed?: (cache: TokenCache) => Promise<void>): Promise<void>;
  getAuthHeaders(): AuthHeaders;
  isTokenExpired(): boolean;
  getTokenExpiry(): Date | null;
}

export interface OAuth2Config {
  clientId: string;
  clientSecret?: string; // Not used for public clients (PKCE flow)
  authorizationEndpoint: string;
  tokenEndpoint: string;
  redirectUri: string;
  scope?: string;
}