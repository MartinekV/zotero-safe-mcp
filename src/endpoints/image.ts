// POST /safe-mcp/image — uploads one PNG or JPEG (raw bytes as the body) for use in a note as
// ![caption](image:<imageId>). Bearer auth via protect() like every endpoint. Zotero has already
// buffered the body (it has no size limit, exploration notes 01-http-server.md), so the limits are
// checked on Content-Length first and at most maxImageBytes + 1 bytes are ever copied out of it.
import { IMAGE_PATH } from "../config";
import { imageUploads } from "../images";
import type { ImageUploads, UploadRefusal } from "../images/uploads";
import { jsonResponse } from "../http/json";
import { EndpointDef, HttpHandler, HttpResponse } from "../registry/types";

export type ReadBody = (stream: unknown, maxBytes: number) => Uint8Array;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "application/octet-stream"];

const STATUS: Record<UploadRefusal["reason"], number> = { "too-large": 413, "not-an-image": 415, full: 429 };

function refused(r: UploadRefusal): HttpResponse {
  return jsonResponse(STATUS[r.reason], { error: r.error }, r.retryAfterSeconds ? { "Retry-After": r.retryAfterSeconds } : {});
}

export function createImageUploadHandler(deps: { uploads: () => ImageUploads; readBody: ReadBody }): HttpHandler {
  return async (req) => {
    const uploads = deps.uploads();
    const declaredType = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (req.data == null || typeof req.data !== "object" || !ACCEPTED_TYPES.includes(declaredType)) {
      return jsonResponse(415, {
        error: "Send the image's raw bytes as the body with Content-Type: image/png or image/jpeg",
      });
    }
    const length = Number(req.headers["content-length"]);
    if (!Number.isSafeInteger(length) || length < 0) return jsonResponse(400, { error: "Content-Length required" });
    const room = uploads.admit(length);
    if (!room.ok) return refused(room);

    const max = uploads.limits.maxImageBytes;
    const bytes = deps.readBody(req.data, max + 1);
    const added = uploads.add(bytes);
    if (!added.ok) return refused(added);
    const { image } = added;
    if (declaredType !== "application/octet-stream" && declaredType !== image.contentType) {
      uploads.take([image.imageId]);
      return jsonResponse(415, { error: `Content-Type says ${declaredType} but the bytes are ${image.contentType}` });
    }
    return jsonResponse(200, {
      imageId: image.imageId,
      contentType: image.contentType,
      width: image.width,
      height: image.height,
      bytes: image.bytes.length,
      expiresAt: new Date(image.expiresAt).toISOString(),
      markdown: `![caption](image:${image.imageId})`,
    });
  };
}

/** Copies at most `maxBytes` from Zotero's request body (an nsIInputStream). */
export const zoteroReadBody: ReadBody = (stream, maxBytes) => {
  const bis = Cc["@mozilla.org/binaryinputstream;1"].createInstance(Ci.nsIBinaryInputStream);
  bis.setInputStream(stream as nsIInputStream);
  const n = Math.min(bis.available(), maxBytes);
  return new Uint8Array(bis.readByteArray(n));
};

const endpoint: EndpointDef = {
  path: IMAGE_PATH,
  methods: ["POST"],
  dataTypes: ACCEPTED_TYPES,
  handler: createImageUploadHandler({ uploads: imageUploads, readBody: zoteroReadBody }),
};
export default endpoint;
