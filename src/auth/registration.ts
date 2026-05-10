/**
 * NOTE: Dynamic Client Registration (RFC 7591) is not yet live on Productboard's backend —
 * POST /oauth2/register returns 404 as of May 2026. This file is preserved for when
 * Productboard ships the endpoint, at which point the confidential client flow (client_id +
 * client_secret via env vars) can be replaced with public client self-registration.
 *
 * To re-enable: import registerOAuthClient in server.ts, call it before constructing
 * AuthenticationManager, and remove PRODUCTBOARD_OAUTH_CLIENT_ID/SECRET from env var requirements.
 */

import axios from 'axios';
import { ProductboardAPIError } from '@api/errors.js';

const REGISTRATION_URL = 'https://app.productboard.com/oauth2/register';

/**
 * Self-registers this MCP server as a public OAuth2 client via RFC 7591
 * Dynamic Client Registration. Returns a persistent client_id that should
 * be stored and reused on subsequent runs.
 */
export async function registerOAuthClient(
  clientName: string,
  redirectUri: string,
): Promise<string> {
  try {
    const response = await axios.post<{ client_id: string }>(
      REGISTRATION_URL,
      {
        client_name: clientName,
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10_000,
      },
    );

    const clientId = response.data?.client_id;
    if (!clientId) {
      throw new ProductboardAPIError(
        'Registration response did not include a client_id',
        'OAUTH_REGISTRATION_ERROR',
      );
    }

    return clientId;
  } catch (error) {
    if (error instanceof ProductboardAPIError) throw error;
    const axiosError = error as import('axios').AxiosError;
    const status = axiosError?.response?.status;
    const body = axiosError?.response?.data;
    throw new ProductboardAPIError(
      `Failed to register OAuth2 public client with Productboard${status ? ` (HTTP ${status}: ${JSON.stringify(body)})` : ''}`,
      'OAUTH_REGISTRATION_ERROR',
      error instanceof Error ? error : undefined,
    );
  }
}
