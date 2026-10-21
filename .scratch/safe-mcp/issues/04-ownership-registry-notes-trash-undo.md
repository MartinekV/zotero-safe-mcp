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

**Status:** ready-for-agent

- [ ] Unit tests: ownership checks (owned vs foreign item, owned vs pre-existing tag pair), change log / undo ordering, undo of an already-undone change refused
- [ ] Unit tests: rate limiter (window, cap, reads unaffected)
- [ ] Trying to trash a user's item fails with a clear error and changes nothing
