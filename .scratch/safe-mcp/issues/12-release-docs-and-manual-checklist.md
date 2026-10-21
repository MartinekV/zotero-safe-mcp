# 12: Release build, docs and manual test checklist

**What to build:** final README (setup, tools, safety model, credits to llm-for-zotero with commit hash), `docs/manual-test-checklist.md` (SPEC: Testing — every tool, every forbidden action, undo of each change type), an end-to-end smoke test against a headless Zotero if the exploration notes found that feasible, and answers to SPEC open questions written back into SPEC.md.

**Blocked by:** 02, 05, 06, 08, 09, 10, 11

**Status:** ready-for-agent

- [ ] `npm run build && npm test` green
- [ ] Every reused file carries a header naming its llm-for-zotero source file
