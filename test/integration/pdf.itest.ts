import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { callTool, request, setPluginEnabled, zeval, zotero } from "./harness";

const PDF = join(__dirname, "fixtures", "wonderland_short.pdf");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let pdfKey: string;
let missingFileKey: string;
let textKey: string;
let noteKey: string;
let fakePdfKey: string;

beforeAll(async () => {
  ({ pdfKey, missingFileKey, textKey, noteKey, fakePdfKey } = await zeval(`
    const parent = new Zotero.Item("book"); parent.setField("title", "Wonderland (pdf tools test)"); await parent.saveTx();
    const pdf = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(PDF)}, parentItemID: parent.id });
    await Zotero.Fulltext.indexItems([pdf.id], { complete: true, ignoreErrors: true });

    const gone = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(PDF)}, parentItemID: parent.id });
    await IOUtils.remove(await gone.getFilePathAsync());

    const txtPath = PathUtils.join(PathUtils.tempDir, "safe-mcp-itest.txt");
    await IOUtils.writeUTF8(txtPath, "plain text");
    const txt = await Zotero.Attachments.importFromFile({ file: txtPath, parentItemID: parent.id });

    const note = new Zotero.Item("note"); note.parentID = parent.id; note.setNote("<p>n</p>"); await note.saveTx();

    // Stored as application/pdf, but the file isn't one.
    const fakePath = PathUtils.join(PathUtils.tempDir, "safe-mcp-itest-fake.pdf");
    await IOUtils.writeUTF8(fakePath, "not a pdf at all");
    const fake = await Zotero.Attachments.importFromFile({ file: fakePath, parentItemID: parent.id, contentType: "application/pdf" });
    fake.attachmentContentType = "application/pdf"; await fake.saveTx();
    return { pdfKey: pdf.key, missingFileKey: gone.key, textKey: txt.key, noteKey: note.key, fakePdfKey: fake.key };
  `));
});

const text = (r: any) => r.content[0].text as string;

describe("GET /safe-mcp/pdf/<key>", () => {
  it("streams the attachment's PDF byte for byte", async () => {
    const res = await request(`/safe-mcp/pdf/${pdfKey}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="${pdfKey}.pdf"`);
    const original = readFileSync(PDF);
    expect(Number(res.headers["content-length"])).toBe(original.length);
    expect(res.bytes.length).toBe(original.length);
    expect(sha(res.bytes)).toBe(sha(original));
  });

  it("requires the bearer token", async () => {
    const res = await request(`/safe-mcp/pdf/${pdfKey}`, { token: null });
    expect(res.status).toBe(401);
    expect(res.bytes.subarray(0, 4).toString()).not.toBe("%PDF");
  });

  it("answers 404 for unknown keys, non-attachments, non-PDFs (by type or by content) and missing files", async () => {
    for (const key of ["ZZZZZZZZ", noteKey, textKey, missingFileKey, fakePdfKey]) {
      const res = await request(`/safe-mcp/pdf/${key}`);
      expect(res.status, key).toBe(404);
      expect(JSON.parse(res.body).error).toBeTypeOf("string");
    }
  });

  it("answers 400 for malformed keys", async () => {
    for (const path of ["/safe-mcp/pdf/abcdefgh", "/safe-mcp/pdf/..%2F..%2Fetc", `/safe-mcp/pdf/${pdfKey}x`]) {
      const res = await request(path);
      expect(res.status, path).toBe(400);
    }
  });

  it("leaves Zotero's own responses untouched and removes the patch when disabled", async () => {
    const ping = await request("/connector/ping", { token: null });
    expect(ping.status).toBe(200);

    const isPatched = `return !Zotero.Server.RequestHandler.prototype._requestFinished.toString().includes("intlStream");`;
    expect(await zeval(isPatched)).toBe(true);
    const toggle = setPluginEnabled;
    await toggle(false);
    expect(await zeval(isPatched)).toBe(false);
    await toggle(true);
    expect(await zeval(isPatched)).toBe(true);
    const res = await request(`/safe-mcp/pdf/${pdfKey}`);
    expect(sha(res.bytes)).toBe(sha(readFileSync(PDF)));
  });
});

