// Undo of create_note: the note goes to the trash (restorable; never erased).
import { describeOutcome, setDeleted } from "../changes/trash";
import type { UndoHandler } from "../changes/types";

/** Undo for any change that created objects: trash every object it recorded. Reusable by other kinds. */
export async function trashCreatedObjects(change: Parameters<UndoHandler["undo"]>[0]): Promise<string> {
  const parts: string[] = [];
  for (const libraryID of new Set(change.objects.map((o) => o.libraryID))) {
    const keys = change.objects.filter((o) => o.libraryID === libraryID).map((o) => o.itemKey);
    parts.push(describeOutcome("Trashed", await setDeleted(libraryID, keys, true), "already in the trash"));
  }
  return parts.join("; ") || "Nothing was created";
}

const handler: UndoHandler = { kind: "create_note", undo: trashCreatedObjects };
export default handler;
