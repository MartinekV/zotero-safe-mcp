import { changeLog } from "../changes";
import { annotationSnapshot } from "../highlight/annotationItem";
import { describeOutcome, setDeleted } from "../changes/trash";
import { requireAgentOwned } from "../ownership/agentOwned";
import { defineTool, ToolError } from "../registry/types";
import type { TrashData } from "../undo/trash";
import { KEY_PATTERN, libraryID } from "../zotero/library";

export default defineTool<{ itemKeys: string[] }>({
  name: "trash",
  description:
    "Move notes, highlights and imported papers this plugin created to Zotero's trash (never deleted permanently; " +
    "undo restores them). The user's own items, and notes the user has edited in Zotero, are refused, and then nothing is trashed. Returns a changeId.",
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemKeys"],
    properties: {
      itemKeys: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", pattern: KEY_PATTERN } },
    },
  },
  async handler(args) {
    const L = libraryID();
    const keys = [...new Set(args.itemKeys)];
    const missing = keys.filter((k) => !Zotero.Items.getByLibraryAndKey(L, k));
    if (missing.length) throw new ToolError(`No item with key ${missing.join(", ")} in the library; nothing was trashed.`);
    await requireAgentOwned(L, keys, "trash");
    const already = keys.filter((k) => (Zotero.Items.getByLibraryAndKey(L, k) as Zotero.Item).deleted);
    if (already.length === keys.length) throw new ToolError(`Already in the trash: ${already.join(", ")}.`);

    const { changeId, result } = await changeLog().recordWrite({ tool: "trash", args }, async (w) => {
      // Copies of highlights, so undo can recreate them if the user empties the trash in between.
      const annotations = keys
        .map((k) => Zotero.Items.getByLibraryAndKey(L, k) as Zotero.Item)
        .filter((i) => i.isAnnotation() && !i.deleted)
        .map(annotationSnapshot);
      const outcome = await setDeleted(L, keys, true);
      const data: TrashData = { libraryID: L, trashed: outcome.changed, ...(annotations.length ? { annotations } : {}) };
      w.data = data;
      w.summary = describeOutcome("Trashed", outcome, "already in the trash");
      return { trashed: outcome.changed, alreadyInTrash: outcome.unchanged };
    });
    return { changeId, ...result };
  },
});
