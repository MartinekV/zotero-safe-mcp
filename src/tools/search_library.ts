import { KEY_PATTERN, SEARCH_DEFAULT_LIMIT as DEFAULT_LIMIT, SEARCH_MAX_LIMIT as MAX_LIMIT } from "../config";
import { defineTool, ToolError } from "../registry/types";
import { asItemLike, libraryID, requireCollection, zoteroLibrary } from "../zotero/library";
import { summarizeItem } from "../zotero/serialize";


type Args = { query: string; collectionKey?: string; tag?: string; limit?: number };

export default defineTool<Args>({
  name: "search_library",
  description:
    "Search the library like Zotero's \"All Fields & Tags + full text\" quick search: every word of `query` must match " +
    "a field, creator, tag, note, annotation or the PDF's indexed text. Matches in notes, attachments and annotations " +
    "return their parent item. Empty `query` lists items. Optional `collectionKey` (subcollections included) and `tag` " +
    "(exact name) narrow the search. Returns top-level items, newest first: key, type, title, creators, year, DOI, " +
    `attachmentKeys; plus total and truncated. Trashed items are never returned. limit: default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.`,
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", maxLength: 500 },
      collectionKey: { type: "string", pattern: KEY_PATTERN },
      tag: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    },
  },
  async handler({ query, collectionKey, tag, limit = DEFAULT_LIMIT }) {
    const s = new Zotero.Search({ libraryID: libraryID() });
    if (query.trim()) s.addCondition("quicksearch-everything", "contains", query);
    if (collectionKey) {
      requireCollection(collectionKey);
      s.addCondition("collection", "is", collectionKey);
      s.addCondition("recursive", "true");
    }
    if (tag !== undefined) {
      if (!Zotero.Tags.getID(tag)) throw new ToolError(`No tag named "${tag}" in the library`);
      s.addCondition("tag", "is", tag);
    }

    const top = new Map<number, Zotero.Item>();
    for (const item of await Zotero.Items.getAsync(await s.search())) {
      const t = item.topLevelItem;
      if (!t.deleted) top.set(t.id, t);
    }
    const sorted = [...top.values()].sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : a.dateAdded > b.dateAdded ? -1 : 0));
    return {
      items: sorted.slice(0, limit).map((i) => summarizeItem(asItemLike(i), zoteroLibrary)),
      total: sorted.length,
      truncated: sorted.length > limit,
    };
  },
});
