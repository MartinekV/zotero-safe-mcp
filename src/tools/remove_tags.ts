import { quoteTags } from "../tags/quoteTags";
import { KEY_PATTERN } from "../config";
import { changeLog } from "../changes";
import { requireOwnedTagPairs } from "../ownership/checks";
import { defineTool } from "../registry/types";
import { TAG_LIST_SCHEMA, tagNames } from "../tags/tagArgs";
import type { RemoveTagsData } from "../changes/data";
import { libraryID, requireItem } from "../zotero/library";

type Args = { itemKey: string; tags: string[] };

export default defineTool<Args>({
  name: "remove_tags",
  description:
    "Remove tags that add_tags put on an item. Tags the item had before, or that the user added, are refused, and " +
    "then nothing is removed (the error lists them). Returns a changeId for undo.",
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemKey", "tags"],
    properties: {
      itemKey: { type: "string", pattern: KEY_PATTERN },
      tags: TAG_LIST_SCHEMA,
    },
  },
  async handler(args) {
    const L = libraryID();
    const tags = tagNames(args.tags, "remove");
    const item = requireItem(args.itemKey);
    requireOwnedTagPairs(item.key, tags, await changeLog().ownedTags(L, item.key));

    const { changeId, result } = await changeLog().recordWrite({ tool: "remove_tags", args }, async (w) => {
      const removed: string[] = [];
      const notPresent: string[] = [];
      for (const tag of tags) {
        // Owned but already gone (the user removed it): just forget the pair.
        (item.removeTag(tag) ? removed : notPresent).push(tag);
        w.disownTag({ libraryID: L, itemKey: item.key, tag });
      }
      if (removed.length) await item.save();
      const data: RemoveTagsData = { libraryID: L, itemKey: item.key, removed };
      w.data = data;
      w.summary = removed.length
        ? `Removed ${quoteTags(removed)} from ${item.key}`
        : `Forgot ${quoteTags(notPresent)} on ${item.key} (no longer on the item)`;
      return { itemKey: item.key, removed, notPresent };
    });
    return { changeId, ...result };
  },
});
