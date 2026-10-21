import { changeLog } from "../changes";
import { defineTool } from "../registry/types";

export default defineTool<{ changeId?: string }>({
  name: "undo",
  description:
    "Reverse one of this plugin's changes: by default the most recent one not yet undone, or the one with changeId " +
    "(see list_changes). Created notes, highlights and papers go to the trash, trashed items are restored, " +
    "added tags are removed and removed tags put back, edited notes get their previous version back (refused if " +
    "the note was changed in Zotero since). " +
    "A change can be undone once; undo itself cannot be undone.",
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { changeId: { type: "string", minLength: 1, maxLength: 64, description: "From a write result or list_changes" } },
  },
  async handler({ changeId }) {
    const { changeId: id, tool, summary } = await changeLog().undo(changeId);
    return { undoneChangeId: id, tool, summary };
  },
});
