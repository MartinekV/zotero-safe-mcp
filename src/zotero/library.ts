// Zotero lookups shared by the read tools: the user library only, items and collections by key.
import { ToolError } from "../registry/types";
import type { ItemLike, Library } from "./serialize";

/** Item and collection keys as the spec accepts them in tool arguments. */
export const KEY_PATTERN = "^[A-Z0-9]{8}$";

export function libraryID(): number {
  return Zotero.Libraries.userLibraryID;
}

/** Resolves IDs for ./serialize.ts. */
export const zoteroLibrary: Library = {
  item: (id) => (Zotero.Items.get(id) as unknown as ItemLike) || false,
  collection: (id) => Zotero.Collections.get(id) || false,
};

/** The item with this key, trashed ones included; ToolError if there is none. */
export function requireItem(key: string): Zotero.Item {
  const item = Zotero.Items.getByLibraryAndKey(libraryID(), key);
  if (!item) throw new ToolError(`No item with key ${key} in the library`);
  return item;
}

/** The collection with this key (not trashed); ToolError if there is none. */
export function requireCollection(key: string): Zotero.Collection {
  const col = Zotero.Collections.getByLibraryAndKey(libraryID(), key);
  if (!col || col.deleted) throw new ToolError(`No collection with key ${key} (see list_collections)`);
  return col;
}

export function asItemLike(item: Zotero.Item): ItemLike {
  return item as unknown as ItemLike;
}
