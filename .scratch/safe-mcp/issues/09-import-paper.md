# 09: import_paper by identifier

**What to build:** `import_paper` with DOI / arXiv ID / PMID only (Hard rule 4), using Zotero's own identifier translators, optional existing `collectionKey`, PDF retrieval when Zotero can; the new item and its attachments are recorded as owned; undo trashes them.

**Blocked by:** 04

**Status:** done

- [x] Unit tests: identifier validation/normalisation (doi.org URLs? decide and document; file paths, plain URLs, empty, multiple identifiers rejected)
- [x] Non-existent `collectionKey` fails before any import happens

## Comments

- **Identifiers** (`src/import/identifier.ts`, strict, not `extractIdentifiers`): bare DOI `10.NNNN/…` (optional
  `doi:` prefix), arXiv new/old style (optional `arXiv:` prefix; version suffix dropped like Zotero does),
  PMID 1-9 digits (optional `PMID:`). **doi.org / arxiv.org links are rejected** (Hard rule 4 says no URLs); the
  error quotes the bare DOI to retry with. Paths, `file:`, Windows paths, any whitespace-separated second
  identifier, ISBNs and titles are rejected. Unknown `collectionKey` fails before any network call.
- **Two-step import** (`src/import/runImport.ts` + `zoteroPorts.ts`): (1) `Translate.Search` with
  `libraryID: false` (metadata only, saves nothing; 30 s budget, a late answer is dropped), (2)
  `Translate.ItemSaver.saveItems` (`skipSelect`, user's download/snapshot prefs respected). The change is
  recorded from ItemSaver's items-done callback (item + translator notes), then attachments that finish
  downloading and a PDF from `Zotero.Attachments.addAvailableFile` (only when no PDF/EPUB came and
  `downloadAssociatedFiles` is on) are added to the **same change** via new `changeLog().addObjects`.
- **Not one transaction** (deviation from "Adding a write tool"): ItemSaver opens its own transactions and
  does network I/O, so it can't run inside `recordWrite`. Window between Zotero's commit and our record is
  tiny; if recording fails the saved items are trashed.
- **Write-queue budget:** 30 s lookup + 30 s for save/attachments/PDF search, so one call holds the
  serialised write queue for at most ~1 min. When the attachment budget runs out the call returns
  `complete: false` with a message; downloads continue in the background and are still recorded under the
  changeId; if that change was undone meanwhile, late attachments are trashed on arrival.
- No duplicate check (spec doesn't ask; the description says so). Live: DOI 10.1038/nature12373 (PDF) and
  arXiv 1706.03762 (PDF + snapshot + note) import in ~5-7 s headless.
