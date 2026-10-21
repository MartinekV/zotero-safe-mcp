// list_notes gives the agent Markdown that edit_note takes back: reading a note and writing it
// back unchanged must not change the note.
import { describe, expect, it } from "vitest";
import { markdownToNoteHtml, type NoteLookups } from "../../src/notes/markdownToNoteHtml";
import { noteHtmlToMarkdown } from "../../src/notes/noteHtmlToMarkdown";

const lookups: NoteLookups = {
  resolveCitation: (key) => ({ uri: `http://zotero.org/users/local/abc/items/${key}`, itemData: { id: key }, label: `Author ${key}` }),
  // As edit_note will: an image reference may name an existing embedded image of the note.
  resolveImage: (id) => ({ attachmentKey: id }),
};

const md = [
  "# Title with [@AAAA2222]",
  "Text with **bold**, *it*, ~~gone~~, `code`, [a link](https://x.org/a_(b)), $E=mc^2$ and [@AAAA2222; @BBBB3333].",
  "Line one\\\nline two",
  "$$\n\\sum_{i=1}^n x_i\n$$",
  "```\nconst a = `x` * 2; // $5\n```",
  "> quoted\n>\n> - in a list",
  "- one\n- two\n  1. nested\n  2. more\n\n5. five\n6. six",
  "- [ ] task",
  "| A | B |\n| --- | --- |\n| $x$ | `a\\|b` and \\| |",
  "![Figure 1](image:IMG11111)",
  "---",
  "Literal *stars*, [brackets], $5 and $6, a_b, _c_, <tags>, &amp;, # hash, 1. one, + plus, > gt, ~tilde~, \\backslash",
].join("\n\n");

describe("Markdown ↔ note HTML round trip", () => {
  it("reading a note as Markdown and writing it back gives the same HTML", async () => {
    const html = await markdownToNoteHtml(md, lookups);
    const again = await markdownToNoteHtml(noteHtmlToMarkdown(html), lookups);
    expect(again).toBe(html);
  });

  it("keeps pipes in table cells, including inside code", async () => {
    const html = await markdownToNoteHtml("| A |\n| --- |\n| `a\\|b` and \\| |", lookups);
    expect(html).toContain("<td><p><code>a|b</code> and |</p></td>");
    expect(await markdownToNoteHtml(noteHtmlToMarkdown(html), lookups)).toBe(html);
  });

  it("keeps literal text literal through the round trip", async () => {
    const html = await markdownToNoteHtml("\\*stars\\* \\[x\\] \\$5 \\_c\\_ \\<b> \\&amp; \\~t\\~", lookups);
    expect(html).toBe('<div data-schema-version="9"><p>*stars* [x] $5 _c_ &lt;b&gt; &amp;amp; ~t~</p></div>');
    expect(await markdownToNoteHtml(noteHtmlToMarkdown(html), lookups)).toBe(html);
  });
});
