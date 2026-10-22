// Whether a file's first bytes are a PDF's (GET /safe-mcp/pdf serves files by content, not just by
// the attachment's stored content type). Like PDF readers, the %PDF- header may follow up to 1 KB of junk.

/** How many leading bytes to read for hasPdfHeader. */
export const PDF_HEADER_WINDOW = 1024;
const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

export function hasPdfHeader(head: Uint8Array): boolean {
  const end = Math.min(head.length, PDF_HEADER_WINDOW) - MAGIC.length;
  for (let i = 0; i <= end; i++) {
    if (MAGIC.every((b, j) => head[i + j] === b)) return true;
  }
  return false;
}
