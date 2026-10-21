import { changeLog } from "../changes";
import { LLM_TAG } from "../config";
import { embeddedImages } from "../notes/embeddedImages";
import { markdownToNoteHtml, type NoteLookups } from "../notes/markdownToNoteHtml";
import { editNote, type NoteLike } from "../notes/noteVersions";
import { noteLookups, withImages } from "../notes/zoteroLookups";
import { embeddedImageAttachment, zoteroNoteStore } from "../notes/zoteroNotes";
import { requireOwned } from "../ownership/checks";
import { defineTool, ToolError } from "../registry/types";
import { KEY_PATTERN, libraryID, requireItem } from "../zotero/library";

type Args = { noteKey: string; markdown: string };

export default defineTool<Args>({
  name: "edit_note",
  description:
    "Replace the content of a note this plugin created with new Markdown (same syntax as create_note). Notes made " +
    "by the user are refused. To change part of a note, read it with list_notes, edit that Markdown and pass all of " +
    "it: its ![alt](image:KEY) references keep the note's existing images; add new ones with " +
    "![caption](image:<imageId>) from POST /safe-mcp/image. The previous version is kept; undo " +
    `with the returned changeId restores it. The ${LLM_TAG} tag stays.`,
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["noteKey", "markdown"],
    properties: {
      noteKey: { type: "string", pattern: KEY_PATTERN, description: "A note created by this plugin" },
      markdown: { type: "string", minLength: 1, maxLength: 1_000_000, description: "The note's new full content in Markdown" },
    },
  },
  async handler(args) {
    const { noteKey, markdown } = args;
    const L = libraryID();
    const note = requireItem(noteKey);
    requireOwned([noteKey], await changeLog().ownedKeys(L, [noteKey]), "edit");
    if (!note.isNote()) throw new ToolError(`${noteKey} is a ${note.itemType}, not a note.`);
    if (note.deleted) throw new ToolError(`Note ${noteKey} is in the trash; nothing was changed.`);

    const lookups = noteLookups();
    const html = await markdownToNoteHtml(markdown, ownImagesFirst(note, lookups));
    const { changeId, result } = await changeLog().recordWrite({ tool: "edit_note", args }, async (w) => {
      await editNote(w, L, note as unknown as NoteLike, html, zoteroNoteStore);
      const imageKeys = await lookups.importImages(note);
      const title = note.getNoteTitle();
      w.summary = `Edited note ${noteKey} "${title}"${withImages(imageKeys)}`;
      return { noteKey, title, ...(imageKeys.length ? { imageKeys } : {}) };
    });
    lookups.consumeUploads();
    return { changeId, ...result };
  },
});

/** `image:KEY` for one of the note's own embedded images keeps that image (and the size it has now). */
function ownImagesFirst(note: Zotero.Item, lookups: NoteLookups): NoteLookups {
  const sizes = embeddedImages(note.getNote());
  return {
    ...lookups,
    resolveImage(id) {
      const att = embeddedImageAttachment(note.libraryID, id);
      if (att && att.parentID === note.id) return { attachmentKey: id, ...sizes.get(id) };
      return lookups.resolveImage(id);
    },
  };
}
