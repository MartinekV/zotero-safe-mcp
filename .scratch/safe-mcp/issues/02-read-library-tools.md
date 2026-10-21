# 02: Read tools — search_library, get_item, list_collections

**What to build:** the three library read tools from SPEC: Tools → Read, using item keys everywhere. Item serialization (key, type, title, creators, year, DOI, attachment keys; for `get_item` also child note keys, tags, collections) lives in one module reused by later tickets.

**Blocked by:** 01

**Status:** done

- [x] `search_library` supports `query`, `collectionKey`, `tag`, `limit` (sane default and max)
- [x] Unknown keys produce clear tool errors
- [x] Pure serialization logic unit-tested with fake items

## Comments

- Serialization lives in `src/zotero/serialize.ts` (`summarizeItem` for search results, `describeItem` for `get_item`);
  Zotero lookups/key errors in `src/zotero/library.ts`. User library only.
- Choices where the spec was open: `search_library` uses Zotero's "everything" quick search (fields, tags, notes,
  annotations, full text), maps child hits to their top-level item, dedupes, sorts newest-added first; empty `query`
  lists items; `collectionKey` includes subcollections; `tag` is an exact name and an unknown tag is an error;
  `limit` default 25, max 100; result also has `total` and `truncated`.
- DOI falls back to a `DOI: …` line in Extra for item types without a DOI field.
- `get_item` on a trashed item still answers, with `inTrash: true` (search never returns trashed items).

