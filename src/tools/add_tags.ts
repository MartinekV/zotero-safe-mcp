import { changeLog } from "../changes";
import { splitNewTags } from "../ownership/checks";
import { defineTool, ToolError } from "../registry/types";
import { TAG_LIST_SCHEMA, requireTaggableItem, tagNames } from "../tags/tagArgs";
import { KEY_PATTERN, libraryID } from "../zotero/library";

type Args = { itemKey: string; tags: string[] };

export default defineTool<Args>({
  name: "add_tags",
  description:
    "Add tags to any item in the library (paper, note, attachment, highlight). Tags are trimmed; names are " +
    "case-sensitive. Tags the item already has are left alone and not counted as yours, so remove_tags and undo " +
    "never touch them. The reserved tag [LLM] cannot be added. Returns the added tags and a changeId for undo.",
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
    const tags = tagNames(args.tags, "add");
    const item = requireTaggableItem(args.itemKey);
    const { added, alreadyPresent } = splitNewTags(
      item.getTags().map((t) => t.tag),
      tags,
    );

    if (!added.length) {
      throw new ToolError(`${item.key} already has ${tags.map((t) => JSON.stringify(t)).join(", ")}; nothing was changed.`);
    }

    const { changeId, result } = await changeLog().recordWrite({ tool: "add_tags", args }, async (w) => {
      // Only new names reach addTag: on an existing one it reports a change and turns automatic tags manual.
      for (const tag of added) {
        item.addTag(tag, 0);
        w.ownTag({ libraryID: L, itemKey: item.key, tag });
      }
      await item.save();
      w.summary = `Added ${added.map((t) => JSON.stringify(t)).join(", ")} to ${item.key}`;
      return { itemKey: item.key, added, alreadyPresent };
    });
    return { changeId, ...result };
  },
});
