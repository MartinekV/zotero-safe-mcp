# Zotero Safe MCP

A Zotero plugin that gives MCP-capable AI agents access to your library. Agents can read
everything and add notes, highlights, tags and papers. They can change or remove only what they
added. They cannot execute any code on your machine through the MCP.

Requires Zotero 7 or later and works with "My Library" only. The plugin serves its MCP endpoint
from inside Zotero whenever Zotero is open.

## Quick start

1. Download `zotero-safe-mcp.xpi` from
   [Releases](https://github.com/MartinekV/zotero-safe-mcp/releases), or build it with
   `npm install && npm run build`.
2. In Zotero: Tools → Plugins → ⚙ → *Install Plugin From File…*
3. In Zotero Settings → **Safe MCP**, click *Copy token*.
4. Add the server to your MCP client:
   ```json
   "zotero": {
     "type": "http",
     "url": "http://localhost:23119/safe-mcp",
     "headers": { "Authorization": "Bearer <token>" }
   }
   ```
   If the agent runs in Docker, use `host.docker.internal` instead of `localhost`.

To revoke access, click *Regenerate token*.

### Docker Sandboxes (`sbx`)

With `sbx`, the real token never enters the sandbox. The MCP config holds a placeholder, and
`sbx` swaps the real token in on each request.

1. On the host, let the sandbox reach Zotero:
   ```bash
   sbx policy allow network localhost:23119
   ```
2. On the host, store the token from step 3 above as a secret:
   ```bash
   sbx secret set-custom \
     --host host.docker.internal --host localhost --host 127.0.0.1 \
     --env ZOTERO_MCP_TOKEN \
     --value <your_actual_token>
   ```
   The command prints a placeholder (it looks like `sbx-cs-…`). Copy it.
3. In the sandbox, add the server to your MCP client. Put the **placeholder** where the token
   would go:
   ```json
   "zotero": {
     "type": "http",
     "url": "http://host.docker.internal:23119/safe-mcp",
     "headers": { "Authorization": "Bearer <placeholder>" }
   }
   ```

## Tools

| | |
|---|---|
| **Read** | `search_library`, `get_item`, `list_collections`, `read_pdf_text`, `get_pdf_url`, `list_annotations`, `list_notes`, `get_reader_state` |
| **Add** | `create_note`, `add_highlight`, `add_tags`, `import_paper` (DOI, arXiv ID, PMID) |
| **Change its own work** | `edit_note`, `remove_tags`, `trash`, `undo`, `list_changes` |

## Safety

- The agent can edit, remove or undo only what it created. If you edit one of its notes, that
  note becomes yours.
- Nothing is deleted outright. Removed items go to Zotero's trash.
- Its notes are tagged `[LLM]` and its highlight comments start with `[LLM]`. It never uses
  green.
- It can't change metadata, collections or settings, read files from your computer, or open
  arbitrary URLs.
- Writes are limited to 60 per minute. You can change this with
  `extensions.zotero-safe-mcp.writesPerMinute` in the Config Editor.

Zotero's debug log records the token. If you share a debug log, regenerate the token afterwards.
For the full rules, see [SPEC.md](SPEC.md).

## Development

`npm test` runs the unit tests, and `npm run test:integration` runs the end-to-end tests
against a headless Zotero. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

AGPL-3.0-or-later. Parts are adapted from
[llm-for-zotero](https://github.com/yilewang/llm-for-zotero) (AGPL-3.0, commit `435dd19`), and
each reused file names its source in a header.
