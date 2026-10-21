import { describe, expect, it } from "vitest";
import { noteHtmlToMarkdown } from "../../src/notes/noteHtmlToMarkdown";

const wrap = (body: string) => `<div data-schema-version="9">${body}</div>`;

describe("noteHtmlToMarkdown", () => {
  it("converts headings, paragraphs and marks", () => {
    expect(
      noteHtmlToMarkdown(
        wrap(
          '<h1>Title</h1>\n<h3>Sub</h3>\n<p>a <strong>b</strong> <em>c</em> <code>d</code> <span style="text-decoration: line-through">e</span> <a href="https://x.org/?a=1&amp;b=2" rel="noopener noreferrer nofollow">f</a></p>',
        ),
      ),
    ).toBe("# Title\n\n### Sub\n\na **b** *c* `d` ~~e~~ [f](https://x.org/?a=1&b=2)");
  });

  it("turns inline and display math back into $...$ and $$...$$", () => {
    expect(noteHtmlToMarkdown(wrap('<p>so <span class="math">$a_1 &lt; b$</span>.</p>\n<pre class="math">$$\\int x\\,dx$$</pre>'))).toBe(
      "so $a_1 < b$.\n\n$$\\int x\\,dx$$",
    );
  });

  it("turns citations back into [@KEY] / [@KEY1; @KEY2]", () => {
    const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
    const one = enc({ citationItems: [{ uris: ["http://zotero.org/users/local/abc/items/AAAA2222"] }], properties: {} });
    const two = enc({
      citationItems: [{ uris: ["http://zotero.org/users/1/items/AAAA2222"] }, { uris: ["http://zotero.org/groups/5/items/BBBB3333"] }],
      properties: {},
    });
    expect(
      noteHtmlToMarkdown(
        wrap(
          `<p>See <span class="citation" data-citation="${one}">(<span class="citation-item">Carroll, 1865</span>)</span> and ` +
            `<span class="citation" data-citation="${two}">(<span class="citation-item">A</span>; <span class="citation-item">B</span>)</span></p>`,
        ),
      ),
    ).toBe("See [@AAAA2222] and [@AAAA2222; @BBBB3333]");
  });

  it("falls back to a citation's visible text when its data can't be read", () => {
    expect(noteHtmlToMarkdown(wrap('<p><span class="citation" data-citation="%7Bbroken">(<span class="citation-item">Doe, 2001</span>)</span></p>'))).toBe(
      "(Doe, 2001)",
    );
  });

  it("turns embedded images into ![alt](image:<attachmentKey>)", () => {
    expect(noteHtmlToMarkdown(wrap('<p><img alt="Fig 1" width="10" height="10" data-attachment-key="3B5CW4NH"></p>'))).toBe(
      "![Fig 1](image:3B5CW4NH)",
    );
  });

  it("converts nested lists, numbered lists with a start, and the editor's unwrapped list items", () => {
    expect(
      noteHtmlToMarkdown(
        wrap('<ul>\n<li>one</li>\n<li><p>two</p><ul><li>nested</li></ul></li>\n</ul>\n<ol start="3"><li><p>three</p></li><li>four</li></ol>'),
      ),
    ).toBe("- one\n- two\n  - nested\n\n3. three\n4. four");
  });

  it("converts blockquotes and code blocks, choosing a fence longer than any backtick run", () => {
    expect(noteHtmlToMarkdown(wrap("<blockquote>\n<p>q1</p>\n<p>q2</p>\n</blockquote>\n<pre>a ```\n &nbsp;b &lt; c</pre>"))).toBe(
      "> q1\n>\n> q2\n\n````\na ```\n  b < c\n````",
    );
  });

  it("converts tables to GFM with the first row as header, escaping pipes", () => {
    expect(
      noteHtmlToMarkdown(
        wrap("<table>\n<tbody>\n<tr>\n<th>\n<p>A</p>\n</th>\n<th><p>B|C</p></th>\n</tr>\n<tr><td><p>1</p></td><td><p><em>2</em></p></td></tr>\n</tbody>\n</table>"),
      ),
    ).toBe("| A | B\\|C |\n| --- | --- |\n| 1 | *2* |");
  });

  it("converts hard breaks and rules", () => {
    expect(noteHtmlToMarkdown(wrap("<p>a<br>b</p><hr>"))).toBe("a\\\nb\n\n---");
  });

  it("gives the text of unknown elements and of old notes without the schema wrapper", () => {
    expect(noteHtmlToMarkdown('<p>a <mark>marked</mark> <font color="red">red</font></p><details><summary>sum</summary>det</details>')).toBe(
      "a marked red\n\nsum\n\ndet",
    );
  });

  it("drops links with disallowed schemes but keeps their text", () => {
    expect(noteHtmlToMarkdown(wrap('<p><a href="javascript:alert(1)">click</a></p>'))).toBe("click");
  });

  it("escapes text that would otherwise read as Markdown", () => {
    expect(noteHtmlToMarkdown(wrap("<p>*not em* [@AAAA2222] costs $5 a_b _c_ &lt;b&gt; &amp;amp;</p><p># not heading</p><p>1. not list</p>"))).toBe(
      "\\*not em\\* \\[@AAAA2222\\] costs \\$5 a_b \\_c\\_ \\<b> \\&amp;\n\n\\# not heading\n\n1\\. not list",
    );
  });
});
