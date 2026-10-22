# Manual test checklist

Run before a release, in a real Zotero with the built `.xpi`. The headless suite
(`npm run test:integration`) covers the same tools automatically; this list checks what only a real
desktop shows: the settings pane, the reader, the Trash view, the sandbox connection.

## 0. Setup: a throwaway library

Don't test in your real library. Use a separate Zotero profile with its own data directory:

1. Quit Zotero. Start it with the profile manager: `zotero -P` (macOS:
   `/Applications/Zotero.app/Contents/MacOS/zotero -P`). Create a profile `safe-mcp-test` and start it.
2. Settings → Advanced → Files and Folders → Data Directory Location → Custom: an empty folder
   (e.g. `~/Zotero-safe-mcp-test`). Restart when asked.
3. Tools → Plugins → gear → Install Plugin From File… → `zotero-safe-mcp.xpi`.
4. Add test data **by hand** (these are "the user's" items):
   - a collection `Test` with a subcollection `Sub`
   - a paper with a PDF (drag a PDF in; let Zotero fetch metadata), filed in `Test`; note its key
     (right-click → Copy item link, or `search_library`)
   - a child note on that paper written by you, and a tag `mine` on the paper
   - a green and a yellow highlight of your own in the PDF

In the sandbox, set up the helper used below (`$T` = token from Settings → Safe MCP):

```bash
export T=<token> Z=http://host.docker.internal:23119
mcp() { curl -s --noproxy '*' -H "Authorization: Bearer $T" -H 'Content-Type: application/json' "$Z/safe-mcp" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":${2:-{\}}}}"; echo; }
```

(Or register the server with `claude mcp add …` and ask Claude Code to make each call. Do both at least
once: the `claude mcp add` path is what users run.)

Tick each box when it behaves as described. "Refused" means an `isError` result with a clear message
**and no change visible in Zotero**.

## 1. Plugin, settings pane, transport

- [ ] Settings → **Safe MCP** shows the endpoint URL and a token; **Copy token** and **Copy command**
      copy them; the copied command works as-is in the sandbox (`claude mcp add …`, then `/mcp` lists 17 tools).
- [ ] No token → 401; wrong token → 401: `curl -s -o /dev/null -w '%{http_code}' -X POST $Z/safe-mcp -H 'Content-Type: application/json' -d '{}'`
- [ ] A request with `-H 'Origin: https://example.org'` gets no answer or 403, never a tool result.
- [ ] `GET $Z/safe-mcp` with the token → 405.
- [ ] **Regenerate token**: the old token gets 401 at once, the new one works.
- [ ] Tools → Plugins → disable the plugin: `/safe-mcp` → 404. Enable: works again, same token.
- [ ] Quit and restart Zotero: works without doing anything.

## 2. Read tools

- [ ] `search_library {"query":"<word from the title>"}` finds the paper; `{"query":"","collectionKey":"<Test>"}`
      lists items of `Test` and `Sub`; `{"query":"","tag":"mine"}` finds the paper; an unknown tag is refused.
- [ ] `get_item {"itemKey":"<paper>"}`: metadata, PDF attachment key, child note key, tag `mine`, collection.
      An unknown key is refused.
- [ ] `list_collections`: `Test` and `Sub` with the right parent.
- [ ] `read_pdf_text {"attachmentKey":"<pdf>","pages":"1-2"}`: text of pages 1-2.
- [ ] `get_pdf_url`, then `curl -H "Authorization: Bearer $T" -o x.pdf <url>` gives the same file
      (`cmp` with the original). Without the token → 401. `$Z/safe-mcp/pdf/../../etc` → 400 or 404.
      A text file attached and renamed `x.pdf` (stored as PDF but no `%PDF-` header) → 404.
- [ ] `list_annotations {"attachmentKey":"<pdf>"}`: your two highlights with their colors, `byLLM: false`.
- [ ] `list_notes {"itemKey":"<paper>"}`: your note as Markdown, `byLLM: false`.
- [ ] `get_reader_state` with the library tab selected → `open: false`. Open the PDF, go to page 3,
      select a sentence → item and attachment keys, page label 3, the selected text. Click elsewhere →
      `selectedText: null`.
- [ ] `list_changes` → empty list (before any write).

## 3. Write tools and undo of each change type

For each: check the result in Zotero, then `undo {"changeId":"<id>"}` and check it is reversed.
`list_changes` shows every change, and `undone: true` after its undo.

- [ ] **create_note** child note: `{"parentItemKey":"<paper>","markdown":"# T\n\n**b** *i* $x^2$\n\n$$\\int f$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee [@<paper>].\n\n<script>x</script>"}`.
      In Zotero: tag `[LLM]`, heading, bold/italic, math renders, table, citation linked to the paper,
      `<script>` shown as text. Open and close the note editor: nothing changes.
      → **undo**: the note is in the Trash; restoring it works.
- [ ] **create_note** standalone with an image: upload a PNG (README `curl`), then
      `{"collectionKey":"<Test>","markdown":"![fig](image:<imageId>)"}` → the image shows in the note.
      Reusing the same `imageId` is refused. A text file as an image → 415.
