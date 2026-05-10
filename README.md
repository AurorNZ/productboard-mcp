# productboard-mcp

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server for the [Productboard](https://www.productboard.com) API. Enables AI assistants (Claude, Cursor, etc.) to interact with your Productboard workspace.

## Tools

### Notes

| Tool | Description |
|------|-------------|
| `pb_note_list` | List customer feedback notes with optional filters (owner, creator, date range, source). Default limit 20 — use `limit: 500, resolve_entities: false` for analysis tasks. |
| `pb_note_get` | Get a single customer note by ID |
| `pb_note_create` | Create a customer feedback note |
| `pb_note_search` | Search notes using structured filters: tags, linked features, customer, date ranges, note type (textNote / conversationNote / opportunityNote). Default limit 20 — use `limit: 500, resolve_entities: false` for analysis or counting tasks. |

### Features

| Tool | Description |
|------|-------------|
| `pb_feature_list` | List features with filtering |
| `pb_feature_get` | Get a feature by ID |
| `pb_feature_create` | Create a new feature |
| `pb_feature_update` | Update an existing feature |
| `pb_feature_delete` | Delete (or archive) a feature |

### Products

| Tool | Description |
|------|-------------|
| `pb_product_list` | List products |
| `pb_product_create` | Create a product |
| `pb_product_hierarchy` | Get full product hierarchy |

### Objectives & Key Results

| Tool | Description |
|------|-------------|
| `pb_objective_list` | List objectives |
| `pb_objective_create` | Create an objective |
| `pb_objective_update` | Update an objective |
| `pb_keyresult_list` | List key results |
| `pb_keyresult_create` | Create a key result |
| `pb_keyresult_update` | Update a key result |

### Releases

| Tool | Description |
|------|-------------|
| `pb_release_list` | List releases |
| `pb_release_create` | Create a release |
| `pb_release_update` | Update a release |
| `pb_release_status_update` | Update release status |
| `pb_release_timeline` | Get release timeline |

## Notes tool tips

### Searching vs listing

Use `pb_note_search` when you need to filter by **tags**, **linked features**, **customer**, or **note type** — it uses Productboard's dedicated search endpoint and supports richer filter combinations.

Use `pb_note_list` for general browsing with simpler filters (owner, date range, source system, processed/archived state).

### Getting complete data for analysis

Both note tools default to `limit: 20`, suitable for browsing. When asking Claude to count, analyse, or summarise across all notes, always specify a higher limit:

```
Use pb_note_search with limit: 500 and resolve_entities: false
```

When the result count equals your limit, the response will include a `⚠️ Result limit reached` warning — re-run with a higher limit to ensure you have the full dataset.

The `resolve_entities: false` flag skips the extra API call per note that resolves company/feature IDs to display names, which prevents timeouts on large batches.

## Installation

### Option 1: One-click install (.mcpb bundle) — Recommended

Download the latest `.mcpb` file from the [Releases](../../releases) page and drag it into Claude Desktop (Developer → Extensions → Install), or double-click it in a compatible MCP client.

The bundle is self-contained — no cloning or building required.

After installing, you'll be prompted for a **Productboard OAuth Client Secret**. On first use, a browser tab will open to Productboard's login page — sign in to authorize access. Your tokens are stored securely in your OS keychain and won't be requested again unless your session expires (~6 months).

Alternatively, if you prefer bearer token auth, set `PRODUCTBOARD_AUTH_TYPE` to `bearer` and enter your `PRODUCTBOARD_API_TOKEN` instead.

### Option 2: Local install (manual)

```bash
# 1. Clone the repo using the URL from the "Code" button on this page
cd productboard-mcp

# 2. Install dependencies and build
npm install --include=dev
npm run build
```

**Bearer token auth** — add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "productboard": {
      "command": "node",
      "args": ["/absolute/path/to/productboard-mcp/dist/index.js"],
      "env": {
        "PRODUCTBOARD_API_TOKEN": "your-api-token-here",
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

**OAuth2** — add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "productboard": {
      "command": "node",
      "args": ["/absolute/path/to/productboard-mcp/dist/index.js"],
      "env": {
        "PRODUCTBOARD_AUTH_TYPE": "oauth2",
        "PRODUCTBOARD_OAUTH_CLIENT_ID": "your-client-id",
        "PRODUCTBOARD_OAUTH_CLIENT_SECRET": "your-client-secret",
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

On first run the server will open a browser tab to complete authorization. Tokens are then persisted to your OS keychain so subsequent starts are automatic.

> **Important:** Set `LOG_LEVEL` to `error` (not `info`). MCP uses stdio for communication — info-level logs printed to stdout will interfere with the protocol and cause the server to lock up.

### Option 3: npx

> ⚠️ Coming soon — not yet published to npm. Use Option 1 or 2 above.

```json
{
  "mcpServers": {
    "productboard": {
      "command": "npx",
      "args": ["-y", "@enreign/productboard-mcp"],
      "env": {
        "PRODUCTBOARD_API_TOKEN": "your-api-token-here",
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

## Authentication

### Bearer token

1. Log in to your Productboard workspace
2. Go to **Profile & Settings** → **API Access**
3. Click **Generate API key** and copy the token
4. Set `PRODUCTBOARD_API_TOKEN` in your MCP config

### OAuth2 (Authorization Code + PKCE)

1. Go to **https://app.productboard.com/oauth2/applications/new**
2. Select **OAuth 2.0**, give your app a name, and set the redirect URI to `http://localhost:3000/callback`
3. Copy the **Client ID** and **Client Secret** into your MCP config as `PRODUCTBOARD_OAUTH_CLIENT_ID` and `PRODUCTBOARD_OAUTH_CLIENT_SECRET`
4. Set `PRODUCTBOARD_AUTH_TYPE=oauth2`

On first run a browser tab opens for login. Access and refresh tokens are stored in your OS keychain (macOS Keychain / Windows Credential Manager) with a secure file fallback. Refresh tokens are valid for ~180 days — after expiry, the browser flow runs automatically on the next restart.

Tools available to you are determined by your Productboard role — the server checks your OAuth token scopes on startup and only registers the tools you have access to.

## Configuration

### Required (bearer auth)

| Variable | Description |
|----------|-------------|
| `PRODUCTBOARD_API_TOKEN` | Your Productboard API token |

### Required (OAuth2)

| Variable | Description |
|----------|-------------|
| `PRODUCTBOARD_OAUTH_CLIENT_ID` | OAuth2 client ID from your app registration |
| `PRODUCTBOARD_OAUTH_CLIENT_SECRET` | OAuth2 client secret from your app registration |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PRODUCTBOARD_AUTH_TYPE` | `bearer` | Auth type: `bearer` or `oauth2` |
| `PRODUCTBOARD_OAUTH_REDIRECT_URI` | `http://localhost:3000/callback` | OAuth2 redirect URI |
| `PRODUCTBOARD_API_BASE_URL` | `https://api.productboard.com/v2` | API base URL |
| `PRODUCTBOARD_API_TIMEOUT` | `10000` | API request timeout (ms) |
| `API_RETRY_ATTEMPTS` | `3` | Number of retry attempts |
| `API_RETRY_DELAY` | `1000` | Delay between retries (ms) |
| `RATE_LIMIT_GLOBAL` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `CACHE_ENABLED` | `false` | Enable response caching |
| `CACHE_TTL` | `300` | Cache TTL (seconds) |
| `LOG_LEVEL` | `info` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal` |

> **Note for MCP clients:** Always set `LOG_LEVEL=error` when using with Claude Desktop, Cursor, or any stdio-based MCP client. Higher log levels write to stdout and will break the MCP protocol.

## Troubleshooting

**"MCP server locks up / produces error logs"**
→ Add `"LOG_LEVEL": "error"` to the `env` block in your MCP config. Info logs written to stdout interfere with the stdio transport.

**"Browser didn't open / I can't complete OAuth2 authorization"**
→ The authorization URL is also printed to the server log (stderr). Copy it manually into a browser. The server waits 5 minutes before timing out.

**"OAuth2 authorization fails or tokens stop working"**
→ Restart Claude Desktop — the browser flow runs automatically and issues fresh tokens. If your refresh token has expired (~6 months), the same restart will trigger re-authorization.

**"Claude says it found X notes but I have more"**
→ The note tools default to `limit: 20`. When asking Claude to analyse or count notes, explicitly ask it to use `limit: 500, resolve_entities: false`. If the response contains a `⚠️ Result limit reached` warning, increase the limit further.

**"Note search times out on large workspaces"**
→ Pass `resolve_entities: false` to skip per-note entity resolution API calls. This is recommended for any batch or analysis query.

**"npx fails / package not found"**
→ The package is not yet published to npm. Use the `.mcpb` bundle or local install above.

**"command not found after local build"**
→ Point `args` at the full absolute path to `dist/index.js`, not the `productboard-mcp.js` wrapper.

## License

MIT
