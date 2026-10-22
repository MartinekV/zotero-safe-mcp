import { describe, expect, it } from "vitest";
import { locateHighlight, type PdfChar, type PdfPage } from "../../src/highlight/locate";
import { ToolError } from "../../src/registry/types";

// Synthetic pdf.js getPageData() output: every glyph 5 pt wide, 10 pt high; line i has its baseline
// box at y = 700 - 20 i .. 710 - 20 i, starting at x = 50. Words are separated by spaceAfter (pdf.js
// has no space glyphs), lines end with lineBreakAfter, "¶" at the end of a line marks paragraphBreakAfter.
// A "-" ending a line after a letter is ignorable, as Zotero's pdf.js marks line-end hyphens (live-checked).
function page(lines: string[]): PdfPage {
  const chars: PdfChar[] = [];
  lines.forEach((raw, i) => {
    const para = raw.endsWith("¶");
    const line = para ? raw.slice(0, -1) : raw;
    let x = 50;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (c === " ") {
        chars[chars.length - 1].spaceAfter = true;
        x += 5;
        continue;
      }
      const rect = [x, 700 - 20 * i, x + 5, 710 - 20 * i];
      chars.push({ c, rect, inlineRect: rect });
      x += 5;
    }
    const last = chars[chars.length - 1];
    last.lineBreakAfter = true;
    if (last.c === "-" && /\p{L}/u.test(line[line.length - 2] ?? "")) last.ignorable = true;
    if (para) last.paragraphBreakAfter = true;
  });
  return { chars, viewBox: [0, 0, 612, 792] };
}

function doc(...pages: PdfPage[]) {
  return { numPages: pages.length, page: async (i: number) => pages[i] };
}

/** The rect a run of glyphs on line `line`, columns from..to (inclusive, 0-based, spaces count), covers. */
const run = (line: number, from: number, to: number) => [50 + 5 * from, 700 - 20 * line, 55 + 5 * to, 710 - 20 * line];

