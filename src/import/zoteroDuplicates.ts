// Zotero side of import_paper's duplicate check: candidate items whose field values contain the
// identifier (SQL LIKE, case-insensitive for ASCII), then the exact rules in duplicates.ts.
import { type Duplicate, findDuplicate } from "./duplicates";
import type { Identifier } from "./identifier";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function findExistingPaper(libraryID: number, id: Identifier): Promise<Duplicate | null> {
  const ids = ((await Zotero.DB.columnQueryAsync(
    "SELECT DISTINCT I.itemID FROM items I JOIN itemData D USING (itemID) JOIN itemDataValues V USING (valueID) " +
      "WHERE I.libraryID = ? AND V.value LIKE ? ESCAPE '\\'",
    [libraryID, `%${likeEscape(id.value)}%`],
  )) || []) as number[];
  if (!ids.length) return null;
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  await Zotero.Items.loadDataTypes(items, ["primaryData", "itemData"]);
  const field = (i: Zotero.Item, name: string) => {
    try {
      return String(i.getField(name) ?? "");
    } catch {
      return ""; // field not valid for this item type
    }
  };
  return findDuplicate(
    items.map((i) => ({
      key: i.key,
      deleted: !!i.deleted,
      regular: i.isRegularItem(),
      dateAdded: i.dateAdded,
      fields: { DOI: field(i, "DOI"), extra: field(i, "extra"), url: field(i, "url"), archiveID: field(i, "archiveID") },
    })),
    id,
  );
}
