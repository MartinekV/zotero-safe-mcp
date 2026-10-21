# 04: Ownership registry + create_note, list_notes, trash, undo

**What to build:** the tracer bullet for every write: the plugin-owned store in the Zotero data dir (SPEC: Storage — `owned_objects`, `owned_tags`, `note_versions`, `changes`), a change log where every write returns a `changeId`, and the first write path end to end:
- `create_note` (child of `parentItemKey` or standalone in `collectionKey`), tagged `[LLM]`, recorded as owned
- `list_notes` (Markdown content, `byLLM` from the registry — not from the tag)
- `trash` for owned items only (Hard rule 5: trash, never erase)
- `undo` (default: last not-yet-undone change; or by `changeId`) for created objects
- `list_changes` tool (recent changes with id, tool, summary, undone flag) so the agent can pick a `changeId`

A write rate limit (SPEC: Rate limit; default 30/min, pref-configurable) applies to every write tool via the tool registry; over the cap the call fails with no side effects.

Ownership checks live in one pure module (unit-tested) that every later write ticket uses.

**Blocked by:** 01, 03

**Status:** done

- [x] Unit tests: ownership checks (owned vs foreign item, owned vs pre-existing tag pair), change log / undo ordering, undo of an already-undone change refused
- [x] Unit tests: rate limiter (window, cap, reads unaffected)
- [x] Trying to trash a user's item fails with a clear error and changes nothing

## Comments

- **Storage:** `<Zotero data dir>/safe-mcp.sqlite`, ATTACHed to `Zotero.DB` as `safemcp`
  (`src/hooks/change-log-db.ts`; re-attached via `Zotero.DB.onConnect`, detached on shutdown). Tables as in
  SPEC: Storage, plus: `changes` has `seq` (ordering), `kind` (selects the undo handler), `data` (JSON for
  the undo handler), `summary`, `undoneAt`; every table carries `libraryID`. Schema version in
  `PRAGMA safemcp.user_version` (1).
- **API for tickets 05/06/08/09/10** (documented in CONTRIBUTING.md "Adding a write tool"):
  `changeLog().recordWrite({ tool, args, kind? }, async (w) => …)` runs the Zotero saves and the
  change/ownership/version rows in one transaction; undo handlers are files in `src/undo/<kind>.ts`
  (auto-registered by `gen-index.mjs`). Pure checks in `src/ownership/checks.ts` (`requireOwned`,
  `splitNewTags`, `requireOwnedTagPairs`). Rate limit + write serialisation live in `registry/tools.ts`,
  so no write tool can skip them.
- **Citations wired** (`src/notes/zoteroLookups.ts`, per ticket 03's comments): regular, non-trashed items
  only. `resolveImage` currently refuses every `image:` reference; ticket 10 replaces it there.
- **`list_annotations` byLLM wired** to the registry (ticket 07's comment).
- Conservative choices: `undo` is not itself a change (can't be undone; returns `undoneChangeId`); undo of a
  creation moves the objects to the trash and keeps them owned (so `undo` of a `trash` or a user's restore
  keeps them editable); undo of `trash` restores only items that call trashed. `trash` fails as a whole
  if any key is unknown or not owned. Rate-limit slots are taken after argument validation, so a call
  refused for invalid arguments doesn't count; every other write call does, even one that then fails.
  Pref `extensions.zotero-safe-mcp.writesPerMinute` (default 30; a non-positive/non-integer value falls
  back to 30, never to "unlimited"). Default `list_changes` limit 20 (max 200).
- `addon.enable()` does not await the plugin's async startup, and startup now does DB work before
  endpoints are registered: integration tests that toggle the plugin use `setPluginEnabled` (harness),
  which waits for `/safe-mcp`. `get_reader_state.itest.ts`'s selection test is flaky (failed 1 of 3
  runs, also in isolation; unrelated to this ticket).
