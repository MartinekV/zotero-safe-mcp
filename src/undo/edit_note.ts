// Undo of edit_note: restores the note's previous version (src/notes/noteVersions.ts).
import { editNoteUndoHandler } from "../notes/noteVersions";
import { zoteroNoteStore } from "../notes/zoteroNotes";

export default editNoteUndoHandler(zoteroNoteStore);
