# 11: get_reader_state

**What to build:** `get_reader_state` returning the open item and attachment keys, current page, and selected text when obtainable (SPEC open question — answer from exploration notes; return `selectedText: null` with a reason if not reliable).

**Blocked by:** 01

**Status:** done

- [x] Works with no reader open (returns an empty state, not an error)

## Answer to the SPEC open question (selected text)

**Yes, reliably, through the reader's internal state** — verified live in headless Zotero 10.0.6.

- A synthetic double-click (`new w.MouseEvent("mousedown", {detail: 2, …})` + `pointerup`, dispatched on a
  `.textLayer span` inside `reader._internalReader._primaryView._iframeWindow`, options passed through
  `Cu.cloneInto`) selects the word. Note 09's failed attempt used `pointerdown`, which pdf-view ignores for
  `pointerType: "mouse"`; it handles `mousedown` instead.
- After that, `_primaryView._selectionRanges` holds `[{text, pageIndex, collapsed: false, …}]`,
  `_state.primaryViewSelectionPopup.annotation.text` has the same text and `primaryViewStats.canCopy` is true.
  A plain click in the margin collapses the range (`text: ""`, `collapsed: true`) and clears the popup state.
- The public `Zotero.Reader.registerEventListener("renderTextSelectionPopup", …)` event also fires headless,
  but it is not cleared when the selection is dismissed, so a cache of it goes stale. The tool reads the
  internal state instead, which is always current.

Implementation (`src/zotero/readerState.ts`): selected main-window tab must be a reader tab
(`Zotero_Tabs.selectedType === "reader"`); view = the last-used split-view half (`_lastViewPrimary`), using the
Reading Mode overlay (`_primarySDTView`/`_secondarySDTView`) when shown; text = non-collapsed
`_selectionRanges` joined by `\n` (PDF), else the view iframe's DOM selection (EPUB/snapshot/Reading Mode), else
the selection popup's text. Page and selection are each read in try/catch; a failure gives `null` plus a
`warnings` entry instead of an error.

## Comments

- Scope choice (conservative): only the selected tab of the main window counts. Readers in separate windows
  (`ReaderWindow`) and background tabs are ignored; with the library tab selected the result is `open: false`.
- `page` is PDF-only (`{index (0-based), label, count}`); EPUB/snapshot readers return `page: null`, because their
  view state is a CFI / scroll percentage rather than a page.
- EPUB/snapshot/Reading Mode selection (DOM `getSelection()`) and split view are covered by unit tests against
  fakes only, not verified live.
