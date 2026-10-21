# 08: add_highlight with text positioning

**What to build:** `add_highlight` (SPEC: Highlight positioning): find the exact passage in the PDF via PDF worker / PDF.js glyph positions, tolerant to line breaks, hyphenation and whitespace; fail if not found or ambiguous without `page`/`occurrence`; build position rects + sortIndex; create the highlight annotation with an allowed color (Hard rule 2 — named colors except green, default yellow, hex rejected) and a comment prefixed `[LLM]`; record as owned; undo/trash work on it. Reuse llm-for-zotero's implementation with a header naming the source file.

**Blocked by:** 04, 07

**Status:** done

- [x] Unit tests: color rule (every allowed name, green, hex, case), text matching over synthetic glyph data (hyphenation, line breaks, multiple occurrences, not found)
- [x] Annotation trash/undo behaviour follows the exploration notes' answer to the SPEC open question (keep a JSON copy for undo if trashing is not restorable)

## Comments

- **Positioning** (`src/highlight/locate.ts`, pure; adapted from llm-for-zotero `pdfAnnotationResolver.ts`, matcher
  `quoteTextNormalization.ts` copied unchanged): glyphs come from Zotero's bundled pdf.js `getPageData` loaded in the
  main window (`src/highlight/pdfjs.ts`), so **no reader tab is opened**. Rects/text follow the reader's
  `getRectsFromChars`/`getTextFromChars`; verified live: "Alice was beginning … on the bank" gives exactly the rects and
  sortIndex (`00001|000071|00230`) of a manual selection, and the glyphs under every created highlight equal the passage.
- Fixes over llm-for-zotero: passages **crossing a page break** match (`position.nextPageRects`; page-number-only lines
  at the page edges are left out); `occurrence` works without `page` (document order); the matcher's widening of a span
  to adjacent punctuation/quote marks is undone unless the quote includes them; ignorable glyphs off the line or
  without geometry don't stretch rects (line-end hyphens, which Zotero's pdf.js marks ignorable, stay covered).
- `page` = 1-based PDF page the passage **starts** on (not the printed label); the result returns `page`, `pageLabel`,
  `highlightedText` (Zotero's text for those glyphs, e.g. line-end hyphens dropped: "daisy-\nchain" → "daisychain", the
  same as a manual selection) and `continuesOnPage` for cross-page highlights. If `page` lacks the passage, the error
  names the pages that have it.
- Fixture has no line-end hyphenation, so the itest generates a small Helvetica PDF with two hyphenated line ends.
- Saving: `saveFromJSON` uses `saveTx` (nested transaction), so `src/highlight/annotationItem.ts` mirrors it with
  `item.save({skipSelect:true})`. Color: named colors only, hex read from `Zotero.Annotations.COLORS` at runtime.
- **Trash/undo** (SPEC open question, per notes/06): highlights are trashed with `deleted=true` (restorable at the data
  level, though Zotero's Trash view doesn't list annotations). New hook `hooks/annotation-trash-reader-sync.ts` calls
  `reader.unsetAnnotations` on every annotation `trash` notifier event (Zotero's reader only drops erased ones; verified
  the itest fails without it). `add_highlight` keeps a JSON copy in its change data; `trash` now also stores copies of
  the highlights it trashes (`TrashData.annotations`), and undo of `trash` recreates a highlight with the same key if
  the user emptied the trash meanwhile (verified live). Small edits to `src/tools/trash.ts` / `src/undo/trash.ts`.
- Not done (conservative): no duplicate detection (a second identical call creates a second highlight); no
  page prefiltering via the full-text index (`getPageData` is ~10 ms/page, the whole PDF is scanned when `page` is
  omitted, plus adjacent-page windows for page breaks).
