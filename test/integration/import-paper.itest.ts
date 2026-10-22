// import_paper end to end. The DOI and arXiv tests use the network (Zotero's translators reach
// crossref/doi.org and arxiv.org; in the sbx sandbox through its proxy).
import { beforeAll, describe, expect, it } from "vitest";
import { callTool, zeval } from "./harness";

const NET = 120_000;
const text = (r: any) => r.content[0].text as string;

let collectionKey: string;

beforeAll(async () => {
  ({ collectionKey } = await zeval(`
    const c = new Zotero.Collection(); c.name = "Import test collection"; await c.saveTx();
    return { collectionKey: c.key };
  `));
});

const itemCount = () => zeval(`return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID, false, true)).length;`);
const changeCount = async () => (await callTool("list_changes", { limit: 200 })).structuredContent.changes.length;

async function item(key: string) {
  return zeval(`
    const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    if (!i) return null;
    return { deleted: i.deleted, itemType: i.itemType, parentKey: i.parentKey || null,
             title: i.isNote() ? null : i.getField("title"), DOI: i.isRegularItem() ? i.getField("DOI") : null,
             collections: i.getCollections().map((id) => Zotero.Collections.get(id).key),
             children: i.isRegularItem() ? [...i.getAttachments(), ...i.getNotes()].map((id) => Zotero.Items.get(id).key) : [],
             fileExists: i.isAttachment() && i.isFileAttachment() ? await i.fileExists() : null };
  `);
}

