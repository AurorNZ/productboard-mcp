/**
 * Integration tests for the OAuth2 callback server.
 *
 * These tests spin up a real HTTP server on a free loopback port and make
 * actual HTTP requests against it so that every security guard can be
 * exercised end-to-end without mocking the transport layer.
 */

import http from 'http';
import {
  startCallbackServer,
  OAuthCallbackError,
} from '../../../src/auth/oauth-callback-server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Acquire a free TCP port by binding to :0 and reading the OS assignment. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address() as { port: number };
      probe.close(() => resolve(addr.port));
    });
    probe.on('error', reject);
  });
}

interface RawResponse {
  statusCode: number;
  headers: http.IncomingMessage['headers'];
  body: string;
}

/**
 * Make a single HTTP request directly to the callback server.
 * By default the Host header is set to `localhost:<port>` (the valid value).
 * Pass `agent` to share a keep-alive connection across multiple calls (used
 * only in the duplicate-request guard test).
 *
 * `Connection: close` is sent on every request so Node's HTTP layer closes
 * the TCP socket after the response, preventing lingering open handles that
 * would cause Jest to warn about asynchronous operations after the test run.
 */
function request(
  port: number,
  path: string,
  options: {
    method?: string;
    host?: string;
    agent?: http.Agent;
  } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers: {
          Host: options.host ?? `localhost:${port}`,
          // Close the TCP socket after the response unless the caller is
          // deliberately testing keep-alive behaviour via an explicit agent.
          ...(options.agent ? {} : { Connection: 'close' }),
        },
        agent: options.agent,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () =>
          resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Send a benign valid callback request to cleanly settle and close the server
 * after a test that exercised a rejection path (e.g. wrong Host / method),
 * which leaves the server still listening.
 * Both the request and the promise swallow errors — the server may already be
 * closing by the time we reach this helper.
 */
async function settleServer(
  serverPromise: Promise<unknown>,
  port: number,
): Promise<void> {
  await request(port, '/callback?code=cleanup&state=cleanup').catch(() => {});
  await serverPromise.catch(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuth callback server', () => {
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('resolves with code and state on a valid GET callback', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=auth123&state=state456');
      const result = await serverPromise;

      expect(res.statusCode).toBe(200);
      expect(result).toEqual({ code: 'auth123', state: 'state456' });
    });

    it('accepts both localhost and 127.0.0.1 as valid Host values', async () => {
      // localhost variant tested in other cases; verify 127.0.0.1 is also accepted
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=abc&state=xyz', {
        host: `127.0.0.1:${port}`,
      });
      const result = await serverPromise;

      expect(res.statusCode).toBe(200);
      expect(result).toEqual({ code: 'abc', state: 'xyz' });
    });

    it('includes a strict Content-Security-Policy header on success', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=abc&state=xyz');
      await serverPromise;

      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
    });

    it('returns HTML with the correct Content-Type on success', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=abc&state=xyz');
      await serverPromise;

      expect(res.headers['content-type']).toMatch(/text\/html/);
    });
  });

  // -------------------------------------------------------------------------
  // OAuth error in the callback parameters
  // -------------------------------------------------------------------------

  describe('OAuth error response', () => {
    it('rejects with OAuthCallbackError when error param is present', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      // Attach catch immediately — before any await — so Node never sees an
      // unhandled rejection, even momentarily.
      const settled = serverPromise.catch((e) => e as unknown);

      await request(
        port,
        '/callback?error=access_denied&error_description=Insufficient+permissions',
      );

      expect(await settled).toBeInstanceOf(OAuthCallbackError);
    });

    it('captures the error code and description on OAuthCallbackError', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      await request(
        port,
        '/callback?error=invalid_scope&error_description=Scope+not+allowed',
      );

      const err = await settled;
      expect(err).toBeInstanceOf(OAuthCallbackError);
      expect((err as OAuthCallbackError).errorCode).toBe('invalid_scope');
      // URLSearchParams.get() URL-decodes automatically: '+' → ' '
      expect((err as OAuthCallbackError).errorDescription).toBe('Scope not allowed');
    });

    it('returns 200 with an error page (not a redirect) on OAuth error', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(port, '/callback?error=access_denied');
      await settled;

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Authorization failed');
    });

    it('includes CSP header on the OAuth error page', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(port, '/callback?error=access_denied&error_description=Denied');
      await settled;

      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
    });

    it('HTML-escapes the error_description to prevent XSS', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(
        port,
        '/callback?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      );
      await settled;

      // URLSearchParams decodes %3C → '<'; escapeHtml then encodes it to &lt;
      expect(res.body).not.toContain('<script>');
      expect(res.body).toContain('&lt;script&gt;');
    });
  });

  // -------------------------------------------------------------------------
  // Missing or malformed callback parameters
  // -------------------------------------------------------------------------

  describe('missing parameters', () => {
    it('returns 400 and rejects when code is missing', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(port, '/callback?state=xyz');
      const err = await settled;

      expect(res.statusCode).toBe(400);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('missing required parameters');
    });

    it('returns 400 and rejects when state is missing', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(port, '/callback?code=abc');
      const err = await settled;

      expect(res.statusCode).toBe(400);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch('missing required parameters');
    });

    it('includes CSP header on the missing-params error page', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const settled = serverPromise.catch((e) => e as unknown);

      const res = await request(port, '/callback');
      await settled;

      expect(res.headers['content-security-policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Wrong path
  // -------------------------------------------------------------------------

  describe('wrong path', () => {
    it('returns 404 for requests to paths other than /callback', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/other');
      await settleServer(serverPromise, port);

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for requests to /', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/');
      await settleServer(serverPromise, port);

      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP method restriction
  // -------------------------------------------------------------------------

  describe('method restriction', () => {
    it('returns 405 for POST requests', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=abc&state=xyz', { method: 'POST' });
      await settleServer(serverPromise, port);

      expect(res.statusCode).toBe(405);
    });

    it('includes Allow: GET on 405 responses', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback', { method: 'DELETE' });
      await settleServer(serverPromise, port);

      expect(res.headers['allow']).toBe('GET');
    });

    it('does not settle the promise on a rejected method', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      await request(port, '/callback?code=abc&state=xyz', { method: 'PUT' });

      // Promise should still be pending — a subsequent valid request resolves it
      const validRes = await request(port, '/callback?code=real&state=real');
      const result = await serverPromise;

      expect(validRes.statusCode).toBe(200);
      expect(result).toEqual({ code: 'real', state: 'real' });
    });
  });

  // -------------------------------------------------------------------------
  // DNS-rebinding guard
  // -------------------------------------------------------------------------

  describe('DNS-rebinding guard (Host header)', () => {
    it('returns 400 for requests with a mismatched Host header', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      const res = await request(port, '/callback?code=abc&state=xyz', {
        host: 'evil.example.com',
      });
      await settleServer(serverPromise, port);

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 when Host omits the port', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      // A real browser would include the port; a forged header might omit it
      const res = await request(port, '/callback?code=abc&state=xyz', {
        host: 'localhost',
      });
      await settleServer(serverPromise, port);

      expect(res.statusCode).toBe(400);
    });

    it('does not settle the promise on a rebinding attempt', async () => {
      const serverPromise = startCallbackServer(port, 5_000);
      await request(port, '/callback?code=abc&state=xyz', {
        host: 'attacker.com',
      });

      // Promise should still be pending — the server is still listening
      const validRes = await request(port, '/callback?code=real&state=real');
      const result = await serverPromise;

      expect(validRes.statusCode).toBe(200);
      expect(result).toEqual({ code: 'real', state: 'real' });
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate-request guard (served flag)
  // -------------------------------------------------------------------------

  describe('duplicate-request guard', () => {
    it('returns 503 for a second request on a keep-alive connection', async () => {
      // Use a keep-alive agent so both requests share the same TCP socket.
      // After the first valid callback the server calls server.close() and sets
      // `served = true`, but the existing socket remains open; the second
      // request arrives over that socket and should be dropped with 503.
      const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

      try {
        const serverPromise = startCallbackServer(port, 5_000);

        const first = await request(port, '/callback?code=abc&state=xyz', { agent });
        await serverPromise; // resolves after first request

        // Server is now closed to new connections, but the keep-alive socket
        // may still be open; the served flag should protect against reuse.
        const second = await request(port, '/callback?code=second&state=second', {
          agent,
        }).catch(() => null); // connection may be refused once socket drains

        expect(first.statusCode).toBe(200);
        // Second request is either dropped with 503 or the connection is
        // refused (ECONNREFUSED) because the socket drained before it arrived.
        if (second !== null) {
          expect(second.statusCode).toBe(503);
        }
      } finally {
        agent.destroy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  describe('timeout', () => {
    it('rejects with a timeout error when no callback arrives in time', async () => {
      const serverPromise = startCallbackServer(port, 50 /* 50 ms */);

      await expect(serverPromise).rejects.toThrow('timed out');
    }, 2_000);
  });
});
