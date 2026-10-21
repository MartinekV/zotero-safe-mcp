// Undo of trash: restores the items that call moved to the trash (if they are still there).
import { describeOutcome, setDeleted } from "../changes/trash";
import type { UndoHandler } from "../changes/types";

export type TrashData = { libraryID: number; trashed: string[] };

const handler: UndoHandler = {
  kind: "trash",
  async undo(change) {
    const { libraryID, trashed } = change.data as TrashData;
    return describeOutcome("Restored", await setDeleted(libraryID, trashed, false), "not in the trash");
  },
};
export default handler;
