# 13: import_paper duplicate check

**What to build:** before importing, `import_paper` looks for an existing item in the personal library (not in the trash) with the same identifier — DOI (case-insensitive, also a `DOI: …` line in Extra), arXiv ID (version-insensitive, e.g. `1706.03762v5` matches `1706.03762`; check URL/Extra/archive ID fields where Zotero stores it), or PMID (Extra `PMID: …`). If found, nothing is imported, no change is recorded, and the result returns `{ duplicate: true, itemKey }` (the existing item stays the user's). If `collectionKey` was given, the existing item is NOT filed into it (that would modify a user item) — say so in the result.

**Blocked by:** 09, 12

**Status:** ready-for-agent

- [ ] Unit tests for identifier matching (DOI case, arXiv versions, PMID in Extra, trashed items ignored)
- [ ] Integration test: importing the same DOI twice yields one item
- [ ] SPEC/README describe the behaviour
