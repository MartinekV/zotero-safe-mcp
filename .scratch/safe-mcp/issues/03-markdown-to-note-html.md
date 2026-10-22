# 03: Markdown → Zotero note HTML converter

**What to build:** a pure module (no Zotero globals) converting Markdown to the HTML Zotero 10's note editor expects (SPEC: Note content): headings, emphasis, lists, links, quotes, inline/block code, tables, `$...$`/`$$...$$` math, `[@itemKey]` citations (resolved through an injected lookup; unknown keys throw), `![caption](image:<imageId>)` image placeholders (resolved through an injected lookup), unsupported Markdown kept as text. Also the reverse direction (note HTML → Markdown) used by `list_notes`.

Security: raw HTML in the Markdown is escaped, not passed through; link URLs restricted to `http`, `https`, `mailto`, `zotero` schemes.

**Blocked by:** 01 (for the build/test setup)

**Status:** resolved

- [x] Unit tests for every construct listed above, including escaping of raw HTML and rejection/neutralisation of `javascript:` links
- [x] Output format checked against the exploration notes on note-editor schema (math, citations, images)

## Comments

Built in `src/notes/`: `markdownToNoteHtml(markdown, { resolveCitation, resolveImage })` (async; throws
`ToolError` for unknown keys/ids and for unreadable `[@...]`) and `noteHtmlToMarkdown(html)`.
Math tokenizer adapted from llm-for-zotero (`src/notes/markdownMath.ts`). Dependencies: `marked`,
`htmlparser2`, `entities` (exact versions; ~195 KB minified together).

**SPEC open question (exact HTML for math, citations, embedded images): answered.**
`test/integration/note-html.itest.ts` stores the converter's output, opens it in Zotero 10.0.6's real
note editor (headless) and reads back `getDataSync().html`. Everything survives with the same meaning
(the editor's HTML reads back as the same Markdown): `<span class="math">$…$</span>`,
`<pre class="math">$$…$$</pre>`, tables (`<th>` first row in `<tbody>`, cells wrapped in `<p>`, math in
cells), `<span class="citation" data-citation=…>(<span class="citation-item">Carroll, 1871</span>)</span>`
with `data-citation-items` on the `<div data-schema-version="9">` wrapper (also in `<h1>`; Zotero
resolves the URI back to the item), and `<img data-attachment-key=… alt=…>` (the image attachment is not
erased when the note closes). The editor only adds formatting (newlines, `rel` on links, `;` in styles,
`&nbsp;` in code) and unwraps single `<p>` in list items.

For the tickets that wire this up:
- **04 (`resolveCitation`)**: return `{ uri: Zotero.URI.getItemURI(item), itemData:
  Zotero.Utilities.Item.itemToCSLJSON(item), label: Zotero.EditorInstanceUtilities._formatCitationItemPreview({ uris: [uri], itemData }) }`
  for regular items; null otherwise. `label` is plain text (the converter escapes it). Keys are only
  accepted as `^[A-Z0-9]{8}$`; `[@A; @B]` is one citation with two items; locators are rejected.
- **10 (`resolveImage`)**: return `{ attachmentKey, width, height }`. **Give width/height**: without
  them the editor measures the image on first open and *saves the note* (rewriting it in its own
  formatting). Ids must match `[A-Za-z0-9_-]+`.
- **05/10 (edit round trip)**: `noteHtmlToMarkdown` writes embedded images as
  `![alt](image:<attachmentKey>)`, so a note read with `list_notes` and passed back to `edit_note`
  references its existing images by attachment key. `resolveImage` in `edit_note` should accept the
  keys of the note's own embedded images as well as fresh upload ids, or images are lost on edit.
  Citations come back as `[@KEY]` (key only, so group-library citations are re-resolved by key).
- Conservative choices: links with other schemes (incl. relative URLs) and images with sources other
  than `image:` are kept as their Markdown text; inline math and images in headings stay text (the
  editor's heading node allows neither); reference/footnote definitions are kept as text; a malformed
  `[@...]` fails the call rather than being kept as text.
