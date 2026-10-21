# 08: add_highlight with text positioning

**What to build:** `add_highlight` (SPEC: Highlight positioning): find the exact passage in the PDF via PDF worker / PDF.js glyph positions, tolerant to line breaks, hyphenation and whitespace; fail if not found or ambiguous without `page`/`occurrence`; build position rects + sortIndex; create the highlight annotation with an allowed color (Hard rule 2 — named colors except green, default yellow, hex rejected) and a comment prefixed `[LLM]`; record as owned; undo/trash work on it. Reuse llm-for-zotero's implementation with a header naming the source file.

**Blocked by:** 04, 07

**Status:** ready-for-agent

- [ ] Unit tests: color rule (every allowed name, green, hex, case), text matching over synthetic glyph data (hyphenation, line breaks, multiple occurrences, not found)
- [ ] Annotation trash/undo behaviour follows the exploration notes' answer to the SPEC open question (keep a JSON copy for undo if trashing is not restorable)
