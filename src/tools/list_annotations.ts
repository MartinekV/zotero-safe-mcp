import { changeLog } from "../changes";
import { KEY_PATTERN } from "../config";
import { listAnnotations } from "../highlight/annotationList";
import { zoteroPalette } from "../highlight/color";
import { getFileAttachment } from "../pdf/attachment";
import { defineTool } from "../registry/types";

export default defineTool<{ attachmentKey: string }>({
  name: "list_annotations",
  description:
    "Annotations (highlights, notes, …) of a PDF or other file attachment, in reading order: key, type, color, text, comment, " +
    "page (the label shown in Zotero), pageIndex (0-based) and byLLM (true only for annotations this plugin created).",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["attachmentKey"],
    properties: { attachmentKey: { type: "string", pattern: KEY_PATTERN, description: "Key of the attachment item" } },
  },
  async handler({ attachmentKey }) {
    const attachment = await getFileAttachment(attachmentKey);
    const isOwned = (libraryID: number, key: string) => changeLog().isOwned(libraryID, key);
    return { attachmentKey, annotations: await listAnnotations(attachment, isOwned, zoteroPalette()) };
  },
});
