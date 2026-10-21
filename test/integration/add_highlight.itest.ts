// add_highlight end to end on wonderland_short.pdf (and a generated PDF with line-end hyphenation):
// positions checked against the glyphs they cover, color rule, errors, undo/trash with open readers.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTool, zeval } from "./harness";

const PDF = join(__dirname, "fixtures", "wonderland_short.pdf");
const text = (r: any) => r.content[0].text as string;

/** A one-page PDF (Helvetica 12 pt) with these lines, 14 pt apart from y = 700. */
function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 12 Tf 14 TL 72 700 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

let pdfKey: string;
let hyphenKey: string;
let parentKey: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "safe-mcp-hl-"));
  const hyphenPdf = join(dir, "hyphen.pdf");
  writeFileSync(hyphenPdf, makePdf(["So she was considering whether the pleasure of making a daisy-", "chain would be worth the trouble of getting up and picking the dai-", "sies, when suddenly a White Rabbit ran close by her."]));
  ({ pdfKey, hyphenKey, parentKey } = await zeval(`
    const parent = new Zotero.Item("book"); parent.setField("title", "Wonderland (highlight test)"); await parent.saveTx();
    const pdf = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(PDF)}, parentItemID: parent.id });
    const hy = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(hyphenPdf)}, parentItemID: parent.id });
    return { pdfKey: pdf.key, hyphenKey: hy.key, parentKey: parent.key };
  `));
});

afterAll(async () => {
  await zeval(`for (const r of Zotero.Reader._readers.slice()) Zotero.getMainWindow().Zotero_Tabs.close(r.tabID); return true;`);
});

async function annotation(key: string) {
  return zeval(`
    const a = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    return a ? { deleted: a.deleted, parentKey: a.parentKey, type: a.annotationType, text: a.annotationText,
      comment: a.annotationComment, color: a.annotationColor, pageLabel: a.annotationPageLabel,
      sortIndex: a.annotationSortIndex, position: JSON.parse(a.annotationPosition) } : null;
  `);
}

/**
 * The text of the glyphs whose centers lie inside the rects (independent of the plugin's matcher):
 * what a reader would show as highlighted.
 */
async function coveredText(attachmentKey: string, position: any): Promise<string> {
  return zeval(`
    const att = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(attachmentKey)});
    const win = Zotero.getMainWindow();
    const pdfjs = await win.eval("import('resource://zotero/reader/pdf/build/pdf.mjs')");
    pdfjs.GlobalWorkerOptions.workerSrc = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';
    const doc = await pdfjs.getDocument({ data: await IOUtils.read(await att.getFilePathAsync()) }).promise;
    const pos = ${JSON.stringify(position)};
    const parts = [];
    for (const [pageIndex, rects] of [[pos.pageIndex, pos.rects], [pos.pageIndex + 1, pos.nextPageRects || []]]) {
      if (!rects.length) continue;
      const { chars } = await doc.getPageData({ pageIndex });
      let s = "";
      for (const ch of chars) {
        const [x1, y1, x2, y2] = ch.rect, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        if (rects.some(([a, b, c, d]) => cx >= a && cx <= c && cy >= b && cy <= d)) {
          s += ch.c + (ch.spaceAfter || ch.lineBreakAfter ? " " : "");
        }
      }
      parts.push(s.trim());
    }
    await doc.destroy();
    return parts.join(" | ");
  `);
}

