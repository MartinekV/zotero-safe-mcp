// What the user has open in Zotero's reader: the active reader tab, its page and selected text.
// Page and selection come from the reader's internal (underscore) objects, which can change between
// Zotero versions, so each is read defensively: a failure becomes null plus a warning, never an error.
// Shapes verified against Zotero 10.0.6 (reader/src/common/reader.js, reader/src/pdf/pdf-view.js).
import { errorMessage } from "../util/errors";

export type ReaderState = {
  /** true when the selected tab of the main window is a reader tab. */
  open: boolean;
  /** Parent item of the open attachment (null for a standalone attachment). */
  itemKey: string | null;
  attachmentKey: string | null;
  /** "pdf" | "epub" | "snapshot" */
  readerType: string | null;
  /** 0-based page index, the page label shown in the reader, and the page count (PDF only). */
  page: { index: number; label: string | null; count: number | null } | null;
  selectedText: string | null;
  /** Present when page or selection could not be read. */
  warnings?: string[];
};

/** The few Zotero entry points this module needs (real ones in `zoteroReaderEnv`, fakes in tests). */
export type ReaderEnv = {
  getMainWindow(): any;
  getReaderByTabID(tabID: string): any;
  getItem(id: number): any;
};

export const zoteroReaderEnv: ReaderEnv = {
  getMainWindow: () => Zotero.getMainWindow(),
  getReaderByTabID: (tabID) => Zotero.Reader.getByTabID(tabID),
  getItem: (id) => Zotero.Items.get(id),
};

const EMPTY: ReaderState = { open: false, itemKey: null, attachmentKey: null, readerType: null, page: null, selectedText: null };

export function readReaderState(env: ReaderEnv = zoteroReaderEnv): ReaderState {
  const tabs = env.getMainWindow()?.Zotero_Tabs;
  if (!tabs || tabs.selectedType !== "reader") return { ...EMPTY };
  const reader = env.getReaderByTabID(tabs.selectedID);
  if (!reader) return { ...EMPTY };
  const attachment = env.getItem(reader.itemID);
  const warnings: string[] = [];
  const state: ReaderState = {
    open: true,
    itemKey: attachment?.parentItem?.key ?? null,
    attachmentKey: attachment?.key ?? null,
    readerType: reader.type ?? null,
    page: attempt("Current page", warnings, () => readPage(reader)),
    selectedText: attempt("Selected text", warnings, () => readSelectedText(reader)),
  };
  if (warnings.length) state.warnings = warnings;
  return state;
}

function attempt<T>(what: string, warnings: string[], read: () => T): T | null {
  try {
    return read();
  } catch (e) {
    warnings.push(`${what} unavailable: ${errorMessage(e)}`);
    return null;
  }
}

/** "primary" or "secondary": the split-view half the user last worked in (`_lastView` in reader.js). */
function activeView(ir: any): "primary" | "secondary" {
  return ir?._lastViewPrimary === false ? "secondary" : "primary";
}

function readPage(reader: any): ReaderState["page"] {
  const ir = reader._internalReader;
  const stats = ir?._state?.[`${activeView(ir)}ViewStats`];
  if (typeof stats?.pageIndex !== "number") return null;
  return {
    index: stats.pageIndex,
    label: typeof stats.pageLabel === "string" ? stats.pageLabel : null,
    count: typeof stats.pagesCount === "number" ? stats.pagesCount : null,
  };
}

function readSelectedText(reader: any): string | null {
  const ir = reader._internalReader;
  const which = activeView(ir);
  // The Reading Mode (SDT) overlay handles interaction while it is shown (`_getActiveView` in reader.js).
  const view = ir?.[`_${which}SDTView`] || ir?.[`_${which}View`];
  return textOfView(view) || ir?._state?.[`${which}ViewSelectionPopup`]?.annotation?.text || null;
}

function textOfView(view: any): string {
  if (!view) return "";
  // PDF view: own selection model. Same as the reader's getTextFromSelectionRanges.
  if (view._selectionRanges) {
    return Array.from(view._selectionRanges as any[])
      .filter((r) => !r.collapsed && typeof r.text === "string")
      .map((r) => r.text)
      .join("\n");
  }
  // EPUB / snapshot views keep the selection in their iframe's DOM.
  return String(view._iframeWindow?.getSelection?.() ?? "");
}