describe("locateHighlight", () => {
  it("finds a passage on one line: one rect over exactly its glyphs, sortIndex from page/offset/top", async () => {
    const p = page(["Alice was beginning to get very tired"]);
    const r = await locateHighlight(doc(page(["Title page"]), p), { text: "beginning to get" });
    expect(r.position).toEqual({ pageIndex: 1, rects: [run(0, 10, 25)] });
    expect(r.text).toBe("beginning to get");
    // offset = index of "b" among the page's chars (spaces are not chars): "Alicewas" = 8
    expect(r.sortIndex).toBe(`00001|000008|${String(792 - 710).padStart(5, "0")}`);
  });

  it("matches across a line break and extra whitespace: one rect per line", async () => {
    const p = page(["Alice was beginning to get very tired of sitting by her sister on the", "bank, and of having nothing to do."]);
    const r = await locateHighlight(doc(p), { text: "sister on   the\nbank, and of" });
    expect(r.position.rects).toEqual([run(0, 56, 68), run(1, 0, 11)]);
    expect(r.text).toBe("sister on the bank, and of");
  });

  it("matches a word hyphenated at a line break when quoted unhyphenated", async () => {
    const p = page(["the trouble of getting up and picking the dai-", "sies, when suddenly a White Rabbit"]);
    const r = await locateHighlight(doc(p), { text: "picking the daisies, when suddenly" });
    expect(r.position.rects).toEqual([run(0, 30, 45), run(1, 0, 18)]);
    // The rect covers the hyphen glyph, as a manual selection's does; the text drops it like Zotero's.
    expect(r.text).toBe("picking the daisies, when suddenly");
  });

  it("does not extend the highlight over punctuation the quote leaves out", async () => {
    const p = page(['it, "and what is the use of a book," thought Alice']);
    const r = await locateHighlight(doc(p), { text: "and what is the use of a book" });
    expect(r.position.rects).toEqual([run(0, 5, 33)]);
    expect(r.text).toBe("and what is the use of a book");
    const withMarks = await locateHighlight(doc(p), { text: '"and what is the use of a book,"' });
    expect(withMarks.position.rects).toEqual([run(0, 4, 35)]);
  });

  it("tolerates different punctuation and quote marks", async () => {
    const p = page(['"and what is the use of a book," thought Alice']);
    const r = await locateHighlight(doc(p), { text: "“and what is the use of a book” thought Alice" });
    expect(r.position.rects).toHaveLength(1);
  });

  it("fails clearly when the passage is not in the PDF", async () => {
    const d = doc(page(["Alice was beginning to get very tired"]));
    await expect(locateHighlight(d, { text: "the Cheshire Cat grinned" })).rejects.toThrow(ToolError);
    await expect(locateHighlight(d, { text: "the Cheshire Cat grinned" })).rejects.toThrow(/not found/);
    // a partial quote is not a match
    await expect(locateHighlight(d, { text: "very tired of sitting" })).rejects.toThrow(/not found/);
  });

  it("fails on multiple occurrences unless page or occurrence picks one", async () => {
    const d = doc(page(["Oh dear! Oh dear! I shall be too late!"]), page(["Title"]), page(["said Oh dear! again"]));
    await expect(locateHighlight(d, { text: "Oh dear!" })).rejects.toThrow(/occurs 3 times.*page\(s\) 1, 3/);
    const second = await locateHighlight(d, { text: "Oh dear!", occurrence: 2 });
    expect(second.position).toEqual({ pageIndex: 0, rects: [run(0, 9, 16)] });
    const third = await locateHighlight(d, { text: "Oh dear!", occurrence: 3 });
    expect(third.position).toEqual({ pageIndex: 2, rects: [run(0, 5, 12)] });
    const onPage3 = await locateHighlight(d, { text: "Oh dear!", page: 3 });
    expect(onPage3.position.pageIndex).toBe(2);
    await expect(locateHighlight(d, { text: "Oh dear!", page: 1 })).rejects.toThrow(/occurs 2 times on page 1/);
    const p1second = await locateHighlight(d, { text: "Oh dear!", page: 1, occurrence: 2 });
    expect(p1second.position.rects).toEqual([run(0, 9, 16)]);
    await expect(locateHighlight(d, { text: "Oh dear!", occurrence: 4 })).rejects.toThrow(/only 3 time/);
  });

  it("says where the passage is when the given page doesn't have it, and rejects pages outside the PDF", async () => {
    const d = doc(page(["Title"]), page(["the White Rabbit ran"]));
    await expect(locateHighlight(d, { text: "White Rabbit", page: 1 })).rejects.toThrow(/not on page 1; it occurs on page\(s\) 2/);
    await expect(locateHighlight(d, { text: "White Rabbit", page: 3 })).rejects.toThrow(/outside this PDF/);
  });

  it("finds a passage that continues on the next page (nextPageRects)", async () => {
    const d = doc(
      page(["Alice felt that she was dozing off, when¶"]),
      page(["suddenly, thump! thump! down she came"]),
    );
    const r = await locateHighlight(d, { text: "dozing off, when suddenly, thump!" });
    expect(r.position).toEqual({ pageIndex: 0, rects: [run(0, 24, 39)], nextPageRects: [run(0, 0, 15)] });
    expect(r.text).toBe("dozing off, when suddenly, thump!");
    expect(r.sortIndex.startsWith("00000|")).toBe(true);
    // the page it starts on narrows to it
    expect((await locateHighlight(d, { text: "dozing off, when suddenly, thump!", page: 1 })).position.pageIndex).toBe(0);
  });

  it("leaves ignorable glyphs and glyphs without geometry out of the rects", async () => {
    const p = page(["was something like this:--", "and then"]);
    const dash = p.chars.findIndex((c, i) => c.c === "-" && p.chars[i + 1]?.c === "-") + 1;
    p.chars[dash] = { ...p.chars[dash], ignorable: true, inlineRect: [500, 0, 600, 900], rect: [500, 0, 600, 900] };
    const t = p.chars.findIndex((c) => c.c === "t");
    p.chars[t] = { ...p.chars[t], inlineRect: [0, 0, 0, 0], rect: [0, 0, 0, 0] };
    const r = await locateHighlight(doc(p), { text: "something like this:- and then" });
    expect(r.position.rects).toEqual([run(0, 4, 24), run(1, 0, 7)]);
  });

  it("skips page numbers between the two pages of a passage, and leaves them out of the rects and text", async () => {
    const d = doc(page(["Alice felt that she was dozing off, when", "12¶"]), page(["13¶", "suddenly, thump! thump! down she came"]));
    const r = await locateHighlight(d, { text: "dozing off, when suddenly, thump!" });
    expect(r.position).toEqual({ pageIndex: 0, rects: [run(0, 24, 39)], nextPageRects: [run(1, 0, 15)] });
    expect(r.text).toBe("dozing off, when suddenly, thump!");
  });
});
