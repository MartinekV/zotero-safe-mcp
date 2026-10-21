import { LLM_TAG } from "../config";
import { changeLog } from "../changes";
import { markdownToNoteHtml } from "../notes/markdownToNoteHtml";
import { noteLookups } from "../notes/zoteroLookups";
import { defineTool, ToolError } from "../registry/types";
import { KEY_PATTERN, libraryID, requireCollection, requireItem } from "../zotero/library";

type Args = { markdown: string; parentItemKey?: string; collectionKey?: string };

export default defineTool<Args>({
  name: "create_note",
  description:
    "Create a Zotero note from Markdown, either as a child note of an item (parentItemKey) or as a standalone note " +
    "in a collection (collectionKey); give exactly one. Supports headings, emphasis, lists, links, quotes, code, " +
    "tables, $math$ / $$display math$$ and [@itemKey] citations of library items (unknown keys fail the call). " +
    `The note is tagged ${LLM_TAG}. Returns the noteKey and a changeId for undo.`,
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["markdown"],
    properties: {
      markdown: { type: "string", minLength: 1, maxLength: 1_000_000, description: "Note content in Markdown" },
      parentItemKey: { type: "string", pattern: KEY_PATTERN, description: "Item to attach the note to" },
      collectionKey: { type: "string", pattern: KEY_PATTERN, description: "Collection for a standalone note" },
    },
  },
  async handler(args) {
    const { markdown, parentItemKey, collectionKey } = args;
    if ((parentItemKey === undefined) === (collectionKey === undefined)) {
      throw new ToolError("Give exactly one of parentItemKey (child note) or collectionKey (standalone note).");
    }
    const L = libraryID();
    let where: string;
    if (parentItemKey !== undefined) {
      const parent = requireItem(parentItemKey);
      if (!parent.isRegularItem()) {
        throw new ToolError(`${parentItemKey} is a ${parent.itemType}; notes can only be added to regular items.`);
      }
      if (parent.deleted) throw new ToolError(`${parentItemKey} is in the trash.`);
      where = `under ${parentItemKey}`;
    } else {
      requireCollection(collectionKey!);
      where = `in collection ${collectionKey}`;
    }
    const html = await markdownToNoteHtml(markdown, noteLookups());

    const { changeId, result } = await changeLog().recordWrite({ tool: "create_note", args }, async (w) => {
      const note = new Zotero.Item("note");
      note.libraryID = L;
      if (parentItemKey !== undefined) note.parentKey = parentItemKey;
      else note.setCollections([collectionKey!]);
      note.setNote(html);
      note.addTag(LLM_TAG, 0);
      await note.save();
      const title = note.getNoteTitle();
      w.ownObject({ libraryID: L, itemKey: note.key, kind: "note" });
      w.summary = `Created note ${note.key} "${title}" ${where}`;
      return { noteKey: note.key, title };
    });
    return { changeId, ...result };
  },
});
