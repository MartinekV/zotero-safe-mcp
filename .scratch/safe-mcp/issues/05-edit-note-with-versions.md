# 05: edit_note with version history and undo

**What to build:** `edit_note` for owned notes only; the previous HTML is saved to `note_versions` under the new `changeId`; `undo` of an edit restores the previous version. The `[LLM]` tag is kept on edit.

**Blocked by:** 04

**Status:** resolved

- [x] Editing a user's note is refused
- [x] Unit tests for version save/restore logic; undo of edit then undo of create works in order

## Comments

- **Built:** `src/tools/edit_note.ts`, undo handler `src/undo/edit_note.ts`; the logic is in
  `src/notes/noteVersions.ts` (`editNote` = recordWrite body, `editNoteUndoHandler`) behind a `NoteStore`
  (`src/notes/zoteroNotes.ts`), unit-tested against real SQLite + fake notes (`test/unit/note-versions.test.ts`),
  end to end in `test/integration/edit_note.itest.ts`. The [LLM] tag is untouched by an edit.
- **Images (ticket 03 comment):** `image:KEY` in edit_note accepts the note's own embedded-image attachments
  (kept with their current width/height), so list_notes → edit_note keeps images; anything else falls through to
  `noteLookups().resolveImage` (ticket 10 plugs upload ids in there).
- **Images and undo (notes/05 cleanup trap):** when an edit drops images, their bytes (base64) are stored in the
  change's `data`. Undo restores the old HTML; an image Zotero has since erased (`deleteUnusedEmbeddedImages` on
  note close) is re-imported from those bytes under a **new attachment key** and the restored HTML is rewritten to
  it (summary says `re-imported image OLD as NEW`). An image already gone at edit time is reported as missing.
  `importEmbeddedImage` in `zoteroNotes.ts` is Zotero's version without its own transaction; ticket 10 can reuse it.
- **Conservative choices:** undo of an edit is refused (1) while a later, not-undone edit of the same note exists
  ("undo X first"), and (2) if the note was changed in Zotero after the edit (compared as Markdown, so the note
  editor's reformatting doesn't count), so undo never discards the user's own changes. Undo of an edit of a note
  that no longer exists succeeds with "nothing restored"; of a trashed note restores the HTML (so out-of-order
  undo after undo of create still works). edit_note refuses trashed notes and non-notes; ownership is checked
  before anything else.
