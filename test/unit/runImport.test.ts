// import_paper's orchestration (src/import/runImport.ts) against a fake Zotero: what gets recorded as
// owned and when, and that slow network steps never hold the call (and so the write queue) for long.
// Fake timers: the budgets are checked against the fake clock, so the results don't depend on load.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "../../src/registry/types";
import { runImport, type ImportPorts, type SavedObject } from "../../src/import/runImport";

const DOI = { type: "DOI", value: "10.1038/nature12373" } as const;
const PAPER: SavedObject = { key: "PAPERAAA", kind: "paper", title: "Nanometre-scale thermometry" };
const NOTE: SavedObject = { key: "NOTEAAAA", kind: "note", parentKey: PAPER.key };
const PDF: SavedObject = { key: "PDFAAAAA", kind: "attachment", contentType: "application/pdf", title: "Full Text", parentKey: PAPER.key };
const SNAP: SavedObject = { key: "SNAPAAAA", kind: "attachment", contentType: "text/html", title: "Snapshot", parentKey: PAPER.key };
const USER_NOTE: SavedObject = { key: "USERNOTE", kind: "note", parentKey: PAPER.key };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Runs `p` to completion, firing every pending fake timer in time order (budgets included). */
async function settle<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {}); // rejections are checked by the caller after the timers ran
  await vi.runAllTimersAsync();
  return p;
}
function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

/** A fake library + change log. */
function fake(over: Partial<ImportPorts> = {}) {
  const owned = new Map<string, string[]>(); // changeId → keys
  const calls: string[] = [];
  const discarded: string[] = [];
  let n = 0;
  const ports: ImportPorts = {
    lookup: async () => (calls.push("lookup"), [{ itemType: "journalArticle" }]),
    async save(_json, onSaved, onAttachment) {
      calls.push("save");
      onSaved([PAPER, NOTE]); // translator notes are saved with the item
      await sleep(5);
      onAttachment(PDF); // attachments download afterwards
    },
    async findPdf() {
      calls.push("findPdf");
      return null;
    },
    async record(objects) {
      const id = `chg_${++n}`;
      owned.set(id, objects.map((o) => o.key));
      return id;
    },
    async addLate(changeId, objects) {
      owned.get(changeId)!.push(...objects.map((o) => o.key));
    },
    async discard(keys) {
      discarded.push(...keys);
    },
    log: () => {},
    ...over,
  };
  return { ports, owned, calls, discarded };
}

const opts = { lookupTimeoutMs: 100, attachmentTimeoutMs: 100, findPdf: true };

