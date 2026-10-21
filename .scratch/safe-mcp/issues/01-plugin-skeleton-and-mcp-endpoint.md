# 01: Plugin skeleton, auth token and MCP endpoint

**What to build:** an installable `.xpi` for Zotero 10.0.6 that, on startup, registers `POST /safe-mcp` on Zotero's built-in HTTP server and answers MCP JSON-RPC (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) with JSON responses, stateless (SPEC: Architecture). Every request needs `Authorization: Bearer <token>`; the token is generated on first run, persisted in prefs, and shown (with a copy button) in a settings pane. Includes the TypeScript build, unit-test setup, a tool registry other tickets plug into (name, description, JSON schema, handler, read/write flag), and a single place where tool errors become MCP `isError` results. `tools/list` initially contains no tools (or a trivial one used by tests).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `npm run build` produces `zotero-safe-mcp.xpi`; `npm test` runs unit tests
- [ ] Unit tests: JSON-RPC handling (valid/invalid requests, batch rejected or handled, notifications get 202/no body, unknown method → -32601, bad params → -32602), auth (missing/wrong/right token, constant-time compare)
- [ ] Requests with an `Origin` header are rejected (403) on every endpoint (SPEC: Auth)
- [ ] Endpoints are unregistered on plugin shutdown
- [ ] README with setup steps (SPEC: Setup), AGPL-3.0 LICENSE, credit to llm-for-zotero
