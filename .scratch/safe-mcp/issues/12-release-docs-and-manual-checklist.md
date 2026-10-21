# 12: Release build, docs and manual test checklist

**What to build:** final README (setup, tools, safety model, credits to llm-for-zotero with commit hash), `docs/manual-test-checklist.md` (SPEC: Testing — every tool, every forbidden action, undo of each change type), an end-to-end smoke test against a headless Zotero if the exploration notes found that feasible, and answers to SPEC open questions written back into SPEC.md.

**Blocked by:** 02, 05, 06, 08, 09, 10, 11

**Status:** done

- [x] `npm run build && npm test` green
- [x] Every reused file carries a header naming its llm-for-zotero source file

## Comments

- From ticket 04: the selection case in `test/integration/get_reader_state.itest.ts` (ticket 11) is flaky (~1 in 3 fails). Make it deterministic.
- A unit test in `test/unit/import-run.test.ts` (ticket 09) failed once in 5 full `npm test` runs (likely timing-dependent); make it deterministic (fake timers).
- **Flaky tests fixed.** `import-run.test.ts` runs on vitest fake timers: budgets are checked against the fake
  clock (returns at exactly 30 ms instead of "< 90 ms wall time"), late work is flushed with
  `vi.runAllTimersAsync()` instead of `sleep`. Mutating the attachment budget in `runImport.ts` still fails it.
  `get_reader_state.itest.ts` failed 1 of 5 with `span is undefined`: page 2's text layer wasn't rendered yet when
  the double-click ran. It now waits for the text layer, and polls the tool until the selection state has updated
  (both ways). 10/10 isolated runs green afterwards.
- **Docs:** SPEC.md updated to what was built (open questions answered in place; Tools tables with defaults/limits;
  `[LLM]` tag reserved for add_tags/remove_tags; image/PDF endpoint limits and status codes; rate limit pref;
  import budgets; real Storage columns; group libraries a non-goal; Testing lists the itests and the checklist).
  README: endpoints, setup, prefs, tools, safety model (incl. token in Zotero's debug log, duplicates on import),
  integration tests, credits with commit 435dd19. `docs/manual-test-checklist.md`: throwaway profile + data dir,
  every tool, undo of each change kind, every forbidden action, limits.
- **Headers:** every reused file starts with `// Adapted from llm-for-zotero (AGPL-3.0), <path>@435dd19`
  (`src/import/zoteroPorts.ts` had it on line 5; moved to the top). A line-overlap scan against the clone found
  no other copied code.
- The e2e suite is the existing `npm run test:integration` (no separate smoke test added).
- **User decisions (via the orchestrator):** personal library only (stated in SPEC Non-goals and README); undo of
  an edit stays refused if the user edited the note since; `import_paper` gets a duplicate check in **ticket 13**
  (same DOI / arXiv ID / PMID in the personal library, not trashed → return its key, import nothing). SPEC, README and
  the checklist already describe that behaviour; until ticket 13 lands, the tool (and its description, "Does not
  check for duplicates") still imports a second copy.