describe("runImport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records the item, its translator notes and its downloaded attachments under one change", async () => {
    const f = fake();
    const r = await settle(runImport(DOI, f.ports, opts));
    expect(r).toMatchObject({
      changeId: "chg_1",
      itemKey: PAPER.key,
      title: PAPER.title,
      pdfAttachmentKey: PDF.key,
      complete: true,
    });
    expect(r.attachments).toEqual([PDF]);
    expect(r.notes).toEqual([NOTE.key]);
    expect(f.owned.get("chg_1")!.sort()).toEqual([NOTE.key, PAPER.key, PDF.key].sort());
    expect(f.calls).not.toContain("findPdf"); // the translator already gave a PDF
  });

  it("looks for an available PDF when the translator gave none, and records it as owned", async () => {
    const f = fake({
      async save(_j, onSaved, onAttachment) {
        onSaved([PAPER]);
        onAttachment(SNAP);
      },
      async findPdf() {
        f.calls.push("findPdf");
        return PDF;
      },
    });
    const r = await settle(runImport(DOI, f.ports, opts));
    expect(f.calls).toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: PDF.key, complete: true });
    expect(r.attachments).toEqual([SNAP, PDF]);
    expect(f.owned.get("chg_1")!.sort()).toEqual([PAPER.key, PDF.key, SNAP.key].sort());
  });

  it("does not look for a PDF when that is turned off; reports none", async () => {
    const f = fake({ async save(_j, onSaved) { onSaved([PAPER]); } });
    const r = await settle(runImport(DOI, f.ports, { ...opts, findPdf: false }));
    expect(f.calls).not.toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: null, complete: true, attachments: [] });
  });

  it("a PDF search that finds nothing is not an error", async () => {
    const f = fake({ async save(_j, onSaved) { onSaved([PAPER]); } });
    const r = await settle(runImport(DOI, f.ports, opts));
    expect(f.calls).toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: null, complete: true });
    expect(f.owned.get("chg_1")).toEqual([PAPER.key]);
  });

  it("gives up on a lookup that does not answer in time, and saves nothing (even if it answers later)", async () => {
    const late = deferred<unknown[]>();
    const f = fake({ lookup: () => late.promise });
    const t0 = Date.now();
    await expect(settle(runImport(DOI, f.ports, { ...opts, lookupTimeoutMs: 30 }))).rejects.toThrow(ToolError);
    expect(Date.now() - t0).toBe(30); // gave up exactly at the budget
    late.resolve([{ itemType: "journalArticle" }]);
    await vi.runAllTimersAsync(); // let the late work finish
    expect(f.calls).not.toContain("save");
    expect(f.owned.size).toBe(0);
  });

  it("a failed lookup (no record found) is a ToolError naming the identifier; nothing is saved", async () => {
    const f = fake({ lookup: () => Promise.reject("No items returned from any translator") });
    await expect(settle(runImport(DOI, f.ports, opts))).rejects.toThrow(/10\.1038\/nature12373.*No items returned/);
    expect(f.calls).not.toContain("save");
    const g = fake({ lookup: async () => [] });
    await expect(settle(runImport(DOI, g.ports, opts))).rejects.toThrow(/found nothing/i);
  });

  it("a save that fails before the item exists is a ToolError and records nothing", async () => {
    const f = fake({ save: () => Promise.reject(new Error("DB locked")) });
    await expect(settle(runImport(DOI, f.ports, opts))).rejects.toThrow(/DB locked/);
    expect(f.owned.size).toBe(0);
  });

  it("returns once the attachment budget is used up; attachments finishing later are still recorded under that change", async () => {
    const download = deferred();
    const f = fake({
      async save(_j, onSaved, onAttachment) {
        onSaved([PAPER]);
        await download.promise;
        onAttachment(PDF);
      },
    });
    const t0 = Date.now();
    const r = await settle(runImport(DOI, f.ports, { ...opts, attachmentTimeoutMs: 30 }));
    expect(Date.now() - t0).toBe(30); // gave up exactly at the budget
    expect(r).toMatchObject({ changeId: "chg_1", itemKey: PAPER.key, complete: false, pdfAttachmentKey: null });
    expect(r.message).toMatch(/still/i);
    expect(f.owned.get("chg_1")).toEqual([PAPER.key]);

    download.resolve();
    await vi.runAllTimersAsync(); // let the late work finish
    expect(f.owned.get("chg_1")).toEqual([PAPER.key, PDF.key]);
    expect(f.calls).not.toContain("findPdf");
  });

  it("a slow PDF search also runs on in the background and its PDF is recorded when it arrives", async () => {
    const found = deferred<SavedObject | null>();
    const f = fake({
      async save(_j, onSaved) { onSaved([PAPER]); },
      findPdf: () => found.promise,
    });
    const r = await settle(runImport(DOI, f.ports, { ...opts, attachmentTimeoutMs: 30 }));
    expect(r.complete).toBe(false);
    found.resolve(PDF);
    await vi.runAllTimersAsync(); // let the late work finish
    expect(f.owned.get("chg_1")).toEqual([PAPER.key, PDF.key]);
  });

  it("if recording the change fails, the just-saved items are moved to the trash and the call fails", async () => {
    const f = fake({ record: () => Promise.reject(new Error("disk full")) });
    await expect(settle(runImport(DOI, f.ports, opts))).rejects.toThrow(/disk full/);
    expect(f.discarded.sort()).toEqual([NOTE.key, PAPER.key].sort());
  });

  it("records only what the save step and the PDF search report, never other children the item gets meanwhile", async () => {
    const f = fake({
      async save(_j, onSaved, onAttachment) {
        onSaved([PAPER, NOTE]);
        await sleep(5);
        onAttachment(PDF);
      },
    });
    const r = await settle(runImport(DOI, f.ports, opts));
    // A note the user wrote under the new item during the downloads is not in any port's report.
    expect(f.owned.get("chg_1")!.sort()).toEqual([NOTE.key, PAPER.key, PDF.key].sort());
    expect(f.owned.get("chg_1")).not.toContain(USER_NOTE.key);
    expect(r.notes).toEqual([NOTE.key]);
    expect(r.attachments).toEqual([PDF]);
  });
});
