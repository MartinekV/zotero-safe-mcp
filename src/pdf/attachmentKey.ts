// Attachment keys and the download URL the agent gets from get_pdf_url.
import { KEY_PATTERN, PDF_PATH_PREFIX } from "../config";

/** Zotero item keys: exactly 8 of [A-Z0-9]. Anything else never reaches a Zotero lookup. */
const ITEM_KEY_RE = new RegExp(KEY_PATTERN);

export function isItemKey(value: unknown): value is string {
  return typeof value === "string" && ITEM_KEY_RE.test(value);
}

/** Host the sandbox reaches Zotero at when the pdfUrlBase pref is empty. */
export const DEFAULT_PDF_HOST = "host.docker.internal";

/**
 * URL of GET /safe-mcp/pdf/<key> as seen from the sandbox. `base` is the pdfUrlBase pref
 * (e.g. "http://localhost:23119"); empty → http://host.docker.internal:<Zotero's HTTP port>.
 */
export function pdfUrl(base: string | undefined, port: number, key: string): string {
  const root = base?.trim() ? base.trim().replace(/\/+$/, "") : `http://${DEFAULT_PDF_HOST}:${port}`;
  return `${root}${PDF_PATH_PREFIX}${key}`;
}
