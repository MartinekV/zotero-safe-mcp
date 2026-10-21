# 03: Markdown → Zotero note HTML converter

**What to build:** a pure module (no Zotero globals) converting Markdown to the HTML Zotero 10's note editor expects (SPEC: Note content): headings, emphasis, lists, links, quotes, inline/block code, tables, `$...$`/`$$...$$` math, `[@itemKey]` citations (resolved through an injected lookup; unknown keys throw), `![caption](image:<imageId>)` image placeholders (resolved through an injected lookup), unsupported Markdown kept as text. Also the reverse direction (note HTML → Markdown) used by `list_notes`.

Security: raw HTML in the Markdown is escaped, not passed through; link URLs restricted to `http`, `https`, `mailto`, `zotero` schemes.

**Blocked by:** 01 (for the build/test setup)

**Status:** ready-for-agent

- [ ] Unit tests for every construct listed above, including escaping of raw HTML and rejection/neutralisation of `javascript:` links
- [ ] Output format checked against the exploration notes on note-editor schema (math, citations, images)
