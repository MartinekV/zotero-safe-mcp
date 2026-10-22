// Adapted from llm-for-zotero (AGPL-3.0), src/agent/tools/write/annotatePdf.ts@435dd19 (building and
// saving the highlight); positioning in ../highlight/locate.ts.
import { LLM_TAG, KEY_PATTERN } from "../config";
import { changeLog } from "../changes";
import type { AddHighlightData } from "../changes/data";
import { annotationSnapshot, saveHighlight } from "../highlight/annotationItem";
import { llmComment } from "../highlight/comment";
import { colorNameOf, HIGHLIGHT_COLOR_NAMES, resolveHighlightColor, zoteroPalette } from "../highlight/color";
import { locateHighlight } from "../highlight/locate";
import { withPdf } from "../highlight/pdfjs";
import { getPdfAttachment } from "../pdf/attachment";

import { defineTool, ToolError } from "../registry/types";

type Args = { attachmentKey: string; text: string; page?: number; occurrence?: number; color?: string; comment?: string };

export default defineTool<Args>({
  name: "add_highlight",
  description:
    "Highlight a passage of a PDF attachment. `text` is quoted from the PDF (see read_pdf_text); whitespace, line breaks, " +
    "line-end hyphenation and punctuation differences are tolerated, and a passage may continue onto the next page. " +
    "If it occurs more than once, give `page` (1-based PDF page the passage starts on) and/or `occurrence` (1-based, " +
    "counted on that page, or in the whole PDF without `page`). " +
    `color: ${HIGHLIGHT_COLOR_NAMES.join(", ")} (default yellow; green is reserved for the user, hex codes are rejected). ` +
    `The comment is prefixed ${LLM_TAG}. Returns the annotation key, the highlighted text as stored, and a changeId for undo.`,
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["attachmentKey", "text"],
    properties: {
      attachmentKey: { type: "string", pattern: KEY_PATTERN, description: "Key of the PDF attachment item" },
      text: { type: "string", minLength: 1, maxLength: 10_000, description: "The passage, quoted from the PDF" },
      page: { type: "integer", minimum: 1, description: "1-based PDF page the passage starts on" },
      occurrence: { type: "integer", minimum: 1, description: "1-based match to take when the passage occurs more than once" },
      color: { type: "string", maxLength: 20, description: `One of ${HIGHLIGHT_COLOR_NAMES.join(", ")} (default yellow)` },
      comment: { type: "string", maxLength: 100_000, description: `Comment shown with the highlight; prefixed ${LLM_TAG}` },
    },
  },
  async handler(args) {
    const palette = zoteroPalette();
    const color = resolveHighlightColor(args.color, palette);
    const comment = llmComment(args.comment);
    const attachment = await getPdfAttachment(args.attachmentKey);
    if (attachment.deleted) throw new ToolError(`Attachment ${args.attachmentKey} is in the trash.`);
    const path = await attachment.getFilePathAsync();
    if (!path) throw new ToolError(`The PDF of attachment ${args.attachmentKey} is not available on this computer (not downloaded?)`);

    const { located, pageLabel } = await withPdf(path, async (pdf) => {
      const located = await locateHighlight(pdf, { text: args.text, page: args.page, occurrence: args.occurrence });
      return { located, pageLabel: pdf.pageLabel(located.position.pageIndex) };
    });
    const position = JSON.stringify(located.position);
    const maxSize = (Zotero.Annotations as any).ANNOTATION_POSITION_MAX_SIZE ?? 65000;
    if (position.length > maxSize) throw new ToolError("The passage is too long for one highlight; split it into shorter passages.");

    const L = attachment.libraryID;
    const page = located.position.pageIndex + 1;
    const { changeId, result } = await changeLog().recordWrite({ tool: "add_highlight", args }, async (w) => {
      const item = await saveHighlight(attachment, { libraryID: L, text: located.text, comment, color, pageLabel, sortIndex: located.sortIndex, position });
      w.ownObject({ libraryID: L, itemKey: item.key, kind: "highlight" });
      const data: AddHighlightData = { annotation: annotationSnapshot(item) };
      w.data = data;
      const short = located.text.length > 60 ? `${located.text.slice(0, 57)}…` : located.text;
      w.summary = `Highlighted "${short}" on page ${pageLabel} of ${attachment.key} (annotation ${item.key})`;
      return { annotationKey: item.key };
    });
    return {
      changeId,
      ...result,
      attachmentKey: attachment.key,
      page,
      pageLabel,
      ...(located.position.nextPageRects ? { continuesOnPage: page + 1 } : {}),
      color: colorNameOf(color, palette),
      comment,
      highlightedText: located.text,
    };
  },
});