describe("add_highlight", () => {
  it("highlights a passage spanning a line break, with the exact rects/sortIndex the reader produces", async () => {
    const r = await callTool("add_highlight", {
      attachmentKey: pdfKey,
      text: "Alice was beginning to get very tired of sitting by her sister on the bank",
      comment: "first sentence",
    });
    expect(r.isError, text(r)).toBeFalsy();
    const { changeId, annotationKey } = r.structuredContent;
    expect(changeId).toMatch(/^chg_/);
    expect(r.structuredContent).toMatchObject({ page: 2, pageLabel: "2", color: "yellow", comment: "[LLM] first sentence" });

    const a = await annotation(annotationKey);
    // Values from a manual selection in Zotero's reader (notes/06-annotations.md, LIVE).
    expect(a).toMatchObject({
      deleted: false,
      parentKey: pdfKey,
      type: "highlight",
      text: "Alice was beginning to get very tired of sitting by her sister on the bank",
      comment: "[LLM] first sentence",
      color: "#ffd400",
      pageLabel: "2",
      sortIndex: "00001|000071|00230",
      position: { pageIndex: 1, rects: [[42, 552.201, 447.393, 561.608], [42, 540.201, 65.496, 549.608]] },
    });
    expect(await coveredText(pdfKey, a.position)).toBe("Alice was beginning to get very tired of sitting by her sister on the bank");

    const listed = (await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations;
    expect(listed.find((x: any) => x.key === annotationKey)).toMatchObject({ byLLM: true, colorName: "yellow", page: "2" });
  });

  it("highlights a passage that continues on the next page", async () => {
    const r = await callTool("add_highlight", { attachmentKey: pdfKey, text: "Alice felt that she was dozing off, when suddenly, thump! thump!", color: "Blue" });
    expect(r.isError, text(r)).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ page: 2, continuesOnPage: 3, color: "blue" });
    const a = await annotation(r.structuredContent.annotationKey);
    expect(a.color).toBe("#2ea8e5");
    expect(a.position.pageIndex).toBe(1);
    expect(a.position.nextPageRects).toHaveLength(1);
    expect(a.text).toBe("Alice felt that she was dozing off, when suddenly, thump! thump!");
    expect(await coveredText(pdfKey, a.position)).toBe("Alice felt that she was dozing off, when | suddenly, thump! thump!");
  });

  it("matches words hyphenated at line ends when quoted without the hyphen", async () => {
    const r = await callTool("add_highlight", {
      attachmentKey: hyphenKey,
      text: "making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly",
    });
    expect(r.isError, text(r)).toBeFalsy();
    const a = await annotation(r.structuredContent.annotationKey);
    expect(a.position.rects).toHaveLength(3);
    // Zotero's pdf.js marks line-end hyphens ignorable: the stored text drops them, as for a manual selection.
    expect(a.text).toBe("making a daisychain would be worth the trouble of getting up and picking the daisies, when suddenly");
    expect(await coveredText(hyphenKey, a.position)).toBe(
      "making a daisy- chain would be worth the trouble of getting up and picking the dai- sies, when suddenly",
    );
  });

  it("refuses green and hex colors without creating anything", async () => {
    const before = (await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations.length;
    for (const color of ["green", "GREEN", "#ffd400", "#5fb236"]) {
      const r = await callTool("add_highlight", { attachmentKey: pdfKey, text: "Down, down, down", color });
      expect(r.isError, color).toBe(true);
    }
    expect((await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations.length).toBe(before);
  });

  it("fails clearly for passages that are missing or ambiguous, and accepts page/occurrence", async () => {
    const missing = await callTool("add_highlight", { attachmentKey: pdfKey, text: "the Jabberwock with eyes of flame" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/not found/);

    const ambiguous = await callTool("add_highlight", { attachmentKey: pdfKey, text: "White Rabbit" });
    expect(ambiguous.isError).toBe(true);
    expect(text(ambiguous)).toMatch(/occurs \d+ times/);

    const picked = await callTool("add_highlight", { attachmentKey: pdfKey, text: "White Rabbit", page: 2, occurrence: 1, color: "purple" });
    expect(picked.isError, text(picked)).toBeFalsy();
    const a = await annotation(picked.structuredContent.annotationKey);
    expect(await coveredText(pdfKey, a.position)).toBe("White Rabbit");
    expect(a.position.pageIndex).toBe(1);
  });

  it("refuses non-PDF attachments and regular items", async () => {
    const r = await callTool("add_highlight", { attachmentKey: parentKey, text: "Alice" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not an attachment/);
  });

  it("undo trashes the highlight, and an open reader drops it", async () => {
    await zeval(`const a = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, "${pdfKey}");
      const r = await Zotero.Reader.open(a.id); await r._initPromise; return true;`);
    const r = await callTool("add_highlight", { attachmentKey: pdfKey, text: "Down, down, down. Would the fall never come to an end!", color: "red" });
    expect(r.isError, text(r)).toBeFalsy();
    const key = r.structuredContent.annotationKey;
    /** Whether the open reader shows the highlight, waiting up to 5 s for it to become `expected`. */
    const inReader = (expected: boolean) =>
      zeval(`const r = Zotero.Reader._readers.find((x) => x.itemID === Zotero.Items.getIDFromLibraryAndKey(Zotero.Libraries.userLibraryID, "${pdfKey}"));
        const shown = () => r._internalReader._state.annotations.some((x) => x.id === "${key}");
        for (let i = 0; i < 50 && shown() !== ${expected}; i++) await Zotero.Promise.delay(100);
        return shown();`);
    expect(await inReader(true)).toBe(true);

    const u = await callTool("undo", { changeId: r.structuredContent.changeId });
    expect(u.isError, text(u)).toBeFalsy();
    expect((await annotation(key)).deleted).toBe(true);
    expect(await inReader(false)).toBe(false);
    const listed = (await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations;
    expect(listed.some((x: any) => x.key === key)).toBe(false);
  });

  it("trash + undo restores a highlight, even after the user emptied the trash", async () => {
    const r = await callTool("add_highlight", { attachmentKey: pdfKey, text: "Either the well was very deep, or she fell very slowly", color: "orange", comment: "[LLM] well" });
    expect(r.isError, text(r)).toBeFalsy();
    const key = r.structuredContent.annotationKey;
    expect(r.structuredContent.comment).toBe("[LLM] well");
    const original = await annotation(key);

    const t = await callTool("trash", { itemKeys: [key] });
    expect(t.isError, text(t)).toBeFalsy();
    expect((await annotation(key)).deleted).toBe(true);
    // The user empties the trash: the annotation is erased.
    await zeval(`await Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, "${key}").eraseTx(); return true;`);
    expect(await annotation(key)).toBeNull();

    const u = await callTool("undo", { changeId: t.structuredContent.changeId });
    expect(u.isError, text(u)).toBeFalsy();
    expect(await annotation(key)).toEqual(original);
    const listed = (await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations;
    expect(listed.find((x: any) => x.key === key)).toMatchObject({ byLLM: true, colorName: "orange" });
  });
});
