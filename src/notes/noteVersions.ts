// edit_note's version history: the edit saves the note's previous HTML (note_versions) under its
// changeId; undo restores it. Zotero is behind NoteStore (src/notes/zoteroNotes.ts), so this runs
// against fakes in unit tests.
import { SCHEMA } from "../changes/changeLog";
import type { ChangeRecord, ChangeWriter, Db, UndoHandler } from "../changes/types";
import { ToolError } from "../registry/types";
import { embeddedImages, replaceImageKeys } from "./embeddedImages";
import { noteHtmlToMarkdown } from "./noteHtmlToMarkdown";

export type NoteLike = {
  key: string;
  getNote(): string;
  setNote(html: string): unknown;
  /** Inside the surrounding transaction: never saveTx(). */
  save(): Promise<unknown>;
};

/** An embedded image's bytes, kept with an edit that dropped it (Zotero erases unreferenced images). */
export type SavedImage = { attachmentKey: string; contentType: string; base64: string };

export type NoteStore = {
  getNote(libraryID: number, key: string): NoteLike | null;
  /** Whether the embedded-image attachment still exists. */
  imageExists(libraryID: number, attachmentKey: string): boolean;
  /** The image's bytes, or null if the attachment or its file is gone. */
  readImage(libraryID: number, attachmentKey: string): Promise<SavedImage | null>;
  /** Re-creates the image as an embedded-image attachment of the note, without opening a transaction; returns its new key. */
  importImage(note: NoteLike, image: SavedImage): Promise<string>;
};

/** What an edit stores with its change for undo. */
export type EditNoteData = {
  libraryID: number;
  noteKey: string;
  /** The HTML the edit wrote (to detect later changes made in Zotero). */
  html: string;
  /** Images the previous version showed and the new one doesn't: Zotero may erase them. */
  droppedImages: SavedImage[];
};

/** recordWrite body of edit_note: saves the previous version, then writes `html`. */
export async function editNote(w: ChangeWriter, libraryID: number, note: NoteLike, html: string, store: NoteStore): Promise<void> {
  const previous = note.getNote();
  const kept = embeddedImages(html);
  const droppedImages: SavedImage[] = [];
  for (const key of embeddedImages(previous).keys()) {
    if (kept.has(key)) continue;
    const image = await store.readImage(libraryID, key);
    if (image) droppedImages.push(image);
  }
  w.saveNoteVersion({ libraryID, noteKey: note.key, html: previous });
  note.setNote(html);
  await note.save();
  const data: EditNoteData = { libraryID, noteKey: note.key, html, droppedImages };
  w.data = data;
  w.summary = `Edited note ${note.key}`;
}

export function editNoteUndoHandler(store: NoteStore): UndoHandler {
  return {
    kind: "edit_note",
    async undo(change: ChangeRecord, ctx) {
      const [version] = change.noteVersions;
      const later = await laterEdits(ctx.db, change.changeId, version.libraryID, version.noteKey);
      if (later.length) {
        throw new ToolError(
          `Note ${version.noteKey} was edited again after ${change.changeId}: undo ${later.join(", ")} first. Nothing was changed.`,
        );
      }
      const data = change.data as EditNoteData;
      const note = store.getNote(version.libraryID, version.noteKey);
      if (!note) return `Note ${version.noteKey} no longer exists; nothing restored`;
      // Compared as Markdown: the note editor rewrites the HTML's formatting on open, not its content.
      if (noteHtmlToMarkdown(note.getNote()) !== noteHtmlToMarkdown(data.html)) {
        throw new ToolError(
          `Note ${version.noteKey} was changed in Zotero after ${change.changeId}; undoing the edit would discard ` +
            "those changes. Nothing was changed; use edit_note to change it instead.",
        );
      }
      // Images Zotero erased after the edit dropped them come back from the bytes kept with the change.
      const renamed = new Map<string, string>();
      const missing: string[] = [];
      for (const key of embeddedImages(version.html).keys()) {
        if (store.imageExists(version.libraryID, key)) continue;
        const saved = data.droppedImages?.find((i) => i.attachmentKey === key);
        if (saved) renamed.set(key, await store.importImage(note, saved));
        else missing.push(key);
      }
      note.setNote(replaceImageKeys(version.html, renamed));
      await note.save();
      const parts = [`Restored note ${version.noteKey} to its version before ${change.changeId}`];
      for (const [from, to] of renamed) parts.push(`re-imported image ${from} as ${to}`);
      if (missing.length) parts.push(`image${missing.length === 1 ? "" : "s"} ${missing.join(", ")} no longer exist${missing.length === 1 ? "s" : ""}`);
      return parts.join("; ");
    },
  };
}

/** Changes after `changeId` that saved a version of the same note and are not undone, newest first. */
async function laterEdits(db: Db, changeId: string, libraryID: number, noteKey: string): Promise<string[]> {
  const rows = await db.queryAsync(
    `SELECT DISTINCT c.changeId, c.seq FROM ${SCHEMA}.changes c JOIN ${SCHEMA}.note_versions v ON v.changeId = c.changeId
     WHERE v.libraryID = ? AND v.noteKey = ? AND c.undone = 0
       AND c.seq > (SELECT seq FROM ${SCHEMA}.changes WHERE changeId = ?)
     ORDER BY c.seq DESC`,
    [libraryID, noteKey, changeId],
  );
  return rows.map((r) => r.changeId as string);
}
