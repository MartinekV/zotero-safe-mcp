import { defineTool } from "../registry/types";
import { asItemLike, KEY_PATTERN, requireItem, zoteroLibrary } from "../zotero/library";
import { describeItem } from "../zotero/serialize";

export default defineTool<{ itemKey: string }>({
  name: "get_item",
  description:
    "One library item by key: metadata fields, creators, year, DOI, attachments (key, title, content type), " +
    "child note keys, tags and collections. Also works for attachment and note keys (parentKey is set).",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemKey"],
    properties: { itemKey: { type: "string", pattern: KEY_PATTERN, description: "8-character Zotero item key" } },
  },
  handler({ itemKey }) {
    return describeItem(asItemLike(requireItem(itemKey)), zoteroLibrary);
  },
});
