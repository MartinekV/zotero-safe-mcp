# 01: Plugin skeleton, auth token and MCP endpoint

**What to build:** an installable `.xpi` for Zotero 10.0.6 that, on startup, registers `POST /safe-mcp` on Zotero's built-in HTTP server and answers MCP JSON-RPC (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) with JSON responses, stateless (SPEC: Architecture). Every request needs `Authorization: Bearer <token>`; the token is generated on first run, persisted in prefs, and shown (with a copy button) in a settings pane. Includes the TypeScript build, unit-test setup, a tool registry other tickets plug into (name, description, JSON schema, handler, read/write flag), and a single place where tool errors become MCP `isError` results. `tools/list` initially contains no tools (or a trivial one used by tests).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `npm run build` produces `zotero-safe-mcp.xpi`; `npm test` runs unit tests
- [x] Unit tests: JSON-RPC handling (valid/invalid requests, batch rejected or handled, notifications get 202/no body, unknown method → -32601, bad params → -32602), auth (missing/wrong/right token, constant-time compare)
- [x] Requests with an `Origin` header are rejected (403) on every endpoint (SPEC: Auth)
- [x] Endpoints are unregistered on plugin shutdown
- [x] README with setup steps (SPEC: Setup), AGPL-3.0 LICENSE, credit to llm-for-zotero

## Comments

- Batches are rejected (HTTP 400, -32600): MCP 2025-06-18 removed JSON-RPC batching.
- Malformed JSON-RPC (not an object, wrong `jsonrpc`, bad `id`) → HTTP 400 with a -32600 body, per the
  Streamable HTTP transport. Unknown method → 200 with -32601. `tools/call` with bad params or an unknown
  tool name → -32602. Arguments that fail the tool's `inputSchema` → an `isError` tool result (so the agent
  can correct itself), not -32602. Invalid JSON never reaches us: Zotero answers it with a plain-text 400.
- `Origin` → 403 is implemented in `protect()` for every endpoint, but in a real Zotero the built-in browser
  guard drops such requests (no reply) before our code runs; the integration test accepts either.
- `GET /safe-mcp` → 405 `Allow: POST` (no SSE).
- Token: 32 random bytes as hex, pref `extensions.zotero-safe-mcp.token`; pane has Copy token, Copy command
  and Regenerate token. Inline pane handlers run in the prefs window scope, so `prefs-pane.js` exposes
  `window.SafeMcpPane` (the exploration note said otherwise; verified headless).
- Tools, endpoints and lifecycle hooks are auto-registered from `src/{tools,endpoints,hooks}/*.ts` via a
  generated index (see CONTRIBUTING.md) so parallel tickets don't edit a shared list.
- `run-zotero-headless.sh stop` only stopping its own ZBASE works, but it leaked the instance's Xvfb
  (xvfb-run was killed before Zotero). Fixed here and in the notes copy: stop Zotero first, then xvfb-run and its Xvfb.
