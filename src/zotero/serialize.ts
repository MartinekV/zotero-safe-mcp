// How library items are shown to the agent. One module for every read tool, so all tools
// describe an item the same way. Works on the small `ItemLike` surface of Zotero.Item so it can
// be unit-tested with fake items.

/** The part of Zotero.Item this module reads. */
export type ItemLike = {
  id: number;
  key: string;
  itemType: string;
  deleted: boolean;
  parentKey: string | false;
  getField(name: string): string;
  getCreatorsJSON(): { firstName?: string; lastName?: string; name?: string; creatorType: string }[];
  /** Child attachment / note item IDs (trashed ones excluded). */
  getAttachments(): number[];
  getNotes(): number[];
  getTags(): { tag: string; type?: number }[];
  /** Collection IDs. */
  getCollections(): number[];
  getNoteTitle(): string;
  /** Names of the fields that have a value (Zotero: `getUsedFields(true)`). */
  getUsedFields(asNames: true): string[];
  attachmentContentType?: string;
};

/** Resolves IDs to objects (Zotero.Items.get / Zotero.Collections.get in the plugin). */
export type Library = {
  item(id: number): ItemLike | false;
  collection(id: number): { key: string; name: string; deleted?: boolean } | false;
};

export type Creator = { name: string; type: string };

export type ItemSummary = {
  key: string;
  type: string;
  title: string;
  creators: Creator[];
  year: string;
  DOI: string;
  attachmentKeys: string[];
};

export function summarizeItem(item: ItemLike, lib: Library): ItemSummary {
  return {
    key: item.key,
    type: item.itemType,
    title: item.itemType === "note" ? item.getNoteTitle() : item.getField("title"),
    creators: item.getCreatorsJSON().map((c) => ({
      name: c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" "),
      type: c.creatorType,
    })),
    year: item.getField("year"),
    DOI: item.getField("DOI") || doiFromExtra(item.getField("extra")),
    attachmentKeys: childKeys(item.getAttachments(), lib),
  };
}

/** Zotero keeps a DOI in Extra ("DOI: 10.x/y") for item types that have no DOI field. */
function doiFromExtra(extra: string): string {
  const m = /^\s*DOI:\s*(10\.\S+)\s*$/im.exec(extra);
  return m ? m[1] : "";
}

function children(ids: number[], lib: Library): ItemLike[] {
  const out: ItemLike[] = [];
  for (const id of ids) {
    const child = lib.item(id);
    if (child && !child.deleted) out.push(child);
  }
  return out;
}

function childKeys(ids: number[], lib: Library): string[] {
  return children(ids, lib).map((c) => c.key);
}

export type ItemDetail = Omit<ItemSummary, "attachmentKeys"> & {
  /** Key of the parent item for attachments, notes and annotations; null for top-level items. */
  parentKey: string | null;
  inTrash: boolean;
  /** Every other non-empty field (publicationTitle, date, abstractNote, url, extra, ...). */
  fields: Record<string, string>;
  attachments: { key: string; title: string; contentType: string }[];
  noteKeys: string[];
  tags: string[];
  collections: { key: string; name: string }[];
};

/** Fields already shown at the top level of a summary. */
const SUMMARY_FIELDS = new Set(["title", "year", "DOI"]);

export function describeItem(item: ItemLike, lib: Library): ItemDetail {
  const { attachmentKeys: _, ...summary } = summarizeItem(item, lib);
  const fields: Record<string, string> = {};
  for (const name of item.getUsedFields(true)) {
    if (SUMMARY_FIELDS.has(name)) continue;
    const value = item.getField(name);
    if (value) fields[name] = value;
  }
  return {
    ...summary,
    parentKey: item.parentKey || null,
    inTrash: item.deleted,
    fields,
    attachments: children(item.getAttachments(), lib).map((a) => ({
      key: a.key,
      title: a.getField("title"),
      contentType: a.attachmentContentType ?? "",
    })),
    noteKeys: childKeys(item.getNotes(), lib),
    tags: item.getTags().map((t) => t.tag),
    collections: item.getCollections().flatMap((id) => {
      const c = lib.collection(id);
      return c && !c.deleted ? [{ key: c.key, name: c.name }] : [];
    }),
  };
}
