// Comparing note HTML for user edits (src/ownership/userEdits.ts): markup that changes nothing a reader
// sees is ignored; every change of content or formatting counts.
import { describe, expect, it } from "vitest";
import { sameNoteHtml } from "../../src/notes/canonicalNoteHtml";

const NOTE = '<div data-schema-version="9"><h1>Title</h1><p>Some <strong>bold</strong> text &amp; more</p><ul><li><p>one</p></li></ul></div>';

describe("sameNoteHtml", () => {
  it("ignores whitespace between blocks, attribute order and entity spelling", () => {
    expect(sameNoteHtml(NOTE, NOTE.replace(/<(p|h1|ul|li)>/g, "\n<$1>"))).toBe(true);
    expect(sameNoteHtml('<p><a href="x" rel="r">a</a></p>', '<p><a rel="r" href="x">a</a></p>')).toBe(true);
    expect(sameNoteHtml("<p>a &amp; b &#39;c&#39;</p>", "<p>a &#38; b 'c'</p>")).toBe(true);
  });

  it("sees formatting-only edits the Markdown comparison can't", () => {
    expect(sameNoteHtml(NOTE, NOTE.replace("Some", "<u>Some</u>"))).toBe(false);
    expect(sameNoteHtml(NOTE, NOTE.replace("Some", '<span style="color: #ff2020">Some</span>'))).toBe(false);
    expect(sameNoteHtml(NOTE, NOTE.replace("text", "<sup>text</sup>"))).toBe(false);
    expect(sameNoteHtml('<p><img data-attachment-key="ABCD1234" width="10" height="10"></p>', '<p><img data-attachment-key="ABCD1234" width="20" height="20"></p>')).toBe(false);
  });

  it("sees content edits, including whitespace inside a paragraph", () => {
    expect(sameNoteHtml(NOTE, NOTE.replace("bold", "brave"))).toBe(false);
    expect(sameNoteHtml("<p>a b</p>", "<p>a  b</p>")).toBe(false);
    expect(sameNoteHtml("<pre>x\n</pre>", "<pre>x</pre>")).toBe(false);
  });
});
