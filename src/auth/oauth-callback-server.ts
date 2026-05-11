import http from 'http';

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

/**
 * Thrown when Productboard's authorization server redirects back with an error code
 * (e.g. `access_denied` when the requested scopes exceed the user's Productboard role).
 * Distinguishing this from a generic Error lets callers surface a role-specific hint
 * to the user (e.g. "disable Full access mode if your role is Contributor").
 */
export class OAuthCallbackError extends Error {
  constructor(
    message: string,
    /** The OAuth2 `error` parameter returned by the authorization server */
    public readonly errorCode: string,
    /** The human-readable `error_description` parameter, if present */
    public readonly errorDescription?: string,
  ) {
    super(message);
    this.name = 'OAuthCallbackError';
  }
}

/**
 * Headers applied to every HTML response from the callback server.
 * CSP prevents the ephemeral local page from loading external resources or
 * running scripts. Inline styles are permitted for the minimal page layout.
 */
const HTML_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
};

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head><title>Authorization Successful</title></head>
<body style="font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center">
  <h1>&#10003; Authorization successful</h1>
  <p>You can close this tab and return to your terminal.</p>
</body>
</html>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ERROR_HTML = (message: string) => `<!DOCTYPE html>
<html>
<head><title>Authorization Failed</title></head>
<body style="font-family:sans-serif;max-width:500px;margin:60px auto;text-align:center">
  <h1>&#10007; Authorization failed</h1>
  <p>${escapeHtml(message)}</p>
  <p>You can close this tab.</p>
</body>
</html>`;

/**
 * Starts a temporary local HTTP server that waits for the OAuth2 redirect callback.
 * Resolves with the authorization code and state once the browser redirects back.
 * The server shuts itself down after receiving the callback or timing out.
 *
 * Security measures implemented here:
 *   - Bound to 127.0.0.1 only (no external network exposure).
 *   - Host header validated on every request to prevent DNS-rebinding attacks.
 *   - Only GET requests accepted; all other methods return 405.
 *   - Only the first valid callback is processed; subsequent requests on
 *     keep-alive connections are silently dropped (503) to prevent the
 *     Promise from being settled more than once.
 *   - All HTML responses include a strict Content-Security-Policy.
 *   - Error messages rendered into HTML are HTML-escaped.
 */
export function startCallbackServer(
  port: number,
  timeoutMs = 300_000,
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout;
    // Ensure only the first valid callback settles the Promise. HTTP keep-alive
    // connections can deliver additional requests after server.close() is called
    // but before existing sockets drain.
    let served = false;

    const server = http.createServer((req, res) => {
      // Drop any request that arrives after the first valid callback.
      if (served) {
        res.writeHead(503);
        res.end();
        return;
      }

      // Only accept GET — the authorization redirect is always a GET, and
      // any other method has no legitimate reason to reach this endpoint.
      if (req.method !== 'GET') {
        res.writeHead(405, { Allow: 'GET' });
        res.end();
        return;
      }

      // DNS-rebinding guard: the Host header must match the loopback address
      // and port we bound to. A browser making a genuine redirect always sends
      // the correct Host; a rebinding attack that tries to forge localhost as
      // a remote origin will send a different value.
      const host = req.headers['host'] ?? '';
      if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
        res.writeHead(400);
        res.end();
        return;
      }

      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      // Mark as served before any async work so concurrent requests are dropped.
      served = true;
      clearTimeout(timeoutHandle);

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        res.writeHead(200, HTML_HEADERS);
        res.end(ERROR_HTML(errorDescription ?? error));
        server.close();
        reject(new OAuthCallbackError(
          `OAuth authorization denied: ${errorDescription ?? error}`,
          error,
          errorDescription ?? undefined,
        ));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, HTML_HEADERS);
        res.end(ERROR_HTML('Missing code or state parameter.'));
        server.close();
        reject(new Error('OAuth callback missing required parameters'));
        return;
      }

      res.writeHead(200, HTML_HEADERS);
      res.end(SUCCESS_HTML);
      server.close();
      resolve({ code, state });
    });

    server.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to start OAuth callback server on port ${port}: ${err.message}`));
    });

    server.listen(port, '127.0.0.1', () => {
      timeoutHandle = setTimeout(() => {
        server.close();
        reject(new Error('OAuth authorization timed out after 5 minutes'));
      }, timeoutMs);
    });
  });
}
