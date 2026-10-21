// Undo of add_highlight: the highlight goes to the trash (restorable; never erased). Open readers
// drop it via hooks/annotation-trash-reader-sync.ts. A JSON copy stays in the change's data.
import type { UndoHandler } from "../changes/types";
import { trashCreatedObjects } from "./create_note";

const handler: UndoHandler = { kind: "add_highlight", undo: trashCreatedObjects };
export default handler;
