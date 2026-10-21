// Undo of trash: restores the items that call moved to the trash (if they are still there).
// Highlights erased meanwhile (the user emptied the trash) are recreated from the copy kept with the change.
import { describeOutcome, setDeleted } from "../changes/trash";
import type { UndoHandler } from "../changes/types";
import { recreateAnnotation, type AnnotationSnapshot } from "../highlight/annotationItem";

export type TrashData = { libraryID: number; trashed: string[]; annotations?: AnnotationSnapshot[] };

const handler: UndoHandler = {
  kind: "trash",
  async undo(change) {
    const { libraryID, trashed, annotations = [] } = change.data as TrashData;
    const recreated: string[] = [];
    for (const copy of annotations) {
      if (trashed.includes(copy.key) && !Zotero.Items.getByLibraryAndKey(libraryID, copy.key) && (await recreateAnnotation(copy))) {
        recreated.push(copy.key);
      }
    }
    const outcome = await setDeleted(libraryID, trashed.filter((k) => !recreated.includes(k)), false);
    outcome.changed.push(...recreated);
    return describeOutcome("Restored", outcome, "not in the trash");
  },
};
export default handler;
