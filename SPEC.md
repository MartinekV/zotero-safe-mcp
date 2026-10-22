# zotero-safe-mcp — spec

A small, standalone Zotero plugin that lets an LLM agent (Claude Code running
in a sandbox) read the local Zotero library, add notes, highlights, tags and
papers, and undo its own changes — and nothing else.

## Goals

- Work with the **local** Zotero app only. No zotero.org Web API, no API key.
- Standalone: no dependency on llm-for-zotero or any other plugin.
- Safe to use from an agent running with all permissions ("yolo") inside a
  sandbox: the worst the agent can do is add unwanted items or remove its own.
- Nothing to start by hand: the server runs whenever Zotero is open.

## Non-goals

- Running code, shell commands or scripts on the host.
- Reading or writing arbitrary host files.
- Editing, moving or removing the user's own papers, notes, highlights or tags.
- Changing item metadata, collections (beyond filing a new import), saved
  searches or settings.
- Web/literature search (the agent has its own tools).
- A chat UI inside Zotero.
- Group libraries: every tool works on the personal library ("My Library") only.

## Hard rules

These are enforced by the plugin, not left to the agent.

1. **Ownership.** The plugin records every object it creates (notes,
   highlights, imported papers and their attachments) and every tag it adds
   (item + tag pair). Only recorded objects/pairs can be edited, removed or
   undone. Everything else is read-only. Once the user edits one of the
   agent's notes in Zotero, the note is the user's: `edit_note`, `trash` and
   `undo` of its creation or any of its edits are refused ("you edited this
   note in Zotero; it is now yours"), `byLLM` is false, and the same holds for
   its embedded images. An edit is a difference between the note's HTML and
   what the agent last wrote, compared in canonical form: formatting-only
   edits (underline, colours, image size) count; whitespace between blocks,
   attribute order and character escaping don't (Zotero 10's note editor
   doesn't rewrite the agent's notes on open). The take-over is recorded and
   permanent: the user reverting the edit doesn't hand the note back. While
   the plugin runs, a Zotero Notifier observer records it as soon as the note
   is saved; edits made while the plugin was disabled are noticed when a tool
   next looks at the note (a revert made in that time goes unnoticed). Tags
   the agent added to the note stay agent-owned pairs (separate objects).
   An owned tag pair the user removes in Zotero (while the plugin runs) stops
   being the agent's, so the user adding the same tag back owns it.
   Removing an object never takes the user's along: `trash`, and `undo` of a
   change that created objects, are refused while a target has a child (note,
   attachment, highlight on an attachment) that isn't the agent's; the error
   lists them.
2. **No green highlights.** Green is reserved for the user. `color` accepts
   only Zotero's named colors except green: yellow (default), red, blue,
   purple, magenta, orange, gray. Hex codes are rejected.
3. **Marking.** Notes the agent creates get the tag `[LLM]`. Highlight
   comments start with `[LLM]`. The tag is reserved: `add_tags` and
   `remove_tags` refuse it, so the agent can neither put it on the user's
   items nor strip it from its own notes.
4. **Imports by identifier only.** DOI, arXiv ID or PMID. No local file
   paths, no URLs (doi.org / arxiv.org links included). Optional target
   collection must already exist.
5. **Removal goes to the trash.** Never permanent deletion.
6. **The ownership registry and note version history live in Zotero's data
   on the host**, never in a location the sandbox can reach or write to via
   any tool.

## Architecture

```
Sandbox (Claude Code)                    Host
────────────────────                     ─────────────────────────────────
MCP client ──HTTP──► host.docker.internal:23119 ──► Zotero built-in HTTP server
                                                    └─ zotero-safe-mcp plugin
                                                       POST /safe-mcp        (MCP)
                                                       POST /safe-mcp/image
                                                       GET  /safe-mcp/pdf/<key>
```

- Bootstrap plugin (`.xpi`) for **Zotero 10.0.6** (the user's version; newer
  versions as they come). Registers endpoints on `Zotero.Server.Endpoints`.
- `POST /safe-mcp`: MCP over Streamable HTTP, JSON responses only (no SSE),
  stateless. Methods: `initialize`, `notifications/initialized`,
  `tools/list`, `tools/call`, `ping`. Batches are rejected (400, removed in
  MCP 2025-06-18); notifications get 202 with no body; `GET` gets 405.
- `POST /safe-mcp/image`: uploads one PNG or JPEG (raw bytes as the body;
  the bytes decide the type) for use in a note, returns an `imageId`. Images
  go through this endpoint, not tool arguments, so the agent never has to
  write the image out as text. Limits: 10 MB per image (413), at most 20
  unused uploads and 50 MB in total (429 with `Retry-After`). An id works
  once; unused uploads expire after 60 min and are discarded when Zotero
  quits.
- `GET /safe-mcp/pdf/<attachmentKey>`: streams the PDF file of an attachment
  in the library, so the agent can download it with `curl` instead of
  putting it into its context. Read-only; only serves files that belong to a
  Zotero attachment item. Keys must match `^[A-Z0-9]{8}$` (400 otherwise;
  404 for unknown, non-PDF or missing files; "PDF" means the stored content
  type is PDF and the file starts with `%PDF-`, within its first 1 KB as PDF
  readers allow).
