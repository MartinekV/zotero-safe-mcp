# zotero-safe-mcp

A small, standalone Zotero plugin that lets an LLM agent (e.g. Claude Code running in a sandbox) read
your local Zotero library and add notes, highlights, tags and papers, and undo its own changes, and
nothing else. See [SPEC.md](SPEC.md) for the full design and safety rules.

The plugin registers `POST /safe-mcp` (MCP over HTTP, JSON responses, stateless) on Zotero's
built-in HTTP server (`127.0.0.1:23119`). Every request needs `Authorization: Bearer <token>`.
Requests carrying a browser `Origin` header are rejected.

Requires Zotero 7 to 10 (developed and tested on Zotero 10.0.6).

## Setup (once)

1. Build or download `zotero-safe-mcp.xpi` (`npm install && npm run build`).
2. Install it in Zotero: Tools → Plugins → gear menu → Install Plugin From File…
3. Open Zotero Settings → **Safe MCP**. Copy the token, or copy the ready-made command.
4. On the host, only if the sandbox's network is restricted:
   `sbx policy allow network localhost:23119`
5. In the sandbox:
   ```bash
   claude mcp add --transport http zotero http://host.docker.internal:23119/safe-mcp \
     --header "Authorization: Bearer <token>"
   ```

To cut access quickly: `sbx policy rm network --resource localhost:23119`, or press
**Regenerate token** in the settings pane (the old token stops working immediately).

Privacy note: if you turn on Zotero's debug output, Zotero itself logs request headers, including
the bearer token. Debug output is off by default.

## Development

```bash
npm install
npm test                  # unit tests (vitest, plain Node)
npm run build             # typecheck + build/addon/ + zotero-safe-mcp.xpi
npm run test:integration  # against a real headless Zotero (Linux; see CONTRIBUTING.md)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout and how to add a tool or endpoint.

## License and credits

AGPL-3.0-or-later (see [LICENSE](LICENSE)).

This plugin reuses code from [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
by Yile Wang and contributors (AGPL-3.0), at commit `435dd1928949ddb9361c2039da3d1ac96034c300`.
Every reused file starts with a header naming its source file.
