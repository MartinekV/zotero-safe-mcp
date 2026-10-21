import { defineTool } from "../registry/types";
import { readReaderState } from "../zotero/readerState";

export default defineTool<Record<string, never>>({
  name: "get_reader_state",
  description:
    "What the user has open in Zotero's reader tab right now: item and attachment keys, reader type, " +
    "current page (0-based index, label, page count) and the selected text (null when nothing is selected). " +
    "Returns open: false when no reader tab is active.",
  write: false,
  inputSchema: { type: "object", additionalProperties: false, properties: {} },
  handler: () => readReaderState(),
});
