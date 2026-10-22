// search_library, get_item and list_collections against a real Zotero library.
import { beforeAll, describe, it, expect } from "vitest";
import { callTool, zeval } from "./harness";

// A unique word so this file's items don't collide with other files' data in the shared library.
const W = `zq${Date.now().toString(36)}`;
let seed: {
  parent: string;
  sub: string;
  paper: string;
  pdf: string;
  note: string;
  other: string;
  trashed: string;
};

beforeAll(async () => {
  seed = await zeval(`
    const L = Zotero.Libraries.userLibraryID;
    const parent = new Zotero.Collection({ libraryID: L, name: "${W} Parent" }); await parent.saveTx();
    const sub = new Zotero.Collection({ libraryID: L, name: "${W} Child", parentKey: parent.key }); await sub.saveTx();

    const paper = new Zotero.Item("journalArticle");
    paper.setField("title", "${W} Alice in Wonderland");
    paper.setField("date", "1865-11-26");
    paper.setField("DOI", "10.1234/${W}");
    paper.setField("publicationTitle", "Wonder Journal");
    paper.setCreators([{ firstName: "Lewis", lastName: "Carroll", creatorType: "author" }]);
    paper.addTag("${W}-rabbit");
    paper.setCollections([sub.key]);
    await paper.saveTx();

    const pdf = new Zotero.Item("attachment");
    pdf.libraryID = L; pdf.parentKey = paper.key;
    pdf.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
    pdf.attachmentContentType = "application/pdf";
    pdf.setField("title", "Full Text PDF"); pdf.setField("url", "https://example.org/a.pdf");
    await pdf.saveTx();

    const note = new Zotero.Item("note");
    note.libraryID = L; note.parentKey = paper.key; note.setNote("<p>${W} margin thoughts</p>");
    await note.saveTx();

    const other = new Zotero.Item("book");
    other.setField("title", "${W} Through the Looking-Glass");
    other.setCollections([parent.key]);
    await other.saveTx();

    const trashed = new Zotero.Item("book");
    trashed.setField("title", "${W} Trashed Book");
    trashed.deleted = true;
    await trashed.saveTx();

    return { parent: parent.key, sub: sub.key, paper: paper.key, pdf: pdf.key, note: note.key, other: other.key, trashed: trashed.key };
  `);
});

describe("get_item", () => {
  it("returns metadata, attachments, child note keys, tags and collections", async () => {
    const res = await callTool("get_item", { itemKey: seed.paper });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({
      key: seed.paper,
      type: "journalArticle",
      title: `${W} Alice in Wonderland`,
      creators: [{ name: "Lewis Carroll", type: "author" }],
      year: "1865",
      DOI: `10.1234/${W}`,
      parentKey: null,
      inTrash: false,
      fields: { publicationTitle: "Wonder Journal", date: "1865-11-26" },
      attachments: [{ key: seed.pdf, title: "Full Text PDF", contentType: "application/pdf" }],
      noteKeys: [seed.note],
      tags: [`${W}-rabbit`],
      collections: [{ key: seed.sub, name: `${W} Child` }],
    });
  });

  it("fails clearly for an unknown key", async () => {
    const res = await callTool("get_item", { itemKey: "ZZZZZZZZ" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/No item with key ZZZZZZZZ/);
  });
});

describe("list_collections", () => {
  it("returns the collection tree as key, name and parent key", async () => {
    const res = await callTool("list_collections");
    expect(res.isError).toBeFalsy();
    const cols = res.structuredContent.collections as { key: string; name: string; parentKey: string | null }[];
    const ours = cols.filter((c) => c.name.startsWith(W));
    expect(ours).toEqual([
      { key: seed.parent, name: `${W} Parent`, parentKey: null },
      { key: seed.sub, name: `${W} Child`, parentKey: seed.parent },
    ]);
  });
});

describe("search_library", () => {
  const keys = (res: any) => res.structuredContent.items.map((i: any) => i.key).sort();

  it("finds items by title words and returns summaries, never trashed items", async () => {
    const res = await callTool("search_library", { query: `${W} wonderland` });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent.items).toEqual([
      {
        key: seed.paper,
        type: "journalArticle",
        title: `${W} Alice in Wonderland`,
        creators: [{ name: "Lewis Carroll", type: "author" }],
        year: "1865",
        DOI: `10.1234/${W}`,
        attachmentKeys: [seed.pdf],
      },
    ]);
    expect(keys(await callTool("search_library", { query: W }))).toEqual([seed.paper, seed.other].sort());
  });

  it("returns the parent item when a child note matches", async () => {
    expect(keys(await callTool("search_library", { query: "margin thoughts" }))).toEqual([seed.paper]);
  });

  it("filters by collection (subcollections included) and by tag", async () => {
    expect(keys(await callTool("search_library", { query: "", collectionKey: seed.parent }))).toEqual(
      [seed.paper, seed.other].sort(),
    );
    expect(keys(await callTool("search_library", { query: "", collectionKey: seed.sub }))).toEqual([seed.paper]);
    expect(keys(await callTool("search_library", { query: W, tag: `${W}-rabbit` }))).toEqual([seed.paper]);
  });

  it("fails clearly for an unknown collection key or tag", async () => {
    const col = await callTool("search_library", { query: "", collectionKey: "ZZZZZZZZ" });
    expect(col.isError).toBe(true);
    expect(col.content[0].text).toMatch(/No collection with key ZZZZZZZZ/);
    const tag = await callTool("search_library", { query: "", tag: `${W}-no-such-tag` });
    expect(tag.isError).toBe(true);
    expect(tag.content[0].text).toMatch(/No tag/);
  });

  it("caps results at limit and reports the total", async () => {
    const res = await callTool("search_library", { query: W, limit: 1 });
    expect(res.structuredContent.items).toHaveLength(1);
    expect(res.structuredContent).toMatchObject({ total: 2, truncated: true });
    const over = await callTool("search_library", { query: W, limit: 1000 });
    expect(over.isError).toBe(true);
  });
});
