import { changeLog } from "../changes";
import { defineTool } from "../registry/types";

export default defineTool<{ limit?: number }>({
  name: "list_changes",
  description:
    "This plugin's recent changes to the library, newest first: changeId (for undo), tool, summary, createdAt and " +
    "whether it was undone.",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20" } },
  },
  async handler({ limit }) {
    return { changes: await changeLog().list(limit ?? 20) };
  },
});
