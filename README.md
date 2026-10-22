# zotero-safe-mcp

A small, standalone Zotero plugin that lets an LLM agent (e.g. Claude Code running in a sandbox) read
your local Zotero library and add notes, highlights, tags and papers, and undo its own changes, and
nothing else. See [SPEC.md](SPEC.md) for the full design and safety rules.

The plugin registers three endpoints on Zotero's built-in HTTP server (port 23119):

- `POST /safe-mcp`: MCP over HTTP (JSON responses, stateless)
- `POST /safe-mcp/image`: upload a PNG/JPEG for use in a note
- `GET /safe-mcp/pdf/<attachmentKey>`: download a PDF attachment's file

Every request needs `Authorization: Bearer <token>`. It runs whenever Zotero is open; there is nothing
to start by hand. Requires Zotero 7 to 10 (developed and tested on Zotero 10.0.6). Personal library
("My Library") only; group libraries are not touched.

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

Prefs (Zotero Settings → Advanced → Config Editor):

| Pref | Default | Meaning |
|---|---|---|
| `extensions.zotero-safe-mcp.writesPerMinute` | `30` | write tool calls allowed per minute |
| `extensions.zotero-safe-mcp.pdfUrlBase` | empty | base of URLs from `get_pdf_url`; empty = `http://host.docker.internal:<Zotero's port>` |

## Tools

| Tool | What it does |
|---|---|
| `search_library` | quick search (all fields, tags, notes, annotations, full text), optional collection/tag filter |
| `get_item` | metadata, attachments, child notes, tags, collections of one item |
| `list_collections` | the collection tree |
| `read_pdf_text` | a PDF's text per page, optional page ranges |
| `get_pdf_url` | URL to `curl` a PDF to a file instead of reading it into context |
| `list_annotations` | highlights and other annotations of an attachment, with `byLLM` |
| `list_notes` | an item's child notes, or a collection's standalone notes, as Markdown, with `byLLM` |
| `get_reader_state` | the item open in the selected reader tab, its current page and selected text |
| `list_changes` | the agent's recent changes, for `undo` |
| `add_highlight` | highlight a quoted passage (never green), comment prefixed `[LLM]` |
| `create_note` | a note from Markdown (tables, math, `[@itemKey]` citations, uploaded images), tagged `[LLM]` |
| `edit_note` | replace the content of a note the agent created; the old version is kept |
| `add_tags` / `remove_tags` | add tags to any item; remove only tags the agent added |
| `import_paper` | import by DOI, arXiv ID or PMID through Zotero's translators, PDF when available |
| `trash` | move the agent's own notes, highlights and imported papers to the trash |
| `undo` | reverse one of the agent's changes (default: the last one) |

Every write returns a `changeId`. Images for notes are uploaded first and referenced by id:

```bash
curl -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/png' --data-binary @fig.png \
  http://host.docker.internal:23119/safe-mcp/image      # → {"imageId": "img-…", "markdown": "![caption](image:img-…)", …}
```

## Safety model

The agent is assumed to run with every permission inside its sandbox, and to hold the token. The
plugin, not the agent, enforces what the token allows:

- **Read anything, change only its own.** The plugin records every note, highlight, imported paper
  (with its attachments) and tag (item + tag pair) it creates, in `safe-mcp.sqlite` in the Zotero data
  directory, out of the sandbox's reach. Only those can be edited, removed, trashed or undone. Your own
  papers, notes, highlights and tags are read-only to it, and tags you had before it added the same one
  stay yours. Once you edit one of its notes in Zotero, that note (with its images) is yours for good:
  it can no longer edit, trash or undo it, and `byLLM` turns false. Tags it added to the note stay its.
  Metadata, collections, saved searches and settings can't be changed at all.
- **Marked.** Its notes get the tag `[LLM]` and its highlight comments start with `[LLM]`. It can't
  add or remove the `[LLM]` tag itself. `byLLM` in read results comes from the registry, not the tag.
- **Green is yours.** Highlights use named colors except green; hex codes are refused.
- **Nothing is deleted.** Removal and undo move items to Zotero's trash; you can restore them.
  Undo of the agent's note changes is refused once you edited the note.
- **No files, no URLs, no code.** Papers come in by DOI, arXiv ID or PMID only; the PDF endpoint
  serves only files of attachment items in the library; nothing runs scripts or touches host files.
- **Rate limited.** Write tools are capped per minute (default 30); a refused call changes nothing.
- **Kept out of browsers.** The token keeps other local apps and web pages out; requests with a browser
  `Origin` header are rejected as well.

Things to know:

- **The token may appear in Zotero's debug log.** If you turn on Zotero's debug output (Help → Debug
  Output Logging), Zotero itself logs request headers, including the bearer token. It is off by
  default. Regenerate the token if you shared a debug log.
- **No duplicate imports.** If a paper with the same DOI, arXiv ID or PMID is already in your library
  (not in the trash), `import_paper` returns that item's key and imports nothing. The existing item stays
  yours: the agent still can't change or trash it.
- Anyone holding the token can use these tools (and nothing else in Zotero).

## Development

```bash
npm install
npm test                  # unit tests (vitest, plain Node)
npm run build             # typecheck + build/addon/ + zotero-safe-mcp.xpi
npm run test:integration  # end-to-end tests against a real headless Zotero 10.0.6 (Linux)
```

`npm run test:integration` builds the plugin, starts a fresh headless Zotero (Xvfb) with it, runs
`test/integration/*.itest.ts` and stops Zotero again. First time on a machine, run
`scripts/run-zotero-headless.sh install` (apt packages + Zotero download) or point `ZOTERO_APP` at an
extracted Zotero. `ZBASE` (instance directory) and `ZPORT` (default 23300) select the instance, so
several can run side by side:

```bash
ZBASE=/tmp/zotero-it ZPORT=23212 npm run test:integration
```

The tests never touch your real library (they talk only to `127.0.0.1:$ZPORT`). Before a release, also
go through [docs/manual-test-checklist.md](docs/manual-test-checklist.md) in a real Zotero.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout and how to add a tool or endpoint.

## License and credits

AGPL-3.0-or-later (see [LICENSE](LICENSE)).

This plugin reuses code from [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
by Yile Wang and contributors (AGPL-3.0), at commit `435dd19`
(`435dd1928949ddb9361c2039da3d1ac96034c300`): the MCP protocol types, the quote matching and highlight
positioning, the math tokenizer for notes, and the import-by-identifier steps. Every reused file starts
with a header naming its source file, e.g.
`// Adapted from llm-for-zotero (AGPL-3.0), src/services/pdf/pdfAnnotationResolver.ts@435dd19`.