- **Auth:** every request needs `Authorization: Bearer <token>`. The token is
  generated by the plugin on first run (32 random bytes, hex) and shown in
  the plugin's settings pane, which can also regenerate it. It only unlocks
  this plugin's tools, so leaking it into the sandbox is acceptable. Its
  purpose is to keep other local apps and web pages (cross-site requests to
  localhost) out. Requests carrying a browser `Origin` header are rejected
  as a second layer against cross-site calls (Zotero itself already drops
  them). Zotero's debug output, when the user turns it on, logs request
  headers including the token.
- **Rate limit:** write tools (including `undo`) are capped per minute
  (default 60, pref `extensions.zotero-safe-mcp.writesPerMinute`; an invalid
  value falls back to 60, never to unlimited). Over the cap they fail
  without side effects. Write tools run one at a time.
- Items are referred to by **item key** (stable across sync), not numeric ID.

## Tools

### Read

| Tool | Args | Returns |
|---|---|---|
| `search_library` | `query` (empty lists items), optional `collectionKey` (with subcollections), `tag` (exact), `limit` (default 25, max 100) | top-level items, newest first: key, type, title, creators, year, DOI, attachment keys; `total`, `truncated`. Quick search over all fields, tags, notes, annotations and full text; trashed items never |
| `get_item` | `itemKey` (also attachment/note keys) | metadata, attachments, child notes (keys), tags, collections, `parentKey`, `inTrash` |
| `list_collections` | — | collection tree: key, name, parent |
| `read_pdf_text` | `attachmentKey`, optional `pages` (`"1-3,7"`) | text per page (1-based PDF pages, not printed labels), from Zotero's full-text index, else extracted by Zotero's PDF worker |
| `get_pdf_url` | `attachmentKey` | URL for `GET /safe-mcp/pdf/<key>` (`http://host.docker.internal:<port>`, pref `pdfUrlBase` overrides) |
| `list_annotations` | `attachmentKey` (any file attachment) | key, type, color, text, comment, page label, page index, `byLLM` flag |
| `list_notes` | `itemKey` (child notes) or `collectionKey` (standalone notes) | key, title, content (Markdown), `byLLM` flag; trashed notes left out |
| `get_reader_state` | — | for the selected reader tab of the main window: item and attachment keys, reader type, current page (PDF only: index, label, count), selected text; `open: false` otherwise |
| `list_changes` | optional `limit` (default 20, max 200) | the agent's recent changes: `changeId`, tool, summary, `undone` flag |

### Write

| Tool | Args | Rules |
|---|---|---|
| `add_highlight` | `attachmentKey`, `text`, optional `page`, `occurrence`, `color`, `comment` | locates exact text in the PDF (may cross a page break); `page` = 1-based PDF page the passage starts on, `occurrence` counts on that page or in the whole PDF; color rule; comment prefixed `[LLM]`; recorded as owned |
| `create_note` | `markdown`, `parentItemKey` or `collectionKey` (standalone) | Markdown → Zotero note HTML; tag `[LLM]`; recorded as owned |
| `edit_note` | `noteKey`, `markdown` | owned, non-trashed notes the user hasn't edited only; previous version saved for undo; `[LLM]` tag kept |
| `add_tags` | `itemKey`, `tags[]` | any non-trashed item; `[LLM]` refused; each newly added pair recorded as owned (pairs that already existed are not); refused if every tag is already there |
| `remove_tags` | `itemKey`, `tags[]` | owned pairs only; all or nothing, the error lists the refused tags |
| `import_paper` | `identifier`, optional `collectionKey` | DOI / arXiv / PMID via Zotero's own translators; fetches PDF when Zotero can; new item + the notes and attachments the import itself created recorded as owned (never other children the item gets meanwhile); if an item with the same DOI / arXiv ID / PMID is already in the personal library (not in the trash), returns `{ duplicate: true, itemKey }` and imports, records and files nothing (the existing item is not added to `collectionKey`) |
| `trash` | `itemKeys[]` | owned items only (notes, highlights, imported papers), none with children of the user's → Zotero trash; all or nothing |
| `undo` | optional `changeId` (default: the agent's last change not yet undone) | reverses one owned change: trashes what was created, restores what was trashed, restores the previous note version, removes added tags, re-adds removed tags |

Every write returns a `changeId` that `undo` accepts. A change is undone at
most once; `undo` itself is not a change. Undo of a note edit is refused
while a later edit of that note is not undone, or if the note was changed in
Zotero since (formatting included), so it never discards the user's own
changes; the HTML it replaces is kept in `note_versions`. Undo that would
trash an object with children of the user's is refused.

`import_paper` waits at most 30 s for the lookup (then fails, nothing saved)
and 30 s for saving and attachments. Downloads still running after that
continue in the background and are recorded under the same `changeId`; the
result says `complete: false`.

### Note content

`create_note` and `edit_note` take Markdown, converted to Zotero note HTML:

- headings, bold, italics, lists, links, quotes, inline and block code
- tables
- math: `$...$` inline and `$$...$$` display, in the form Zotero's note
  editor renders
- links to papers: `[@itemKey]` becomes a Zotero citation linked to that
  item; unknown keys fail the call
- images: `![caption](image:<imageId>)` with an id from `POST /safe-mcp/image`,
  stored as an embedded image of the note. In `edit_note`, `image:<key>` of
  the note's own embedded images keeps them, so a note read with
  `list_notes` can be edited and passed back.

Unsupported Markdown is kept as plain text, never dropped. Raw HTML is
escaped, never passed through. Link URLs are limited to `http`, `https`,
`mailto` and `zotero` schemes.

The `byLLM` flag in read results comes from the ownership registry, never
from the `[LLM]` tag (the user can type that tag on anything).

## Highlight positioning

The hard part. `add_highlight` must turn an exact quoted passage into Zotero
annotation position rects on the right page.

- Glyph positions come from Zotero's bundled pdf.js (`getPageData`, the same
  chars the reader selects), loaded in the main window, so no reader tab is
  opened. Matching is tolerant of line breaks, hyphenation, whitespace and
  punctuation differences.
