// Binary file responses. Zotero's server writes every response body through a UTF-8 converter, which
// corrupts bytes >= 0x80, and endpoints never see the response object. So we wrap
// Zotero.Server.RequestHandler.prototype._requestFinished: when an endpoint under `pathPrefix` returns
// options { [FILE_PATH_OPTION]: path } (4th tuple element) with an empty body, we write the head
// ourselves and stream the file's raw bytes. Every other response goes to Zotero's original.

/** Response option naming the file to stream (set only by our own endpoint handlers). */
export const FILE_PATH_OPTION = "safeMcpFilePath";

/** Writes `head` (ASCII) then the file's bytes to the httpd response, then finishes it. */
export type SendFile = (response: any, head: string, filePath: string) => void;

/**
 * Wraps proto._requestFinished; returns an idempotent unpatch. If someone wrapped it after us, unpatch
 * leaves their wrapper in place and turns ours into a pass-through rather than dropping theirs.
 */
export function patchRequestFinished(proto: any, opts: { pathPrefix: string; sendFile: SendFile }): () => void {
  const original = proto._requestFinished;
  let active = true;

  const wrapper = function (this: any, responseBody: string, options?: Record<string, unknown>) {
    const filePath = options?.[FILE_PATH_OPTION];
    const ours =
      active && typeof filePath === "string" && typeof this.pathname === "string" && this.pathname.startsWith(opts.pathPrefix);
    if (!ours) return original.apply(this, arguments as any);
    if (this._responseSent) return;
    this._responseSent = true;
    // An empty body makes Zotero end the head with "Content-Length: 0\r\n\r\n"; our handler set the real length.
    const head = responseBody.replace(/Content-Length: 0\r\n\r\n$/, "\r\n");
    opts.sendFile(this.response, head, filePath as string);
  };
  proto._requestFinished = wrapper;

  return () => {
    if (!active) return;
    active = false;
    if (proto._requestFinished === wrapper) proto._requestFinished = original;
  };
}

/** SendFile for the real httpd response (Gecko APIs from the bootstrap sandbox). */
export const zoteroSendFile: SendFile = (response, head, filePath) => {
  const out = response.bodyOutputStream;
  try {
    out.write(head, head.length);
    const fis = (Cc as any)["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    fis.init(Zotero.File.pathToFile(filePath), -1, -1, 0);
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs") as any;
    NetUtil.asyncCopy(fis, out, () => response.finish(), /* closeSink */ false);
  } catch (e) {
    Zotero.debug(`[safe-mcp] streaming ${filePath} failed: ${e}`);
    response.finish();
  }
};
