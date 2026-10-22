# 06: add_tags / remove_tags with tag-pair ownership

**What to build:** `add_tags` on any item, recording only newly added (item, tag) pairs; `remove_tags` for owned pairs only; `undo` of `add_tags` removes the pairs it added (and only those still present).

**Blocked by:** 04

**Status:** resolved

- [x] Pre-existing pairs are not recorded and cannot be removed
- [x] Removing a user's tag is refused; partial requests fail atomically with a clear error listing the offending tags

## Comments

- **Tools:** `src/tools/add_tags.ts`, `src/tools/remove_tags.ts`; undo handlers `src/undo/add_tags.ts`,
  `src/undo/remove_tags.ts`; shared argument handling `src/tags/tagArgs.ts`. Tests: `test/unit/tag-args.test.ts`,
  `test/integration/tags.itest.ts`.
- **`[LLM]` is reserved for both tools** (any case, after trimming): `add_tags` refuses it, `remove_tags` refuses
  it. SPEC says "the agent can add that tag to anything" — that sentence explains why `byLLM` comes from the
  registry; it doesn't require allowing it. Refusing is the conservative choice: the tag tells the user
  "an agent wrote this", so the agent may neither put it on the user's items nor strip it from its own notes
  (create_note's `[LLM]` is not recorded as an owned pair anyway, so it would be refused regardless).
  Names that merely contain it (`[LLM] summary`, `LLM`) are allowed.
- **Normalisation:** same as `Zotero.Tags.cleanData` — trim + NFC; case kept (Zotero tags are
  case-sensitive), duplicates dropped, blank refused, max 255 chars (Zotero's sync limit; schema caps raw input
  at 1000). The normalised name is what's compared, stored and owned.
- **Type:** added tags are manual (type 0). A name the item already has, manual or automatic, counts as
  pre-existing and is never passed to `addTag` (which would turn an automatic tag manual).
- `add_tags` refuses (ToolError, no change recorded) when every tag is already present, so an empty change
  can't absorb a default `undo`. It refuses trashed items; `remove_tags` works on trashed items.
- `remove_tags` is all-or-nothing: any requested tag not owned → refused, the error lists every offending tag.
  An owned pair the user has since removed is just forgotten (`notPresent` in the result).
- **Undo of add_tags** removes the pairs the change still owns (a pair removed by `remove_tags`, or taken over by a
  later `add_tags`, is no longer the change's) and forgets them. **Undo of remove_tags** re-adds the removed tags
  and owns them again under the remove change's id — except tags the item has again by then (user re-added: stays
  the user's). For that, `UndoContext` gained `ownTag` (`src/changes/types.ts`, `changeLog.ts`; unit-tested).
