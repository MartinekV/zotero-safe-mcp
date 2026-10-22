// Undo of add_tags: removes the pairs that change still owns (a pair removed since, by remove_tags or
// a later add_tags taking it over, is no longer the change's) and forgets them.
import { quoteTags } from "../tags/quoteTags";
import type { OwnedTag, UndoHandler } from "../changes/types";

const handler: UndoHandler = {
  kind: "add_tags",
  async undo(change, ctx) {
    const byItem = new Map<string, OwnedTag[]>();
    for (const t of change.tags) {
      const k = `${t.libraryID}/${t.itemKey}`;
      byItem.set(k, [...(byItem.get(k) ?? []), t]);
    }
    const parts: string[] = [];
    for (const pairs of byItem.values()) {
      const { libraryID, itemKey } = pairs[0];
      const item = Zotero.Items.getByLibraryAndKey(libraryID, itemKey);
      const removed: string[] = [];
      for (const t of pairs) {
        if (item && item.removeTag(t.tag)) removed.push(t.tag);
        await ctx.disownTag(t);
      }
      if (item && removed.length) await item.save();
      if (removed.length) parts.push(`Removed ${quoteTags(removed)} from ${itemKey}`);
    }
    return parts.join("; ") || "Nothing to remove: the tags are no longer on the item";
  },
};
export default handler;
