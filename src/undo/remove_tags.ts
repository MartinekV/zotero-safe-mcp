// Undo of remove_tags: puts back the tags it removed and owns them again (under the undone change).
// A tag the item has again by then (the user re-added it) is left alone and stays the user's.
import type { UndoHandler } from "../changes/types";

export type RemoveTagsData = { libraryID: number; itemKey: string; removed: string[] };

const handler: UndoHandler = {
  kind: "remove_tags",
  async undo(change, ctx) {
    const { libraryID, itemKey, removed } = change.data as RemoveTagsData;
    const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
    if (!item) return `Nothing restored: ${itemKey} no longer exists`;
    const restored = removed.filter((tag) => !item.hasTag(tag));
    for (const tag of restored) {
      item.addTag(tag, 0);
      await ctx.ownTag({ libraryID, itemKey, tag });
    }
    if (restored.length) await item.save();
    return restored.length
      ? `Restored ${restored.map((t) => JSON.stringify(t)).join(", ")} on ${itemKey}`
      : `Nothing restored: ${itemKey} already has the tags again`;
  },
};
export default handler;
