// Undo of create_note: the note goes to the trash (restorable; never erased).
import { trashCreatedObjects } from "../changes/trash";
import type { UndoHandler } from "../changes/types";

const handler: UndoHandler = { kind: "create_note", undo: trashCreatedObjects };
export default handler;
