// Undo of import_paper: the item and every attachment/note recorded with it go to the trash
// (restorable; never erased). Attachments that finish downloading after the undo are trashed when
// they are recorded (src/import/zoteroPorts.ts addLate).
import type { UndoHandler } from "../changes/types";
import { trashCreatedObjects } from "./create_note";

const handler: UndoHandler = { kind: "import_paper", undo: trashCreatedObjects };
export default handler;
