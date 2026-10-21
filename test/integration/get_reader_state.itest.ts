import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { join } from "node:path";
import { callTool, zeval } from "./harness";

const pdf = join(__dirname, "fixtures", "wonderland_short.pdf");

/** Closes every reader tab and selects the library tab. */
const closeReaders = () =>
  zeval(`const tabs = Zotero.getMainWindow().Zotero_Tabs;
    for (const r of [...Zotero.Reader._readers]) if (r.tabID) tabs.close(r.tabID);
    tabs.select("zotero-pane");
    return true;`);

/**
 * Double-clicks (synthetic mousedown with detail 2) the first word longer than 3 characters on the
 * given 1-based page of the active reader, which selects that word. Returns the word.
 * pdf.js renders a page's text layer some time after the page becomes current, so wait for it.
 */
const doubleClickWord = (pageNumber: number) =>
  zeval(`const r = Zotero.Reader.getByTabID(Zotero.getMainWindow().Zotero_Tabs.selectedID);
    const w = r._internalReader._primaryView._iframeWindow, d = w.document;
    let span;
    for (let i = 0; i < 100 && !span; i++) {
      span = [...d.querySelectorAll('.page[data-page-number="${pageNumber}"] .textLayer span')]
        .find((s) => /^[A-Za-z]{4,}$/.test(s.textContent));
      if (!span) await Zotero.Promise.delay(100);
    }
    if (!span) throw new Error("page ${pageNumber}'s text layer never rendered");
    const rc = span.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2, button: 0, buttons: 1, detail: 2 };
    span.dispatchEvent(new w.MouseEvent("mousedown", Cu.cloneInto(opts, w)));
    span.dispatchEvent(new w.PointerEvent("pointerup", Cu.cloneInto({ ...opts, buttons: 0, pointerType: "mouse" }, w)));
    return span.textContent;`);

/** A plain click in the page margin, which collapses the selection. */
const clickMargin = (pageNumber: number) =>
  zeval(`const r = Zotero.Reader.getByTabID(Zotero.getMainWindow().Zotero_Tabs.selectedID);
    const w = r._internalReader._primaryView._iframeWindow, d = w.document;
    const rc = d.querySelector('.page[data-page-number="${pageNumber}"]').getBoundingClientRect();
    const target = d.elementFromPoint(rc.left + 5, rc.top + 5);
    const opts = { bubbles: true, cancelable: true, clientX: rc.left + 5, clientY: rc.top + 5, button: 0, buttons: 1, detail: 1 };
    target.dispatchEvent(new w.MouseEvent("mousedown", Cu.cloneInto(opts, w)));
    target.dispatchEvent(new w.PointerEvent("pointerup", Cu.cloneInto({ ...opts, buttons: 0, pointerType: "mouse" }, w)));
    return true;`);

const state = async () => {
  const result = await callTool("get_reader_state");
  expect(result.isError).toBeFalsy();
  return result.structuredContent;
};

/** The reader updates its selection state asynchronously after a click: poll until `ok`, then return the state. */
const stateWhen = async (ok: (s: any) => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let s = await state();
  while (!ok(s) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    s = await state();
  }
  return s;
};

describe("get_reader_state in a real Zotero", () => {
  let keys: { parent: string; att: string };

  beforeAll(async () => {
    keys = await zeval(`const p = new Zotero.Item("book"); p.setField("title", "Reader state test"); await p.saveTx();
      const a = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(pdf)}, parentItemID: p.id });
      return { parent: p.key, att: a.key };`);
  });

  afterAll(closeReaders);

  it("returns an empty state when no reader is open", async () => {
    await closeReaders();
    expect(await state()).toEqual({
      open: false,
      itemKey: null,
      attachmentKey: null,
      readerType: null,
      page: null,
      selectedText: null,
    });
  });

  it("reports the open item, attachment and current page", async () => {
    await zeval(`const a = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, "${keys.att}");
      const r = await Zotero.Reader.open(a.id, { pageIndex: 1 });
      await r._initPromise;
      for (let i = 0; i < 100 && r._internalReader?._state?.primaryViewStats?.pageIndex !== 1; i++) await Zotero.Promise.delay(100);
      return true;`);
    expect(await state()).toEqual({
      open: true,
      itemKey: keys.parent,
      attachmentKey: keys.att,
      readerType: "pdf",
      page: { index: 1, label: "2", count: 29 },
      selectedText: null,
    });
  });

  it("returns the selected text, and null again once the selection is dismissed", async () => {
    const word = await doubleClickWord(2);
    expect(word).toMatch(/^[A-Za-z]{4,}$/);
    expect((await stateWhen((s) => s.selectedText !== null)).selectedText).toBe(word);

    await clickMargin(2);
    expect((await stateWhen((s) => s.selectedText === null)).selectedText).toBeNull();
  });

  it("returns an empty state again when the library tab is selected", async () => {
    await zeval(`Zotero.getMainWindow().Zotero_Tabs.select("zotero-pane"); return true;`);
    expect((await state()).open).toBe(false);
  });
});
