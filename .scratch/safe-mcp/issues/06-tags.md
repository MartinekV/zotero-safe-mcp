# 06: add_tags / remove_tags with tag-pair ownership

**What to build:** `add_tags` on any item, recording only newly added (item, tag) pairs; `remove_tags` for owned pairs only; `undo` of `add_tags` removes the pairs it added (and only those still present).

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Pre-existing pairs are not recorded and cannot be removed
- [ ] Removing a user's tag is refused; partial requests fail atomically with a clear error listing the offending tags
