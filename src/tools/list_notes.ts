import { requireExactlyOne } from "../registry/args";
import { KEY_PATTERN } from "../config";
import { agentOwnedKeys } from "../ownership/agentOwned";
import { noteHtmlToMarkdown } from "../notes/noteHtmlToMarkdown";
import { defineTool, ToolError } from "../registry/types";
import { libraryID, requireCollection, requireItem } from "../zotero/library";

type Args = { itemKey?: string; collectionKey?: string };

export default defineTool<Args>({
  name: "list_notes",
  description:
    "Notes with their content as Markdown: the child notes of an item (itemKey; a note's own key returns that note), " +
    "or the standalone notes in a collection (collectionKey). Give exactly one. byLLM is true only for notes this " +
    "plugin created (from its registry, not from the [LLM] tag) and the user hasn't edited in Zotero since. Trashed notes are left out.",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      itemKey: { type: "string", pattern: KEY_PATTERN, description: "Item whose child notes to list, or a note key" },
      collectionKey: { type: "string", pattern: KEY_PATTERN, description: "Collection whose standalone notes to list" },
    },
  },
  async handler({ itemKey, collectionKey }) {
    requireExactlyOne(itemKey, collectionKey, "Give exactly one of itemKey (child notes of an item) or collectionKey (standalone notes).");
    let notes: Zotero.Item[];
    if (itemKey !== undefined) {
      const item = requireItem(itemKey);
      notes = item.isNote() ? [item] : (Zotero.Items.get(item.getNotes()) as Zotero.Item[]);
    } else {
      notes = (requireCollection(collectionKey!).getChildItems(false, false) as Zotero.Item[]).filter(
        (i) => i.isNote() && !i.parentKey,
      );
    }
    notes = notes.filter((n) => n && !n.deleted);
    const owned = await agentOwnedKeys(libraryID(), notes.map((n) => n.key));
    return {
      notes: notes.map((n) => ({
        key: n.key,
        parentKey: n.parentKey || null,
        title: n.getNoteTitle(),
        content: noteHtmlToMarkdown(n.getNote()),
        byLLM: owned.has(n.key),
      })),
    };
  },
});
