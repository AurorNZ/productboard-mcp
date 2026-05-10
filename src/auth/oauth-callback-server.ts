import http from 'http';

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

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
 */
export function startCallbackServer(
  port: number,
  timeoutMs = 300_000,
): Promise<OAuthCallbackResult> {
  return new Promise((resolve, reject) => {
    let timeoutHandle: NodeJS.Timeout;

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      clearTimeout(timeoutHandle);

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const errorDescription = url.searchParams.get('error_description');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML(errorDescription ?? error));
        server.close();
        reject(new Error(`OAuth authorization denied: ${errorDescription ?? error}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(ERROR_HTML('Missing code or state parameter.'));
        server.close();
        reject(new Error('OAuth callback missing required parameters'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
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
