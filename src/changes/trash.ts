// Moving objects to Zotero's trash and back (SPEC Hard rule 5: never erase). Must run inside a
// DB transaction (recordWrite's body or an undo handler): uses item.save(), not trashTx(), which
// would nest a transaction and also put the action on the user's Edit → Undo stack.

export type TrashOutcome = {
  /** Keys whose `deleted` flag this call changed. */
  changed: string[];
  /** Keys already in the requested state. */
  unchanged: string[];
  /** Keys with no item (erased by the user, e.g. by emptying the trash). */
  missing: string[];
};

export async function setDeleted(libraryID: number, keys: readonly string[], deleted: boolean): Promise<TrashOutcome> {
  const out: TrashOutcome = { changed: [], unchanged: [], missing: [] };
  for (const key of keys) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
    if (!item) out.missing.push(key);
    else if (item.deleted === deleted) out.unchanged.push(key);
    else {
      item.deleted = deleted;
      await item.save();
      out.changed.push(key);
    }
  }
  return out;
}

/** "Trashed A, B; C was already in the trash" style summary. */
export function describeOutcome(verb: string, o: TrashOutcome, unchangedPhrase: string): string {
  const parts: string[] = [];
  parts.push(o.changed.length ? `${verb} ${o.changed.join(", ")}` : `Nothing ${verb.toLowerCase()}`);
  if (o.unchanged.length) parts.push(`${o.unchanged.join(", ")} ${unchangedPhrase}`);
  if (o.missing.length) parts.push(`${o.missing.join(", ")} no longer exist${o.missing.length === 1 ? "s" : ""}`);
  return parts.join("; ");
}
