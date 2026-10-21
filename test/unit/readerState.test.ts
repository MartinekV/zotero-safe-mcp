import { describe, it, expect } from "vitest";
import { readReaderState, ReaderEnv } from "../../src/zotero/readerState";

/** A fake of the Zotero objects the module reads, shaped like Zotero 10.0.6 (see notes/09-reader-state.md). */
function fakeEnv(opts: { tabType?: string; selectionRanges?: any[]; popupText?: string; internalReader?: any } = {}): ReaderEnv {
  const parent = { key: "PARENT01" };
  const attachment = { key: "ATTACH01", parentItem: parent };
  const internalReader = opts.internalReader ?? {
    _state: {
      primaryViewStats: { pageIndex: 1, pageLabel: "2", pagesCount: 68, canCopy: 0 },
      primaryViewSelectionPopup: opts.popupText === undefined ? null : { rect: [0, 0, 1, 1], annotation: { text: opts.popupText } },
    },
    _primaryView: { _selectionRanges: opts.selectionRanges ?? [] },
  };
  const reader = { itemID: 7, type: "pdf", tabID: "tab-1", _internalReader: internalReader };
  return {
    getMainWindow: () => ({ Zotero_Tabs: { selectedID: "tab-1", selectedType: opts.tabType ?? "reader" } }),
    getReaderByTabID: (id) => (id === "tab-1" ? reader : undefined),
    getItem: (id) => (id === 7 ? attachment : undefined),
  };
}

const EMPTY = { open: false, itemKey: null, attachmentKey: null, readerType: null, page: null, selectedText: null };

describe("readReaderState", () => {
  it("returns an empty state when there is no main window", () => {
    const env: ReaderEnv = { getMainWindow: () => null, getReaderByTabID: () => undefined, getItem: () => undefined };
    expect(readReaderState(env)).toEqual(EMPTY);
  });

  it("reports the active PDF reader's item, attachment and page", () => {
    expect(readReaderState(fakeEnv())).toEqual({
      open: true,
      itemKey: "PARENT01",
      attachmentKey: "ATTACH01",
      readerType: "pdf",
      page: { index: 1, label: "2", count: 68 },
      selectedText: null,
    });
  });

  it("returns the selected text, joining multi-page ranges and skipping collapsed ones", () => {
    const selectionRanges = [
      { pageIndex: 1, text: "end of page two", collapsed: false },
      { pageIndex: 2, text: "start of page three", collapsed: false },
      { pageIndex: 2, text: "", collapsed: true },
    ];
    expect(readReaderState(fakeEnv({ selectionRanges })).selectedText).toBe("end of page two\nstart of page three");
  });

  it("returns null selected text when the selection is collapsed", () => {
    const selectionRanges = [{ pageIndex: 1, text: "", collapsed: true }];
    expect(readReaderState(fakeEnv({ selectionRanges })).selectedText).toBeNull();
  });

  it("still reports the open reader when its internals throw, with a warning instead of page and text", () => {
    const internalReader = {
      get _state() {
        throw new Error("dead object");
      },
      get _primaryView() {
        throw new Error("dead object");
      },
    };
    const state = readReaderState(fakeEnv({ internalReader }));
    expect(state).toMatchObject({ open: true, attachmentKey: "ATTACH01", page: null, selectedText: null });
    expect(state.warnings).toEqual([
      "Current page unavailable: dead object",
      "Selected text unavailable: dead object",
    ]);
  });

  it("falls back to the selection popup when the view has no selection ranges (e.g. a changed reader version)", () => {
    const internalReader = {
      _state: { primaryViewSelectionPopup: { annotation: { text: "popup text" } } },
      _primaryView: {},
    };
    expect(readReaderState(fakeEnv({ internalReader })).selectedText).toBe("popup text");
  });

  it("in split view, reports the view the user last worked in", () => {
    const internalReader = {
      _lastViewPrimary: false,
      _state: {
        primaryViewStats: { pageIndex: 0, pageLabel: "1", pagesCount: 68 },
        secondaryViewStats: { pageIndex: 9, pageLabel: "10", pagesCount: 68 },
      },
      _primaryView: { _selectionRanges: [{ text: "left", collapsed: false }] },
      _secondaryView: { _selectionRanges: [{ text: "right", collapsed: false }] },
    };
    expect(readReaderState(fakeEnv({ internalReader }))).toMatchObject({
      page: { index: 9, label: "10", count: 68 },
      selectedText: "right",
    });
  });

  it("reads the selection from the Reading Mode overlay when it is active (DOM selection)", () => {
    const internalReader = {
      _state: { primaryViewStats: { pageIndex: 3, pageLabel: "4", pagesCount: 68 } },
      _primaryView: { _selectionRanges: [] },
      _primarySDTView: { _iframeWindow: { getSelection: () => ({ toString: () => "reading mode text" }) } },
    };
    expect(readReaderState(fakeEnv({ internalReader })).selectedText).toBe("reading mode text");
  });
});
