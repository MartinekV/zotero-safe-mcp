// Item serialization (src/zotero/serialize.ts) against fake Zotero items.
import { describe, it, expect } from "vitest";
import { summarizeItem, describeItem, ItemLike, Library } from "../../src/zotero/serialize";

type Fake = Partial<ItemLike> & { id: number; key: string; itemType: string; fields?: Record<string, string> };

function fakeLibrary(items: Fake[], collections: { id: number; key: string; name: string }[] = []) {
  const built = new Map<number, ItemLike>();
  for (const f of items) {
    const fields = f.fields ?? {};
    built.set(f.id, {
      id: f.id,
      key: f.key,
      itemType: f.itemType,
      deleted: f.deleted ?? false,
      parentKey: f.parentKey ?? false,
      getField: (name: string) => fields[name] ?? "",
      getCreatorsJSON: f.getCreatorsJSON ?? (() => []),
      getAttachments: f.getAttachments ?? (() => []),
      getNotes: f.getNotes ?? (() => []),
      getTags: f.getTags ?? (() => []),
      getCollections: f.getCollections ?? (() => []),
      getNoteTitle: f.getNoteTitle ?? (() => ""),
      getUsedFields: () => Object.keys(fields),
      attachmentContentType: f.attachmentContentType,
    });
  }
  const lib: Library = {
    item: (id) => built.get(id) ?? false,
    collection: (id) => collections.find((c) => c.id === id) ?? false,
  };
  return { lib, get: (id: number) => built.get(id)! };
}

describe("summarizeItem", () => {
  it("gives key, type, title, creators, year, DOI and attachment keys", () => {
    const { lib, get } = fakeLibrary([
      {
        id: 1,
        key: "AAAAAAAA",
        itemType: "journalArticle",
        fields: { title: "Alice in Wonderland", date: "March 3, 1865", year: "1865", DOI: "10.1234/alice" },
        getCreatorsJSON: () => [
          { firstName: "Lewis", lastName: "Carroll", creatorType: "author" },
          { name: "Macmillan Ltd", creatorType: "editor" },
        ],
        getAttachments: () => [2],
      },
      { id: 2, key: "BBBBBBBB", itemType: "attachment", parentKey: "AAAAAAAA" },
    ]);
    expect(summarizeItem(get(1), lib)).toEqual({
      key: "AAAAAAAA",
      type: "journalArticle",
      title: "Alice in Wonderland",
      creators: [
        { name: "Lewis Carroll", type: "author" },
        { name: "Macmillan Ltd", type: "editor" },
      ],
      year: "1865",
      DOI: "10.1234/alice",
      attachmentKeys: ["BBBBBBBB"],
    });
  });

  it("reads a DOI kept in Extra for item types without a DOI field", () => {
    const { lib, get } = fakeLibrary([
      { id: 1, key: "AAAAAAAA", itemType: "book", fields: { title: "B", extra: "tex.key: x\nDOI:  10.5555/Book.1 \nPMID: 1" } },
    ]);
    expect(summarizeItem(get(1), lib).DOI).toBe("10.5555/Book.1");
  });

  it("leaves out trashed attachments and omits empty fields as empty strings", () => {
    const { lib, get } = fakeLibrary([
      { id: 1, key: "AAAAAAAA", itemType: "report", getAttachments: () => [2, 3] },
      { id: 2, key: "BBBBBBBB", itemType: "attachment", deleted: true },
      { id: 3, key: "CCCCCCCC", itemType: "attachment" },
    ]);
    const s = summarizeItem(get(1), lib);
    expect(s.attachmentKeys).toEqual(["CCCCCCCC"]);
    expect([s.title, s.year, s.DOI]).toEqual(["", "", ""]);
  });
});

describe("describeItem", () => {
  it("adds metadata, attachments, child note keys, tags and collections", () => {
    const { lib, get } = fakeLibrary(
      [
        {
          id: 1,
          key: "AAAAAAAA",
          itemType: "journalArticle",
          fields: { title: "Alice", year: "1865", date: "1865", publicationTitle: "J. Wonder", abstractNote: "Down the hole." },
          getAttachments: () => [2],
          getNotes: () => [3, 4],
          getTags: () => [{ tag: "rabbit" }, { tag: "auto", type: 1 }],
          getCollections: () => [10],
        },
        { id: 2, key: "BBBBBBBB", itemType: "attachment", parentKey: "AAAAAAAA", fields: { title: "Full Text PDF" }, attachmentContentType: "application/pdf" },
        { id: 3, key: "CCCCCCCC", itemType: "note", parentKey: "AAAAAAAA", getNoteTitle: () => "My note" },
        { id: 4, key: "DDDDDDDD", itemType: "note", parentKey: "AAAAAAAA", deleted: true },
      ],
      [{ id: 10, key: "COLLAAAA", name: "Reading" }],
    );
    expect(describeItem(get(1), lib)).toEqual({
      key: "AAAAAAAA",
      type: "journalArticle",
      title: "Alice",
      creators: [],
      year: "1865",
      DOI: "",
      parentKey: null,
      inTrash: false,
      fields: { date: "1865", publicationTitle: "J. Wonder", abstractNote: "Down the hole." },
      attachments: [{ key: "BBBBBBBB", title: "Full Text PDF", contentType: "application/pdf" }],
      noteKeys: ["CCCCCCCC"],
      tags: ["rabbit", "auto"],
      collections: [{ key: "COLLAAAA", name: "Reading" }],
    });
  });

  it("describes a child note by its note title and parent", () => {
    const { lib, get } = fakeLibrary([
      { id: 3, key: "CCCCCCCC", itemType: "note", parentKey: "AAAAAAAA", getNoteTitle: () => "My note" },
    ]);
    const d = describeItem(get(3), lib);
    expect([d.title, d.parentKey, d.type]).toEqual(["My note", "AAAAAAAA", "note"]);
  });
});