- If the passage isn't found, or matches more than once without
  `page`/`occurrence`, fail with a clear error. Never guess coordinates.
- Reuses llm-for-zotero's implementation (`src/agent/tools/write/annotatePdf.ts`,
  `src/services/pdf/`, `src/services/quotes/`). See License.

## Storage

`<Zotero data dir>/safe-mcp.sqlite`, attached to Zotero's database
(`Zotero.DB`) as `safemcp`, so each write and its record commit in one
transaction (`import_paper` excepted: Zotero's translators open their own).
Every table also has `libraryID`:

- `owned_objects(itemKey, kind, changeId, createdAt)`
- `owned_tags(itemKey, tag, changeId, createdAt)`
- `note_versions(seq, noteKey, html, changeId, savedAt)`: the HTML before
  each edit, and the HTML an undo of that edit replaced
- `agent_notes(noteKey, html, changeId, writtenAt, userEditedAt)`: what the
  agent last wrote into each note (create, edit, undo of an edit, notes of an
  import) and when the user took the note over (Hard rule 1)
- `changes(seq, changeId, tool, kind, args, data, summary, createdAt, undone, undoneAt)`

`kind` picks the undo handler; `data` holds what undo needs beyond the
other tables (e.g. a JSON copy of each highlight, bytes of images an edit
dropped).

## Setup (user, once)

1. Install the `.xpi` in Zotero (Tools → Plugins → Install from file).
2. Copy the token from the plugin's settings pane.
3. On the host, only if the sandbox's network is restricted:
   `sbx policy allow network localhost:23119`. (Verified 2026-10-21: the
   sandbox reaches Zotero 10.0.6 at `host.docker.internal:23119`.)
4. In the sandbox: `claude mcp add --transport http zotero http://host.docker.internal:23119/safe-mcp --header "Authorization: Bearer <token>"`.

To cut access quickly: `sbx policy rm network --resource localhost:23119`,
or regenerate the token.

## Testing

- Unit tests (outside Zotero) for: color rule, ownership checks, Markdown →
  note HTML, identifier validation, JSON-RPC handling.
- Integration tests (`npm run test:integration`) against a real headless
  Zotero 10.0.6: every tool and endpoint end to end.
- Manual test checklist in Zotero (`docs/manual-test-checklist.md`) for:
  each tool on a test library, refusal of every forbidden action (green,
  user's note, user's tag, user's paper, file path import, hex color), undo
  of each change type.

## Open questions

All answered; kept for the record.

- Can `get_reader_state` read the current selection from the reader
  reliably?
  **Answered (ticket 11):** yes, from the reader's internal selection state
  (`_selectionRanges` / selection popup), verified in Zotero 10.0.6; it is
  cleared when the selection is dismissed.
- Does trashing an annotation item behave like trashing a note (restorable),
  or is it deleted outright? If the latter, keep a copy for `undo`.
  **Answered (ticket 08):** restorable: `deleted = true` keeps it, though
  Zotero's Trash view doesn't list annotations (the plugin tells open readers
  to drop it). A JSON copy is kept anyway, so undo recreates the highlight
  with the same key if the user emptied the trash.
- Exact HTML Zotero 10's note editor expects for math, citations and
  embedded images (check against notes made by hand in Zotero).
  **Answered (ticket 03):** `<span class="math">$…$</span>`,
  `<pre class="math">$$…$$</pre>`, `<span class="citation" data-citation=…>`
  with `data-citation-items` on the `data-schema-version` wrapper, and
  `<img data-attachment-key=… width height>`; checked by opening the
  converter's output in Zotero 10.0.6's real note editor.

## License

AGPL-3.0. We reuse code from
[llm-for-zotero](https://github.com/yilewang/llm-for-zotero)
(AGPL-3.0) wherever it helps; the README credits it, and reused files keep a
header naming the source file.