- [ ] **edit_note** on that note (read it with `list_notes`, change the text, keep the image reference):
      new text, image still there, `[LLM]` tag still there.
      → **undo**: previous text back. Open and close the note in Zotero's editor without typing:
      `list_notes` still says `byLLM: true` and `edit_note` still works.
- [ ] **add_tags** `{"itemKey":"<paper>","tags":["agent-tag","mine"]}`: `agent-tag` added, `mine`
      reported as already present.
      → **undo**: `agent-tag` gone, `mine` still there.
- [ ] **remove_tags** of `agent-tag` (add it again first): gone.
      → **undo**: `agent-tag` back.
- [ ] **add_highlight** `{"attachmentKey":"<pdf>","text":"<a sentence from read_pdf_text, spanning a line break>","color":"blue","comment":"why"}`:
      blue highlight exactly over the sentence (open the PDF), comment `[LLM] why`, `list_annotations`
      shows `byLLM: true`. A passage that occurs twice without `page`/`occurrence` is refused; with
      `occurrence` it works.
      → **undo**: the highlight disappears from the open reader.
- [ ] **import_paper** `{"identifier":"10.1038/nature12373","collectionKey":"<Test>"}`: item in `Test`,
      PDF attached (if Zotero can find one). `arXiv:1706.03762` and a PMID (`23193287`) work too.
      → **undo**: the item and its attachments are in the Trash.
- [ ] **trash** `{"itemKeys":["<agent note>","<agent highlight>","<imported paper>"]}`: all in the Trash
      (highlights don't show in Zotero's Trash view; they vanish from the PDF).
      → **undo**: all restored, the highlight is back in the PDF.
- [ ] `undo` without `changeId` reverses the most recent not-yet-undone change; undoing the same change
      twice is refused.

## 4. Forbidden actions (each must be refused, nothing changes)

- [ ] Green highlight: `add_highlight … "color":"green"`.
- [ ] Hex color: `add_highlight … "color":"#ff0000"` (also `"#5fb236"`).
- [ ] Editing your note: `edit_note {"noteKey":"<your note>","markdown":"x"}`.
- [ ] A note of the agent's that you edited: have the agent create a note (with an uploaded image) and edit
      it, then type a word into it in Zotero. `edit_note`, `trash` of the note, and `undo` of
      the edit and of the creation are refused with "you edited this note in Zotero; it is now yours";
      `list_notes` shows `byLLM: false`. Delete your word again: still refused. `remove_tags` of a tag the
      agent added to that note still works.
- [ ] Formatting only: have the agent create and edit another note, then only underline a word (or colour
      it) in Zotero, and delete nothing. `undo` of the edit is refused and your underline stays.
- [ ] A note you edited and reverted before the agent looked: have the agent create a note, type a word into
      it, close the editor, delete the word again. `edit_note` of it is refused.
- [ ] Your additions to the agent's paper: import a paper with a PDF, then add your own child note to it and a
      highlight in its PDF. `trash` of the paper, `trash` of the PDF and `undo` of the import are refused and
      name your note and highlight; nothing goes to the Trash.
- [ ] Trashing your note, your highlight, your paper and its PDF: `trash` with each key, and once with one
      of yours mixed into a list of the agent's (nothing at all is trashed).
- [ ] Removing your tag: `remove_tags {"itemKey":"<paper>","tags":["mine"]}`.
- [ ] Removing a tag you added by hand after the agent added the same name earlier (add `t2` via
      `add_tags`, `remove_tags` it, add `t2` by hand) → `remove_tags t2` refused.
- [ ] Same, but you remove the agent's tag yourself: `add_tags t3`, remove `t3` by hand in Zotero, add `t3`
      by hand again → `remove_tags t3` refused, and `undo` of the `add_tags` leaves `t3` on the item.
- [ ] `[LLM]` tag: `add_tags` with `[LLM]` on your paper; `remove_tags` of `[LLM]` from the agent's note.
- [ ] File path import: `import_paper` with `/Users/me/paper.pdf`, `file:///tmp/x.pdf`, `C:\x.pdf`.
- [ ] URL import: `https://doi.org/10.1038/nature12373`, `https://arxiv.org/abs/1706.03762`.
- [ ] Two identifiers in one call; an ISBN; a title.
- [ ] Unknown `collectionKey` for `import_paper` / `create_note` (nothing is imported).
- [ ] `javascript:` link in `create_note` Markdown: kept as text, not a link.
- [ ] Undo of a change that is already undone.

## 5. Limits

- [ ] Rate limit: set `extensions.zotero-safe-mcp.writesPerMinute` to `3` (Config Editor), make 4
      `add_tags` calls within a minute → the 4th is refused and changes nothing; read tools still work.
      Set it back to `30`.
- [ ] An image over 10 MB → 413.
- [ ] Importing a paper that is already in the library (same DOI / arXiv ID / PMID, not in the trash) returns
      the existing item's key and imports nothing; with the existing copy in the trash, it is imported again.

## 6. Clean up

- [ ] Note in Zotero's debug output (Help → Debug Output Logging, if you enabled it) that the token appears
      in request headers; regenerate the token afterwards.
- [ ] Quit Zotero, start it again with your normal profile (`zotero -P`), and check your real library is
      untouched. Delete the test profile and its data folder if you like.
