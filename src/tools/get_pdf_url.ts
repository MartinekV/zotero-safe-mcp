import { PDF_URL_BASE_PREF } from "../config";
import { ITEM_KEY_PATTERN, pdfUrl } from "../pdf/attachmentKey";
import { getPdfFile } from "../pdf/attachment";
import { defineTool } from "../registry/types";

export default defineTool<{ attachmentKey: string }>({
  name: "get_pdf_url",
  description:
    "URL to download a PDF attachment's file (GET, same `Authorization: Bearer <token>` header as this MCP server), " +
    "e.g. with curl to a local file instead of reading the PDF into context.",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["attachmentKey"],
    properties: { attachmentKey: { type: "string", pattern: ITEM_KEY_PATTERN, description: "Key of the PDF attachment item" } },
  },
  async handler({ attachmentKey }) {
    const file = await getPdfFile(attachmentKey);
    const base = Zotero.Prefs.get(PDF_URL_BASE_PREF, true) as string | undefined;
    const port = Number(Zotero.Prefs.get("httpServer.port")) || 23119;
    const url = pdfUrl(base, port, attachmentKey);
    return {
      attachmentKey,
      url,
      contentType: "application/pdf",
      sizeBytes: file.size,
      example: `curl -fsS -H "Authorization: Bearer $TOKEN" -o ${attachmentKey}.pdf ${url}`,
    };
  },
});
