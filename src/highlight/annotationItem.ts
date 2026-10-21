// Saving highlight annotations inside recordWrite / undo transactions, and the JSON copy kept for undo.
// Zotero.Annotations.saveFromJSON would do the same but calls saveTx() (nested transaction → deadlock),
// so this mirrors its field order with item.save().

/** Everything needed to recreate an annotation (e.g. after the user emptied the trash). */
export type AnnotationSnapshot = {
  libraryID: number;
  key: string;
  parentKey: string;
  type: string;
  text: string | null;
  comment: string | null;
  color: string | null;
  pageLabel: string | null;
  sortIndex: string;
  position: string;
  tags: string[];
};

export function annotationSnapshot(item: Zotero.Item): AnnotationSnapshot {
  return {
    libraryID: item.libraryID,
    key: item.key,
    parentKey: item.parentKey as string,
    type: item.annotationType,
    text: item.annotationText ?? null,
    comment: item.annotationComment ?? null,
    color: item.annotationColor ?? null,
    pageLabel: item.annotationPageLabel ?? null,
    sortIndex: String(item.annotationSortIndex),
    position: item.annotationPosition,
    tags: item.getTags().map((t) => t.tag),
  };
}

export type NewHighlight = Omit<AnnotationSnapshot, "key" | "parentKey" | "tags" | "type"> & { key?: string };

/** Creates (or recreates, with `key`) a highlight on `attachment`. Call inside a DB transaction. */
export async function saveHighlight(attachment: Zotero.Item, h: NewHighlight, tags: string[] = []): Promise<Zotero.Item> {
  const item = new Zotero.Item("annotation");
  item.libraryID = attachment.libraryID;
  if (h.key) {
    item.key = h.key;
    await (item as any).loadPrimaryData();
  }
  item.parentID = attachment.id;
  item.annotationType = "highlight";
  item.annotationText = h.text as string;
  item.annotationComment = h.comment as string;
  item.annotationColor = h.color as string;
  item.annotationPageLabel = h.pageLabel as string;
  (item as any).annotationSortIndex = h.sortIndex;
  item.annotationPosition = h.position;
  for (const tag of tags) item.addTag(tag, 0);
  // skipSelect like saveFromJSON: selecting an annotation would clear the user's quick search.
  await item.save({ skipSelect: true } as any);
  return item;
}

/** Recreates an annotation from its snapshot if it no longer exists. Returns false if its attachment is gone too. */
export async function recreateAnnotation(s: AnnotationSnapshot): Promise<boolean> {
  if (Zotero.Items.getByLibraryAndKey(s.libraryID, s.key)) return true;
  const attachment = Zotero.Items.getByLibraryAndKey(s.libraryID, s.parentKey) as Zotero.Item | false;
  if (!attachment || s.type !== "highlight") return false;
  await saveHighlight(attachment, s, s.tags);
  return true;
}
