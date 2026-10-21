import { defineTool } from "../registry/types";
import { libraryID } from "../zotero/library";

export default defineTool<Record<string, never>>({
  name: "list_collections",
  description:
    "All collections of the library as a flat tree (parents before their children): key, name and parentKey (null at top level).",
  write: false,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  handler() {
    const collections = Zotero.Collections.getByLibrary(libraryID(), true)
      .filter((c) => !c.deleted)
      .map((c) => ({ key: c.key, name: c.name, parentKey: c.parentKey || null }));
    return { collections };
  },
});
