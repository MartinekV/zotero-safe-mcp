# 09: import_paper by identifier

**What to build:** `import_paper` with DOI / arXiv ID / PMID only (Hard rule 4), using Zotero's own identifier translators, optional existing `collectionKey`, PDF retrieval when Zotero can; the new item and its attachments are recorded as owned; undo trashes them.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Unit tests: identifier validation/normalisation (doi.org URLs? decide and document; file paths, plain URLs, empty, multiple identifiers rejected)
- [ ] Non-existent `collectionKey` fails before any import happens
