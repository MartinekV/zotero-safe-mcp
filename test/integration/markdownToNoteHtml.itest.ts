// The converter's HTML must survive Zotero 10's real note editor: store it, open the note in the
// editor, read back the editor's normalized HTML and check nothing was lost (SPEC open question:
// exact HTML for math, citations and embedded images).
import { beforeAll, describe, expect, it } from "vitest";
import { markdownToNoteHtml, type CitedItem } from "../../src/notes/markdownToNoteHtml";
import { noteHtmlToMarkdown } from "../../src/notes/noteHtmlToMarkdown";
import { zeval } from "./harness";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let parentKey: string;
let noteKey: string;
let imageKey: string;
let cited: CitedItem;

/** Stores `html` in the note, opens it in the note editor and returns what the editor makes of it. */
async function throughEditor(html: string): Promise<{ stored: string; editor: string; imageExists: boolean }> {
  return zeval(`
    const note = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(noteKey)});
    note.setNote(${JSON.stringify(html)});
    await note.saveTx();
    const win = Zotero.getMainWindow();
    const ei = await Zotero.Notes.open(note.id, null, {});
    await ei._initPromise;
    await Zotero.Promise.delay(1500);
    const editor = ei._iframeWindow.wrappedJSObject.getDataSync(false).html;
    for (const t of win.Zotero_Tabs._tabs.filter((t) => t.type == "note")) win.Zotero_Tabs.close(t.id);
    await Zotero.Promise.delay(1000); // closing runs deleteUnusedEmbeddedImages
    const image = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(imageKey)});
    return { stored: note.getNote(), editor, imageExists: !!image && !image.deleted };
  `);
}

beforeAll(async () => {
  // A cited paper, and a child note with one embedded image (the way ticket 10 will store uploads).
  const r = await zeval(`
    const p = new Zotero.Item("journalArticle");
    p.setField("title", "Alice & the <Looking> Glass");
    p.setField("date", "1871");
    p.setCreators([{ firstName: "Lewis", lastName: "Carroll", creatorType: "author" }]);
    await p.saveTx();
    const note = new Zotero.Item("note");
    note.parentID = p.id;
    note.setNote("<p>placeholder</p>");
    await note.saveTx();
    const win = Zotero.getMainWindow();
    const bytes = Uint8Array.from(win.atob(${JSON.stringify(PNG_1x1)}), (c) => c.charCodeAt(0));
    const att = await Zotero.Attachments.importEmbeddedImage({ blob: new win.Blob([bytes], { type: "image/png" }), parentItemID: note.id });
    const uri = Zotero.URI.getItemURI(p);
    const itemData = Zotero.Utilities.Item.itemToCSLJSON(p);
    const label = Zotero.EditorInstanceUtilities._formatCitationItemPreview({ uris: [uri], itemData });
    return { parentKey: p.key, noteKey: note.key, imageKey: att.key, cited: { uri, itemData, label } };
  `);
  ({ parentKey, noteKey, imageKey, cited } = r);
});

describe("note HTML in Zotero 10's note editor", () => {
  it("keeps math, tables, citations, images and the other constructs", async () => {
    const md = [
      `# Reading notes on [@${parentKey}]`,
      `Para with **bold**, *it*, ~~struck~~, \`code\`, [link](https://example.org/?a=1&b=2), inline $E=mc^2$ and a cite [@${parentKey}].`,
      "$$\n\\int_0^1 x\\,dx\n$$",
      "```python\ndef f(x):\n    return x  # two  spaces\n```",
      "> quoted\n>\n> second",
      "- one\n- two\n  - nested\n\n3. three\n4. four",
      "| A | $x$ |\n| --- | --- |\n| 1 | **2** |",
      `![Figure 1](image:${imageKey})`,
      "Line\\\nbreak and <b>raw html</b> and [bad](javascript:alert(1))",
      "---",
    ].join("\n\n");
    const html = await markdownToNoteHtml(md, {
      resolveCitation: (key) => (key === parentKey ? cited : null),
      resolveImage: (id) => (id === imageKey ? { attachmentKey: imageKey, width: 1, height: 1 } : null),
    });

    const { stored, editor, imageExists } = await throughEditor(html);
    // Stored raw: the editor doesn't save on open. (It does save, rewriting the note in its own
    // formatting, when an <img> lacks width/height: it measures the image and stores the size.)
    expect(stored).toBe(html);
    expect(imageExists).toBe(true); // referenced, so Zotero's unused-image cleanup kept it

    // Nothing lost: the editor's normalized HTML reads back as the same Markdown.
    expect(noteHtmlToMarkdown(editor)).toBe(noteHtmlToMarkdown(html));

    // And the constructs are the editor's own nodes, not text.
    expect(editor).toContain('<span class="math">$E=mc^2$</span>');
    expect(editor).toContain('<pre class="math">$$\\int_0^1 x\\,dx$$</pre>');
    expect(editor).toMatch(/<th>\s*<p>A<\/p>\s*<\/th>/);
    expect(editor).toMatch(/<th>\s*<p><span class="math">\$x\$<\/span><\/p>\s*<\/th>/);
    expect(editor).toMatch(new RegExp(`<img [^>]*data-attachment-key="${imageKey}"`));
    expect(editor).toMatch(/<h1>Reading notes on <span class="citation" data-citation="[^"]+">\(<span class="citation-item">Carroll, 1871<\/span>\)<\/span><\/h1>/);
    expect(editor).toMatch(/data-citation-items="[^"]+"/);
    expect(editor).toContain("&lt;b&gt;raw html&lt;/b&gt;");
    expect(editor).not.toMatch(/href="javascript/);
  });

  it("is read by Zotero as a note with a title and citations it can resolve", async () => {
    const html = await markdownToNoteHtml(`# Title\n\nSee [@${parentKey}].`, {
      resolveCitation: (key) => (key === parentKey ? cited : null),
      resolveImage: () => null,
    });
    const r = await zeval(`
      const note = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(noteKey)});
      note.setNote(${JSON.stringify(html)});
      await note.saveTx();
      const doc = new DOMParser().parseFromString(note.getNote(), "text/html");
      const citation = JSON.parse(decodeURIComponent(doc.querySelector(".citation").getAttribute("data-citation")));
      const items = await Zotero.EditorInstance.getItemFromURIs(citation.citationItems[0].uris);
      return { title: note.getNoteTitle(), hasSchema: Zotero.Notes.hasSchemaVersion(note.getNote()), cited: items && items.key };
    `);
    expect(r).toEqual({ title: "Title", hasSchema: true, cited: parentKey });
  });
});
