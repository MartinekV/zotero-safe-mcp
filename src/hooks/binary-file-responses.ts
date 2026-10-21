// Installs the scoped _requestFinished patch that lets GET /safe-mcp/pdf/<key> send raw bytes;
// removed again on shutdown (Zotero keeps running after a disable).
import { PDF_PATH_PREFIX } from "../config";
import { patchRequestFinished, zoteroSendFile } from "../http/binaryFileResponse";
import { LifecycleHook } from "../registry/types";

let unpatch: (() => void) | undefined;

const hook: LifecycleHook = {
  name: "binary-file-responses",
  startup() {
    unpatch?.();
    // No HTTP server (disabled in Zotero's prefs, or a unit test's fake Zotero): nothing to patch.
    const handler = (globalThis as any).Zotero?.Server?.RequestHandler;
    if (!handler) return;
    unpatch = patchRequestFinished(handler.prototype, {
      pathPrefix: PDF_PATH_PREFIX,
      sendFile: zoteroSendFile,
    });
  },
  shutdown() {
    unpatch?.();
    unpatch = undefined;
  },
};
export default hook;