describe("get_pdf_url", () => {
  it("returns the sandbox URL of the PDF endpoint", async () => {
    const r = await callTool("get_pdf_url", { attachmentKey: pdfKey });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.url).toBe(`http://host.docker.internal:${zotero().port}/safe-mcp/pdf/${pdfKey}`);
    expect(r.structuredContent.sizeBytes).toBe(readFileSync(PDF).length);
  });

  it("honours the pdfUrlBase pref", async () => {
    await zeval(`Zotero.Prefs.set("extensions.zotero-safe-mcp.pdfUrlBase", "http://localhost:9999/", true);`);
    try {
      const r = await callTool("get_pdf_url", { attachmentKey: pdfKey });
      expect(r.structuredContent.url).toBe(`http://localhost:9999/safe-mcp/pdf/${pdfKey}`);
    } finally {
      await zeval(`Zotero.Prefs.set("extensions.zotero-safe-mcp.pdfUrlBase", "", true);`);
    }
  });

  it("fails clearly for non-PDF attachments and missing files", async () => {
    const r1 = await callTool("get_pdf_url", { attachmentKey: textKey });
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/not a PDF/);
    const r2 = await callTool("get_pdf_url", { attachmentKey: missingFileKey });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/not available/);
  });
});

describe("read_pdf_text", () => {
  it("returns every page from the full-text index", async () => {
    const r = await callTool("read_pdf_text", { attachmentKey: pdfKey });
    expect(r.isError).toBeFalsy();
    const s = r.structuredContent;
    expect(s.source).toBe("fulltext-index");
    expect(s.totalPages).toBe(29);
    expect(s.pages).toHaveLength(29);
    expect(s.pages[1].page).toBe(2);
    expect(s.pages[1].text).toMatch(/Alice was beginning to get very tired/);
  });

  it("returns only the requested pages", async () => {
    const r = await callTool("read_pdf_text", { attachmentKey: pdfKey, pages: "2, 4-5" });
    expect(r.structuredContent.pages.map((p: any) => p.page)).toEqual([2, 4, 5]);
    expect(r.structuredContent.pages[0].text).toMatch(/Alice was beginning/);
  });

  it("rejects pages beyond the end", async () => {
    const r = await callTool("read_pdf_text", { attachmentKey: pdfKey, pages: "30" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/has 29 pages/);
  });

  it("extracts the text itself when the PDF was never indexed", async () => {
    const key = await zeval(`
      const a = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(PDF)} });
      await Zotero.DB.executeTransaction(() => Zotero.Fulltext.clearItemWords(a.id));
      const cache = Zotero.Fulltext.getItemCacheFile(a).path;
      if (await IOUtils.exists(cache)) await IOUtils.remove(cache);
      return a.key;
    `);
    const r = await callTool("read_pdf_text", { attachmentKey: key, pages: "2" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.source).toBe("pdf-worker");
    expect(r.structuredContent.pages[0].text).toMatch(/Alice was beginning/);
  });

  it("fails clearly for a non-PDF", async () => {
    const r = await callTool("read_pdf_text", { attachmentKey: textKey });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not a PDF/);
  });
});

describe("list_annotations", () => {
  it("lists the attachment's annotations with page and byLLM", async () => {
    const annotKey = await zeval(`
      const att = await Zotero.Items.getByLibraryAndKeyAsync(Zotero.Libraries.userLibraryID, ${JSON.stringify(pdfKey)});
      const a = await Zotero.Annotations.saveFromJSON(att, {
        key: Zotero.DataObjectUtilities.generateKey(), type: "highlight",
        text: "Alice was beginning to get very tired of sitting by her sister on the bank",
        comment: "user's own", color: "#5fb236", pageLabel: "2", sortIndex: "00001|000071|00230",
        position: { pageIndex: 1, rects: [[42, 552.201, 447.393, 561.608]] },
      });
      return a.key;
    `);
    const r = await callTool("list_annotations", { attachmentKey: pdfKey });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.annotations).toContainEqual({
      key: annotKey,
      type: "highlight",
      color: "#5fb236",
      colorName: "green",
      text: "Alice was beginning to get very tired of sitting by her sister on the bank",
      comment: "user's own",
      page: "2",
      pageIndex: 1,
      byLLM: false,
    });
  });

  it("fails clearly for a note key", async () => {
    const r = await callTool("list_annotations", { attachmentKey: noteKey });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not an attachment/);
  });
});
