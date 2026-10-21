// import_paper's orchestration (src/import/runImport.ts) against a fake Zotero: what gets recorded as
// owned and when, and that slow network steps never hold the call (and so the write queue) for long.
import { describe, expect, it } from "vitest";
import { ToolError } from "../../src/registry/types";
import { runImport, type ImportPorts, type SavedObject } from "../../src/import/runImport";

const DOI = { type: "DOI", value: "10.1038/nature12373" } as const;
const PAPER: SavedObject = { key: "PAPERAAA", kind: "paper", title: "Nanometre-scale thermometry" };
const NOTE: SavedObject = { key: "NOTEAAAA", kind: "note" };
const PDF: SavedObject = { key: "PDFAAAAA", kind: "attachment", contentType: "application/pdf", title: "Full Text" };
const SNAP: SavedObject = { key: "SNAPAAAA", kind: "attachment", contentType: "text/html", title: "Snapshot" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function deferred<T = void>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)));
  return { promise, resolve, reject };
}

/** A fake library + change log. `children` is what each item has right now. */
function fake(over: Partial<ImportPorts> = {}) {
  const owned = new Map<string, string[]>(); // changeId → keys
  const children = new Map<string, SavedObject[]>();
  const calls: string[] = [];
  const discarded: string[] = [];
  let n = 0;
  const ports: ImportPorts = {
    lookup: async () => (calls.push("lookup"), [{ itemType: "journalArticle" }]),
    async save(_json, onSaved) {
      calls.push("save");
      children.set(PAPER.key, [NOTE]); // translator notes are saved with the item
      onSaved([PAPER]);
      await sleep(5);
      children.get(PAPER.key)!.push(PDF); // attachments download afterwards
    },
    children: (key) => [...(children.get(key) ?? [])],
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
  return { ports, owned, children, calls, discarded };
}

const opts = { lookupTimeoutMs: 100, attachmentTimeoutMs: 100, findPdf: true };

describe("runImport", () => {
  it("records the item, its translator notes and its downloaded attachments under one change", async () => {
    const f = fake();
    const r = await runImport(DOI, f.ports, opts);
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
      async save(_j, onSaved) {
        f.children.set(PAPER.key, [SNAP]);
        onSaved([PAPER]);
      },
      async findPdf(key) {
        f.calls.push("findPdf");
        f.children.get(key)!.push(PDF);
        return PDF;
      },
    });
    const r = await runImport(DOI, f.ports, opts);
    expect(f.calls).toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: PDF.key, complete: true });
    expect(r.attachments).toEqual([SNAP, PDF]);
    expect(f.owned.get("chg_1")!.sort()).toEqual([PAPER.key, PDF.key, SNAP.key].sort());
  });

  it("does not look for a PDF when that is turned off; reports none", async () => {
    const f = fake({ async save(_j, onSaved) { onSaved([PAPER]); } });
    const r = await runImport(DOI, f.ports, { ...opts, findPdf: false });
    expect(f.calls).not.toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: null, complete: true, attachments: [] });
  });

  it("a PDF search that finds nothing is not an error", async () => {
    const f = fake({ async save(_j, onSaved) { onSaved([PAPER]); } });
    const r = await runImport(DOI, f.ports, opts);
    expect(f.calls).toContain("findPdf");
    expect(r).toMatchObject({ pdfAttachmentKey: null, complete: true });
    expect(f.owned.get("chg_1")).toEqual([PAPER.key]);
  });

  it("gives up on a lookup that does not answer in time, and saves nothing (even if it answers later)", async () => {
    const late = deferred<unknown[]>();
    const f = fake({ lookup: () => late.promise });
    const t0 = Date.now();
    await expect(runImport(DOI, f.ports, { ...opts, lookupTimeoutMs: 30 })).rejects.toThrow(ToolError);
    expect(Date.now() - t0).toBeLessThan(90);
    late.resolve([{ itemType: "journalArticle" }]);
    await sleep(10);
    expect(f.calls).not.toContain("save");
    expect(f.owned.size).toBe(0);
  });

  it("a failed lookup (no record found) is a ToolError naming the identifier; nothing is saved", async () => {
    const f = fake({ lookup: () => Promise.reject("No items returned from any translator") });
    await expect(runImport(DOI, f.ports, opts)).rejects.toThrow(/10\.1038\/nature12373.*No items returned/);
    expect(f.calls).not.toContain("save");
    const g = fake({ lookup: async () => [] });
    await expect(runImport(DOI, g.ports, opts)).rejects.toThrow(/found nothing/i);
  });

  it("a save that fails before the item exists is a ToolError and records nothing", async () => {
    const f = fake({ save: () => Promise.reject(new Error("DB locked")) });
    await expect(runImport(DOI, f.ports, opts)).rejects.toThrow(/DB locked/);
    expect(f.owned.size).toBe(0);
  });

  it("returns once the attachment budget is used up; attachments finishing later are still recorded under that change", async () => {
    const download = deferred();
    const f = fake({
      async save(_j, onSaved) {
        onSaved([PAPER]);
        await download.promise;
        f.children.set(PAPER.key, [PDF]);
      },
    });
    const t0 = Date.now();
    const r = await runImport(DOI, f.ports, { ...opts, attachmentTimeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(90);
    expect(r).toMatchObject({ changeId: "chg_1", itemKey: PAPER.key, complete: false, pdfAttachmentKey: null });
    expect(r.message).toMatch(/still/i);
    expect(f.owned.get("chg_1")).toEqual([PAPER.key]);

    download.resolve();
    await sleep(20);
    expect(f.owned.get("chg_1")).toEqual([PAPER.key, PDF.key]);
    expect(f.calls).not.toContain("findPdf");
  });

  it("a slow PDF search also runs on in the background and its PDF is recorded when it arrives", async () => {
    const found = deferred<SavedObject | null>();
    const f = fake({
      async save(_j, onSaved) { onSaved([PAPER]); },
      findPdf: () => found.promise,
    });
    const r = await runImport(DOI, f.ports, { ...opts, attachmentTimeoutMs: 30 });
    expect(r.complete).toBe(false);
    found.resolve(PDF);
    await sleep(10);
    expect(f.owned.get("chg_1")).toEqual([PAPER.key, PDF.key]);
  });

  it("if recording the change fails, the just-saved items are moved to the trash and the call fails", async () => {
    const f = fake({ record: () => Promise.reject(new Error("disk full")) });
    await expect(runImport(DOI, f.ports, opts)).rejects.toThrow(/disk full/);
    expect(f.discarded.sort()).toEqual([NOTE.key, PAPER.key].sort());
  });
});