describe("import_paper refusals (no network, no side effects)", () => {
  it("refuses URLs, paths and multiple identifiers without importing anything", async () => {
    const [items, changes] = [await itemCount(), await changeCount()];
    for (const identifier of ["https://doi.org/10.1038/nature12373", "/home/me/paper.pdf", "1706.03762 23193287", ""]) {
      const r = await callTool("import_paper", { identifier });
      expect(r.isError, identifier).toBe(true);
    }
    expect(text(await callTool("import_paper", { identifier: "https://doi.org/10.1038/nature12373" }))).toMatch(/bare DOI.*10\.1038\/nature12373/);
    expect([await itemCount(), await changeCount()]).toEqual([items, changes]);
  });

  it("an unknown collectionKey fails before any lookup or import", async () => {
    const [items, changes] = [await itemCount(), await changeCount()];
    const t0 = Date.now();
    const r = await callTool("import_paper", { identifier: "10.1038/nature12373", collectionKey: "ZZZZZZZZ" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/No collection with key ZZZZZZZZ/);
    expect(Date.now() - t0).toBeLessThan(1000); // no network round trip
    expect([await itemCount(), await changeCount()]).toEqual([items, changes]);
  });
});

describe("import_paper over the network", () => {
  it("imports a DOI into a collection with its PDF; everything created is owned and undo trashes it", { timeout: NET }, async () => {
    const r = await callTool("import_paper", { identifier: "doi:10.1038/nature12373", collectionKey });
    expect(r.isError, text(r)).toBeFalsy();
    const out = r.structuredContent;
    expect(out).toMatchObject({ identifier: { type: "DOI", value: "10.1038/nature12373" }, complete: true });
    expect(out.changeId).toMatch(/^chg_/);
    expect(out.title).toMatch(/thermometry/i);

    const paper = await item(out.itemKey);
    expect(paper).toMatchObject({ deleted: false, itemType: "journalArticle", DOI: "10.1038/nature12373", collections: [collectionKey] });
    // Every child Zotero created is reported (and, below, owned by this change).
    expect(paper.children.sort()).toEqual([...out.attachments.map((a: any) => a.key), ...out.notes].sort());
    expect(out.pdfAttachmentKey).toMatch(/^[A-Z0-9]{8}$/);
    expect(await item(out.pdfAttachmentKey)).toMatchObject({ parentKey: out.itemKey, fileExists: true });
    expect((await callTool("read_pdf_text", { attachmentKey: out.pdfAttachmentKey, pages: "1" })).isError).toBeFalsy();

    const [latest] = (await callTool("list_changes", { limit: 1 })).structuredContent.changes;
    expect(latest).toMatchObject({ changeId: out.changeId, tool: "import_paper" });
    expect(latest.summary).toContain(out.itemKey);
    expect(latest.summary).toContain("DOI 10.1038/nature12373");

    const u = await callTool("undo", { changeId: out.changeId });
    expect(u.isError, text(u)).toBeFalsy();
    for (const key of [out.itemKey, ...paper.children]) expect((await item(key)).deleted, key).toBe(true);
  });

  it("imports an arXiv ID with PDF, snapshot and the translator's note, all owned (trash accepts them)", { timeout: NET }, async () => {
    const r = await callTool("import_paper", { identifier: "arXiv:1706.03762v5" });
    expect(r.isError, text(r)).toBeFalsy();
    const out = r.structuredContent;
    expect(out).toMatchObject({ identifier: { type: "arXiv", value: "1706.03762" }, complete: true });
    expect(out.title).toMatch(/Attention Is All You Need/i);
    expect(await item(out.itemKey)).toMatchObject({ itemType: "preprint", collections: [] });
    expect(out.attachments.map((a: any) => a.contentType)).toContain("application/pdf");
    expect(out.pdfAttachmentKey).toBe(out.attachments.find((a: any) => a.contentType === "application/pdf").key);

    // trash only accepts owned items: the paper, each attachment and each note created by the translator.
    const children = [...out.attachments.map((a: any) => a.key), ...out.notes];
    const t = await callTool("trash", { itemKeys: [...children, out.itemKey] });
    expect(t.isError, text(t)).toBeFalsy();
    for (const key of [out.itemKey, ...children]) expect((await item(key)).deleted, key).toBe(true);
  });
});

describe("import_paper duplicate check", () => {
  // A paper the user added by hand; `fields` are set with setField.
  const userPaper = (itemType: string, fields: Record<string, string>, trashed = false) => zeval(`
    const i = new Zotero.Item(${JSON.stringify(itemType)});
    for (const [k, v] of Object.entries(${JSON.stringify(fields)})) i.setField(k, v);
    if (${trashed}) i.deleted = true;
    await i.saveTx();
    return i.key;
  `);

  it("returns the user's existing item (DOI in Extra, arXiv in URL, PMID in Extra) without importing, recording or filing", async () => {
    const tag = Date.now();
    const doiKey = await userPaper("report", { title: "Report", extra: `DOI: 10.5555/DUP-${tag}` });
    const arxivKey = await userPaper("preprint", { title: "Preprint", url: "https://arxiv.org/abs/2101.00001v3" });
    const pmidKey = await userPaper("journalArticle", { title: "Article", extra: "PMID: 987654321" });
    const [items, changes] = [await itemCount(), await changeCount()];

    for (const [identifier, key] of [[`10.5555/dup-${tag}`, doiKey], ["arXiv:2101.00001v1", arxivKey], ["PMID: 987654321", pmidKey]]) {
      const t0 = Date.now();
      const r = await callTool("import_paper", { identifier, collectionKey });
      expect(r.isError, text(r)).toBeFalsy();
      expect(r.structuredContent).toMatchObject({ duplicate: true, itemKey: key });
      expect(r.structuredContent.changeId).toBeUndefined();
      expect(r.structuredContent.message).toMatch(/not added to the collection/i);
      expect(Date.now() - t0).toBeLessThan(2000); // no translator lookup
      expect(await item(key)).toMatchObject({ deleted: false, collections: [] });
    }
    expect([await itemCount(), await changeCount()]).toEqual([items, changes]);
    // Still the user's: the agent cannot trash it.
    expect((await callTool("trash", { itemKeys: [doiKey] })).isError).toBe(true);
  });

  it("importing the same DOI twice yields one item; a trashed copy does not count", { timeout: 3 * NET }, async () => {
    const doi = "10.1093/nar/gks1195";
    await userPaper("journalArticle", { title: "Trashed copy", DOI: doi }, true);
    // The lookup sometimes fails transiently in the sandbox (no items returned, or no answer in 30 s);
    // a failed lookup imports nothing, so retrying is safe.
    let first = await callTool("import_paper", { identifier: doi });
    for (let i = 0; i < 2 && first.isError && /No items returned|did not answer/.test(text(first)); i++) {
      await new Promise((r) => setTimeout(r, 3000));
      first = await callTool("import_paper", { identifier: doi });
    }
    expect(first.isError, text(first)).toBeFalsy();
    expect(first.structuredContent.duplicate).toBeUndefined();
    const changes = await changeCount();
    const items = await itemCount();

    const second = await callTool("import_paper", { identifier: `doi:${doi.toUpperCase()}` });
    expect(second.isError, text(second)).toBeFalsy();
    expect(second.structuredContent).toMatchObject({ duplicate: true, itemKey: first.structuredContent.itemKey });
    expect([await itemCount(), await changeCount()]).toEqual([items, changes]);

    await callTool("undo", { changeId: first.structuredContent.changeId });
  });
});
