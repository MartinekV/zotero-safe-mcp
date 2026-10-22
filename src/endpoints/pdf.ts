// GET /safe-mcp/pdf/<attachmentKey> — streams the PDF file of an attachment item so the agent can
// `curl` it instead of reading it into its context. Bearer auth via protect() like every endpoint.
// The bytes are written by the _requestFinished patch (hooks/binary-file-responses.ts).
import { PDF_PATH_PREFIX } from "../config";
import { FILE_PATH_OPTION } from "../http/binaryFileResponse";
import { isItemKey } from "../pdf/attachmentKey";
import { getPdfFile, PdfFile } from "../pdf/attachment";
import { jsonError } from "../http/json";
import { EndpointDef, HttpHandler, ToolError } from "../registry/types";

export function createPdfHandler(lookup: (key: string) => Promise<PdfFile>): HttpHandler {
  return async (req) => {
    const key = req.pathParams?.key;
    if (!isItemKey(key)) return jsonError(400, "Invalid attachment key: expected 8 characters A-Z/0-9");
    let file: PdfFile;
    try {
      file = await lookup(key);
    } catch (e) {
      if (e instanceof ToolError) return jsonError(404, e.message);
      throw e;
    }
    return {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": file.size,
        // Header values must be ASCII: never the stored file name.
        "Content-Disposition": `attachment; filename="${key}.pdf"`,
      },
      body: "",
      options: { [FILE_PATH_OPTION]: file.path },
    };
  };
}

const endpoint: EndpointDef = {
  path: `${PDF_PATH_PREFIX}:key`,
  methods: ["GET"],
  dataTypes: "*",
  handler: createPdfHandler(getPdfFile),
};
export default endpoint;
