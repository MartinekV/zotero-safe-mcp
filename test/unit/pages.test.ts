import { describe, it, expect } from "vitest";
import { parsePages, splitPages } from "../../src/pdf/pages";

describe("parsePages", () => {
  it("parses single pages, ranges and lists into sorted unique 1-based page numbers", () => {
    expect(parsePages("3", 10)).toEqual([3]);
    expect(parsePages("2-4", 10)).toEqual([2, 3, 4]);
    expect(parsePages(" 7, 1-2 ,2, 9-10", 10)).toEqual([1, 2, 7, 9, 10]);
  });

  it("rejects page 0, reversed ranges and garbage", () => {
    expect(() => parsePages("0", 10)).toThrow(/start at 1/);
    expect(() => parsePages("5-3", 10)).toThrow(/5-3/);
    expect(() => parsePages("1;2", 10)).toThrow(/Invalid pages/);
    expect(() => parsePages("", 10)).toThrow(/Invalid pages/);
    expect(() => parsePages("1-", 10)).toThrow(/Invalid pages/);
  });

  it("rejects pages beyond the end of the PDF, naming the page count", () => {
    expect(() => parsePages("9-12", 10)).toThrow(/has 10 pages/);
  });
});

describe("splitPages", () => {
  it("splits Zotero full text on form feeds and trims each page", () => {
    expect(splitPages("Page one\n\n\fPage two\n\n\f  Page three")).toEqual(["Page one", "Page two", "Page three"]);
  });
});
