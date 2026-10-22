# 07: PDF read tools and PDF download endpoint

**What to build:** `read_pdf_text` (full-text index, per page where possible, optional `pages`), `get_pdf_url`, `list_annotations` (`byLLM` from the registry), and `GET /safe-mcp/pdf/<attachmentKey>` streaming the file of a PDF attachment item (bearer auth required; 404 for non-attachments, non-PDF, missing file; key validated against `^[A-Z0-9]{8}$` so no path tricks).

**Blocked by:** 01

**Status:** resolved

- [x] Unit tests for key validation and page-range parsing
- [x] `get_pdf_url` returns a URL the sandbox can use (`http://host.docker.internal:23119/safe-mcp/pdf/<key>`; host configurable in prefs)

## Comments

- **For ticket 04 (wiring `byLLM`):** `src/tools/list_annotations.ts` exports
  `createListAnnotationsTool({ getAttachment, isOwned?, colors? })` with
  `type IsOwned = (libraryID: number, key: string) => boolean | Promise<boolean>`. The default export currently
  passes `isOwned: notOwned` (always false). Replace that with the registry lookup, e.g.
  `export default createListAnnotationsTool({ getAttachment: getFileAttachment, isOwned: ownership.isOwnedObject })`.
  Unit test `test/unit/list-annotations.test.ts` already covers a true/false registry.
- URL host: pref `extensions.zotero-safe-mcp.pdfUrlBase` (empty default). Empty → `http://host.docker.internal:<Zotero's
  httpServer.port>`; set it (e.g. `http://localhost:23119`) to override scheme/host/port.
- Malformed keys on `GET /safe-mcp/pdf/<key>` get **400** (unknown item / non-attachment / non-PDF / missing file get 404).
- Only the user library is searched (`Zotero.Libraries.userLibraryID`), like the other tools; group libraries are out of scope for now.
- `read_pdf_text` uses `.zotero-ft-cache` when it covers the requested pages, otherwise (never indexed, or partially
  indexed beyond `fulltext.pdfMaxPages`) runs `Zotero.PDFWorker.getFullText(itemID, null)` without writing the index.
  Returns `source: "fulltext-index" | "pdf-worker"`. Page numbers are 1-based PDF pages, not printed labels.
- `list_annotations` accepts any file attachment (PDF, EPUB, snapshot), not only PDFs.
- Binary streaming: `src/http/binaryFileResponse.ts` wraps `_requestFinished` only for responses on `/safe-mcp/pdf/`
  carrying the `safeMcpFilePath` option; unpatch restores the original only if nobody wrapped on top (else ours becomes a
  pass-through). Verified live: 87 633-byte PDF identical (`cmp`), patch gone after disable, back after enable.
- **Review fix (2026-10-22):** the PDF endpoint and get_pdf_url also require a `%PDF-` header within the
  file's first 1 KB (`src/pdf/pdfHeader.ts`); otherwise 404.
