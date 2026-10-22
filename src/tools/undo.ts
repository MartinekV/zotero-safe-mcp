import { changeLog } from "../changes";
import { requireUndoable } from "../ownership/agentOwned";
import { defineTool } from "../registry/types";
import { libraryID } from "../zotero/library";

export default defineTool<{ changeId?: string }>({
  name: "undo",
  description:
    "Reverse one of this plugin's changes: by default the most recent one not yet undone, or the one with changeId " +
    "(see list_changes). Created notes, highlights and papers go to the trash, trashed items are restored, " +
    "added tags are removed and removed tags put back, edited notes get their previous version back (refused if " +
    "the note was changed in Zotero since). Changes to a note the user has edited in Zotero (it is the user's " +
    "now) are refused. " +
    "A change can be undone once; undo itself cannot be undone.",
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { changeId: { type: "string", minLength: 1, maxLength: 64, description: "From a write result or list_changes" } },
  },
  async handler({ changeId }) {
    // Checked before undo's transaction, so the take-over it records survives the refusal.
    await requireUndoable(await changeLog().undoTarget(changeId), libraryID());
    const { changeId: id, tool, summary } = await changeLog().undo(changeId);
    return { undoneChangeId: id, tool, summary };
  },
});
