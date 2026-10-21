# 07: PDF read tools and PDF download endpoint

**What to build:** `read_pdf_text` (full-text index, per page where possible, optional `pages`), `get_pdf_url`, `list_annotations` (`byLLM` from the registry), and `GET /safe-mcp/pdf/<attachmentKey>` streaming the file of a PDF attachment item (bearer auth required; 404 for non-attachments, non-PDF, missing file; key validated against `^[A-Z0-9]{8}$` so no path tricks).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Unit tests for key validation and page-range parsing
- [ ] `get_pdf_url` returns a URL the sandbox can use (`http://host.docker.internal:23119/safe-mcp/pdf/<key>`; host configurable in prefs)
