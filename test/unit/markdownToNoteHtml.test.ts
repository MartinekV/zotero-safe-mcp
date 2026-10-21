import { describe, expect, it } from "vitest";
import { markdownToNoteHtml, type CitedItem, type NoteLookups } from "../../src/notes/markdownToNoteHtml";
import { ToolError } from "../../src/registry/types";

const noLookups: NoteLookups = {
  resolveCitation: () => null,
  resolveImage: () => null,
};

/** Converts and strips the schema wrapper, for tests that only care about the body. */
async function body(md: string, lookups: NoteLookups = noLookups) {
  const html = await markdownToNoteHtml(md, lookups);
  const m = /^<div data-schema-version="9">([\s\S]*)<\/div>$/.exec(html);
  if (!m) throw new Error(`unexpected wrapper: ${html}`);
  return m[1];
}

describe("markdownToNoteHtml", () => {
  it("wraps headings and paragraphs in a schema-version 9 div", async () => {
    expect(await markdownToNoteHtml("# Title\n\nSome text.", noLookups)).toBe(
      '<div data-schema-version="9"><h1>Title</h1>\n<p>Some text.</p></div>',
    );
  });

  it("renders bold, italics, strikethrough and inline code as the editor's marks", async () => {
    expect(await body("**b** *i* _j_ ~~s~~ `a < b`")).toBe(
      '<p><strong>b</strong> <em>i</em> <em>j</em> <span style="text-decoration: line-through">s</span> <code>a &lt; b</code></p>',
    );
  });

  it("keeps http, https, mailto and zotero links", async () => {
    expect(
      await body("[a](https://x.org/?q=1&r=2) [b](http://x.org) [c](mailto:me@x.org) [d](zotero://select/library/items/ABCD1234)"),
    ).toBe(
      '<p><a href="https://x.org/?q=1&amp;r=2">a</a> <a href="http://x.org">b</a> <a href="mailto:me@x.org">c</a> <a href="zotero://select/library/items/ABCD1234">d</a></p>',
    );
  });

  it("neutralises links with any other scheme, keeping the Markdown as text", async () => {
    expect(await body("[x](javascript:alert(1)) [y](JaVaScRiPt:alert(1)) [z](data:text/html,hi) [w](/relative)")).toBe(
      "<p>[x](javascript:alert(1)) [y](JaVaScRiPt:alert(1)) [z](data:text/html,hi) [w](/relative)</p>",
    );
  });

  it("neutralises javascript: links hidden with whitespace or control characters", async () => {
    expect(await body("[x](<java\tscript:alert(1)>) [y](< javascript:alert(1)>)")).not.toMatch(/href/);
    expect(await body("[x](java&#x09;script:alert(1))")).not.toMatch(/href/);
  });

  it("escapes raw block HTML instead of passing it through", async () => {
    expect(await body('<script>alert("x")</script>\n\n<div onclick="evil()">hi</div>')).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>\n<p>&lt;div onclick=&quot;evil()&quot;&gt;hi&lt;/div&gt;</p>",
    );
  });

  it("escapes raw inline HTML instead of passing it through", async () => {
    expect(await body('a <img src=x onerror="evil()"> b <b>c</b>')).toBe(
      "<p>a &lt;img src=x onerror=&quot;evil()&quot;&gt; b &lt;b&gt;c&lt;/b&gt;</p>",
    );
  });

  it("turns autolinks into links, subject to the same scheme rule", async () => {
    expect(await body("<https://x.org> and www.y.org and <javascript:alert(1)>")).toBe(
      '<p><a href="https://x.org">https://x.org</a> and <a href="http://www.y.org">www.y.org</a> and &lt;javascript:alert(1)&gt;</p>',
    );
  });

  it("renders nested bullet and numbered lists, keeping the start number", async () => {
    expect(await body("- one\n- two\n  - nested\n\n3. three\n4. four")).toBe(
      "<ul><li><p>one</p></li><li><p>two</p><ul><li><p>nested</p></li></ul></li></ul>\n" +
        '<ol start="3"><li><p>three</p></li><li><p>four</p></li></ol>',
    );
  });

  it("keeps task-list checkboxes as text", async () => {
    expect(await body("- [ ] todo\n- [x] done")).toBe("<ul><li><p>[ ] todo</p></li><li><p>[x] done</p></li></ul>");
  });

  it("renders blockquotes around block content", async () => {
    expect(await body("> quoted *text*\n>\n> second")).toBe(
      "<blockquote><p>quoted <em>text</em></p>\n<p>second</p></blockquote>",
    );
  });

  it("renders fenced and indented code as a plain pre, dropping the language", async () => {
    expect(await body("```python\ndef f(x):\n    return x < 1\n```\n\n    indented")).toBe(
      "<pre>def f(x):\n    return x &lt; 1</pre>\n<pre>indented</pre>",
    );
  });

  it("renders horizontal rules and hard line breaks", async () => {
    expect(await body("a  \nb\\\nc\n\n---")).toBe("<p>a<br>b<br>c</p>\n<hr>");
  });

  it("keeps line breaks of a code block inside a list item", async () => {
    expect(await body("- item\n\n  ```\n  a\n  b\n  ```")).toBe("<ul><li><p>item</p><pre>a\nb</pre></li></ul>");
  });

  it("renders GFM tables with th cells in the first row and no thead", async () => {
    expect(await body("| A | *B* |\n|:--|--:|\n| 1 | `2` |\n| 3 |  |")).toBe(
      "<table><tbody>" +
        "<tr><th><p>A</p></th><th><p><em>B</em></p></th></tr>" +
        "<tr><td><p>1</p></td><td><p><code>2</code></p></td></tr>" +
        "<tr><td><p>3</p></td><td><p></p></td></tr>" +
        "</tbody></table>",
    );
  });

  it("renders $...$ as inline math, leaving its LaTeX untouched by Markdown", async () => {
    expect(await body("Energy $E=mc^2$ and $a_1 * b_1 < c$.")).toBe(
      '<p>Energy <span class="math">$E=mc^2$</span> and <span class="math">$a_1 * b_1 &lt; c$</span>.</p>',
    );
  });

  it("renders $$...$$ blocks as display math", async () => {
    expect(await body("$$\\int_0^1 x\\,dx$$\n\n$$\na_1 < b_2\n$$")).toBe(
      '<pre class="math">$$\\int_0^1 x\\,dx$$</pre>\n<pre class="math">$$a_1 &lt; b_2$$</pre>',
    );
  });

  it("does not treat currency amounts or escaped dollars as math", async () => {
    expect(await body("costs $5 and $10, or \\$x\\$")).toBe("<p>costs $5 and $10, or $x$</p>");
  });

  it("renders $$...$$ inside a paragraph as inline math", async () => {
    expect(await body("so $$x^2$$ holds")).toBe('<p>so <span class="math">$x^2$</span> holds</p>');
  });

  it("keeps math in headings as text, since the editor allows inline math only in paragraphs", async () => {
    expect(await body("## About $x_1$")).toBe("<h2>About $x_1$</h2>");
  });

  it("reads character references once, like CommonMark, so nothing is double-escaped or unescaped", async () => {
    expect(await body("AT&T &amp; &lt;b&gt; &copy;")).toBe("<p>AT&amp;T &amp; &lt;b&gt; \u00a9</p>");
  });

  it("keeps unsupported Markdown such as footnotes and definition lists as text", async () => {
    expect(await body("text[^1]\n\n[^1]: the note\n\nTerm\n: definition")).toBe(
      "<p>text[^1]</p>\n<p>[^1]: the note</p>\n<p>Term\n: definition</p>",
    );
  });

  describe("citations", () => {
    const items: Record<string, CitedItem> = {
      AAAA2222: { uri: "http://zotero.org/users/local/abc/items/AAAA2222", itemData: { title: "Alice" }, label: "Carroll, 1865" },
      BBBB3333: { uri: "http://zotero.org/users/local/abc/items/BBBB3333", itemData: { title: "B & B" }, label: "<Smith> & Co, 2020" },
    };
    const calls: string[] = [];
    const lookups: NoteLookups = {
      resolveCitation: async (key) => {
        calls.push(key);
        return items[key] ?? null;
      },
      resolveImage: () => null,
    };
    const decode = (attr: string) => JSON.parse(decodeURIComponent(attr));
    const parse = (html: string) => {
      const wrapper = /^<div data-citation-items="([^"]*)" data-schema-version="9">/.exec(html);
      const spans = [...html.matchAll(/<span class="citation" data-citation="([^"]*)">(\(.*?\))<\/span>/g)];
      return {
        wrapperItems: wrapper ? decode(wrapper[1]) : null,
        citations: spans.map((m) => decode(m[1])),
        texts: spans.map((m) => m[2]),
      };
    };

    it("turns [@KEY] into a citation span and lists the item's data on the wrapper", async () => {
      const html = await markdownToNoteHtml("See [@AAAA2222].", lookups);
      const { wrapperItems, citations, texts } = parse(html);
      expect(citations).toEqual([{ citationItems: [{ uris: ["http://zotero.org/users/local/abc/items/AAAA2222"] }], properties: {} }]);
      expect(wrapperItems).toEqual([{ uris: ["http://zotero.org/users/local/abc/items/AAAA2222"], itemData: { title: "Alice" } }]);
      expect(texts).toEqual(['(<span class="citation-item">Carroll, 1865</span>)']);
      expect(html).toMatch(/<p>See <span class="citation" [^>]*>\(<span class="citation-item">Carroll, 1865<\/span>\)<\/span>\.<\/p><\/div>$/);
    });

    it("cites several items in one [@A; @B] and lists each cited item once on the wrapper", async () => {
      calls.length = 0;
      const html = await markdownToNoteHtml("[@AAAA2222; @BBBB3333] and again [@AAAA2222]", lookups);
      const { wrapperItems, citations, texts } = parse(html);
      expect(citations[0].citationItems.map((c: any) => c.uris[0])).toEqual([items.AAAA2222.uri, items.BBBB3333.uri]);
      expect(citations).toHaveLength(2);
      expect(wrapperItems.map((w: any) => w.uris[0])).toEqual([items.AAAA2222.uri, items.BBBB3333.uri]);
      expect(texts[0]).toBe(
        '(<span class="citation-item">Carroll, 1865</span>; <span class="citation-item">&lt;Smith&gt; &amp; Co, 2020</span>)',
      );
      expect(calls.sort()).toEqual(["AAAA2222", "BBBB3333"]);
    });

    it("fails with a ToolError naming an unknown item key", async () => {
      const err = await markdownToNoteHtml("x [@ZZZZ9999]", lookups).catch((e) => e);
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toMatch(/ZZZZ9999/);
    });

    it("fails with a ToolError for citation syntax it cannot resolve", async () => {
      for (const md of ["[@notakey]", "[@AAAA2222, p. 12]", "[@AAAA2222; BBBB3333]"]) {
        const err = await markdownToNoteHtml(md, lookups).catch((e) => e);
        expect(err, md).toBeInstanceOf(ToolError);
      }
    });

    it("leaves [@KEY] inside code alone", async () => {
      expect(await body("`[@ZZZZ9999]`", lookups)).toBe("<p><code>[@ZZZZ9999]</code></p>");
    });
  });

  describe("images", () => {
    const images: NoteLookups = {
      resolveCitation: () => null,
      resolveImage: async (id) =>
        id === "img1" ? { attachmentKey: "IMG11111", width: 640, height: 480 } : id === "img2" ? { attachmentKey: "IMG22222" } : null,
    };

    it("turns ![caption](image:id) into an embedded image with the caption as alt text", async () => {
      expect(await body('![Fig. 1 "a" <b>](image:img1)\n\nText ![](image:img2) inline', images)).toBe(
        '<p><img alt="Fig. 1 &quot;a&quot; &lt;b&gt;" data-attachment-key="IMG11111" width="640" height="480"></p>\n' +
          '<p>Text <img alt="" data-attachment-key="IMG22222"> inline</p>',
      );
    });

    it("fails with a ToolError for an unknown image id", async () => {
      const err = await markdownToNoteHtml("![x](image:nope)", images).catch((e) => e);
      expect(err).toBeInstanceOf(ToolError);
      expect(err.message).toMatch(/nope/);
    });

    it("keeps images from any other source as text", async () => {
      expect(await body("![x](https://evil.example/t.png) ![y](javascript:alert(1)) ![z](data:image/png;base64,AAAA)", images)).toBe(
        "<p>![x](https://evil.example/t.png) ![y](javascript:alert(1)) ![z](data:image/png;base64,AAAA)</p>",
      );
    });

    it("keeps images in headings as text, since the editor has no images there", async () => {
      expect(await body("# ![x](image:img1)", images)).toBe("<h1>![x](image:img1)</h1>");
    });
  });
});
