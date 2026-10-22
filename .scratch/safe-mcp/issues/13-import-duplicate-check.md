# 13: import_paper duplicate check

**What to build:** before importing, `import_paper` looks for an existing item in the personal library (not in the trash) with the same identifier — DOI (case-insensitive, also a `DOI: …` line in Extra), arXiv ID (version-insensitive, e.g. `1706.03762v5` matches `1706.03762`; check URL/Extra/archive ID fields where Zotero stores it), or PMID (Extra `PMID: …`). If found, nothing is imported, no change is recorded, and the result returns `{ duplicate: true, itemKey }` (the existing item stays the user's). If `collectionKey` was given, the existing item is NOT filed into it (that would modify a user item) — say so in the result.

**Blocked by:** 09, 12

**Status:** done

- [x] Unit tests for identifier matching (DOI case, arXiv versions, PMID in Extra, trashed items ignored)
- [x] Integration test: importing the same DOI twice yields one item
- [x] SPEC/README describe the behaviour

## Comments

- **Matching** (`src/import/duplicates.ts`, pure, unit-tested): DOI = `DOI` field or an Extra line `DOI: …`, exact
  and case-insensitive (a DOI mentioned mid-line in Extra does not count). arXiv = ID without version, case-insensitive,
  from `archiveID`/Extra (`arXiv:ID…`), URL (`arxiv.org/abs|pdf/ID…`) or the DataCite DOI `10.48550/arXiv.ID`; a
  longer ID (`1706.037621`) or the bare number in unrelated text doesn't match. PMID = Extra line `PMID: …` only
  (PMCID and numbers elsewhere don't count). Only regular, non-trashed items count; with several copies the oldest
  is `itemKey` and all are listed in `itemKeys`.
- **Lookup** (`src/import/zoteroDuplicates.ts`): one SQL `LIKE %value%` over the personal library's item field
  values gives candidates, then the rules above decide. Runs after the identifier/collection checks and before
  any network call (duplicate answers come back in ~100 ms).
- **Result:** `{ duplicate: true, itemKey, [itemKeys], title, identifier, message }`, no `changeId`. With
  `collectionKey`, the message says the item was not added to that collection. A duplicate answer still counts
  against the write rate limit (the limit is applied before the handler runs, by design).
- Cross-type matches are not attempted (e.g. importing arXiv `1706.03762` when the library only has the
  published version's journal DOI). Conservative: only the same identifier counts.
- **Seams** (chosen without the user, per brief): `findDuplicate` (unit) and the `import_paper` tool end to end (itest).
- **Test infra:** `test/integration/http.ts` idle timeout raised 30 s → 90 s: Zotero sends nothing until a tool
  is done and `import_paper` may legitimately take ~60 s (lookup + attachment budgets), which made ticket 09's
  network tests time out client-side. The new "same DOI twice" test retries the first import when Zotero's
  lookup fails transiently (no items / no answer; nothing is imported then). The network itests are still
  occasionally flaky in this sandbox (slow crossref/arxiv/publisher responses; once ticket 09's arXiv test ran
  past 120 s); the no-network duplicate test is deterministic.
