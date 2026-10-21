# 02: Read tools — search_library, get_item, list_collections

**What to build:** the three library read tools from SPEC: Tools → Read, using item keys everywhere. Item serialization (key, type, title, creators, year, DOI, attachment keys; for `get_item` also child note keys, tags, collections) lives in one module reused by later tickets.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `search_library` supports `query`, `collectionKey`, `tag`, `limit` (sane default and max)
- [ ] Unknown keys produce clear tool errors
- [ ] Pure serialization logic unit-tested with fake items
