// edit_note's version save / restore (src/notes/noteVersions.ts) against a real SQLite change log
// and an in-memory note store standing in for Zotero.
import { beforeEach, describe, expect, it } from "vitest";
import { createChangeLog, type ChangeLog } from "../../src/changes/changeLog";
import type { UndoHandler } from "../../src/changes/types";
import { editNote, editNoteUndoHandler, type NoteLike, type NoteStore, type SavedImage } from "../../src/notes/noteVersions";
import { userTakenKeys, type NoteReader } from "../../src/ownership/userEdits";
import { sqliteDb } from "./sqliteDb";

const L = 1;
const wrap = (body: string) => `<div data-schema-version="9">${body}</div>`;

class FakeNote implements NoteLike {
  saves = 0;
  trashed = false;
  constructor(public key: string, public html: string) {}
  getNote() {
    return this.html;
  }
  setNote(html: string) {
    this.html = html;
  }
  async save() {
    this.saves++;
  }
}

let notes: Map<string, FakeNote>;
let images: Map<string, SavedImage>;
let store: NoteStore;
let log: ChangeLog;

const trashCreated: UndoHandler = {
  kind: "create_note",
  async undo(change) {
    for (const o of change.objects) notes.get(o.itemKey)!.trashed = true;
    return `Trashed ${change.objects.map((o) => o.itemKey).join(", ")}`;
  },
};

beforeEach(async () => {
  notes = new Map();
  images = new Map();
  let imported = 0;
  store = {
    getNote: (libraryID, key) => (libraryID === L && notes.get(key)) || null,
    imageExists: (libraryID, key) => libraryID === L && images.has(key),
    readImage: async (libraryID, key) => (libraryID === L && images.get(key)) || null,
    async importImage(note, saved) {
      const key = `NEWIMG0${++imported}`;
      images.set(key, { ...saved, attachmentKey: key });
      return key;
    },
  };
  let n = 0;
  log = createChangeLog({ db: sqliteDb(), newId: () => `chg_${++n}`, undoHandlers: [trashCreated, editNoteUndoHandler(store)] });
  await log.ensureSchema();
});

async function create(key: string, html: string) {
  notes.set(key, new FakeNote(key, html));
  return log.recordWrite({ tool: "create_note", args: {} }, async (w) => {
    w.ownObject({ libraryID: L, itemKey: key, kind: "note" });
  });
}

async function edit(key: string, html: string) {
  const note = notes.get(key)!;
  return log.recordWrite({ tool: "edit_note", args: { noteKey: key } }, (w) => editNote(w, L, note, html, store));
}

describe("edit and undo", () => {
  it("saves the previous HTML under the edit's changeId and writes the new HTML", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v2</p>"));
    expect(notes.get("NOTEAAAA")!.saves).toBe(1);
    const change = await log.get(changeId);
    expect(change!.noteVersions).toEqual([{ libraryID: L, noteKey: "NOTEAAAA", html: wrap("<p>v1</p>") }]);
  });

  it("undo of the edit restores the previous version", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    const r = await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
    expect(r.summary).toBe(`Restored note NOTEAAAA to its version before ${changeId}`);
  });

  it("default undo walks back edit then create: the note returns to v1, then goes to the trash", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    await edit("NOTEAAAA", wrap("<p>v2</p>"));
    await edit("NOTEAAAA", wrap("<p>v3</p>"));
    await log.undo();
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v2</p>"));
    await log.undo();
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
    expect(notes.get("NOTEAAAA")!.trashed).toBe(false);
    await log.undo();
    expect(notes.get("NOTEAAAA")!.trashed).toBe(true);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
  });

  it("refuses to undo an edit while a later edit of the same note is not undone", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    await create("NOTEBBBB", wrap("<p>b1</p>"));
    const first = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    const second = await edit("NOTEAAAA", wrap("<p>v3</p>"));
    await edit("NOTEBBBB", wrap("<p>b2</p>")); // other notes don't matter
    await expect(log.undo(first.changeId)).rejects.toThrow(`undo ${second.changeId} first`);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v3</p>"));
    expect((await log.get(first.changeId))!.undone).toBe(false);
    await log.undo(second.changeId);
    await log.undo(first.changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
  });

  it("refuses to undo when the note was changed in Zotero after the edit, so the user's changes are kept", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    notes.get("NOTEAAAA")!.html = wrap("<p>v2 and the user's sentence</p>");
    await expect(log.undo(changeId)).rejects.toThrow("changed in Zotero after");
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v2 and the user's sentence</p>"));
  });

  it("still undoes when the HTML only gained whitespace between blocks", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<ul><li><p>one</p></li></ul>"));
    notes.get("NOTEAAAA")!.html = '<div data-schema-version="9">\n<ul>\n<li>\n<p>one</p>\n</li>\n</ul>\n</div>';
    await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
  });

  it("refuses when the note's formatting alone was changed in Zotero (underline)", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    notes.get("NOTEAAAA")!.html = wrap("<p><u>v2</u></p>");
    await expect(log.undo(changeId)).rejects.toThrow("changed in Zotero after");
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p><u>v2</u></p>"));
  });

  it("keeps the HTML it replaces with the change", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    await log.undo(changeId);
    expect((await log.get(changeId))!.noteVersions.map((v) => v.html)).toEqual([wrap("<p>v1</p>"), wrap("<p>v2</p>")]);
  });

  it("a note erased since the edit leaves nothing to restore; the undo says so", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    notes.delete("NOTEAAAA");
    const r = await log.undo(changeId);
    expect(r.summary).toBe("Note NOTEAAAA no longer exists; nothing restored");
  });
});

describe("what the agent last wrote (user take-over, ticket 14)", () => {
  const reader: NoteReader = {
    noteHtml: (_l, key) => notes.get(key)?.html ?? null,
    parentKey: () => null,
  };
  const taken = (key: string) => userTakenKeys(log, reader, L, [key]).then((s) => s.has(key));

  it("an edit records the HTML it wrote: the user's later change is noticed, the unchanged note is not", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    await edit("NOTEAAAA", wrap("<p>v2</p>"));
    expect(await taken("NOTEAAAA")).toBe(false);
    notes.get("NOTEAAAA")!.html = wrap("<p>v2 plus the user's words</p>");
    expect(await taken("NOTEAAAA")).toBe(true);
  });

  it("undo of an edit records the restored HTML as the agent's", async () => {
    await create("NOTEAAAA", wrap("<p>v1</p>"));
    const { changeId } = await edit("NOTEAAAA", wrap("<p>v2</p>"));
    await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap("<p>v1</p>"));
    expect(await taken("NOTEAAAA")).toBe(false);
  });
});

describe("embedded images", () => {
  const img = (key: string) => `<p><img alt="cap" width="10" height="20" data-attachment-key="${key}"></p>`;
  const png = (key: string): SavedImage => ({ attachmentKey: key, contentType: "image/png", base64: "iVBORw0KGgo=" });

  it("an edit that drops an image keeps its bytes; undo after Zotero erased it re-imports it under a new key", async () => {
    images.set("IMGAAAAA", png("IMGAAAAA"));
    images.set("IMGBBBBB", png("IMGBBBBB"));
    await create("NOTEAAAA", wrap(`<p>v1</p>${img("IMGAAAAA")}${img("IMGBBBBB")}`));
    const { changeId } = await edit("NOTEAAAA", wrap(`<p>v2</p>${img("IMGBBBBB")}`));
    images.delete("IMGAAAAA"); // Zotero.Notes.deleteUnusedEmbeddedImages when the user closes the note
    const r = await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap(`<p>v1</p>${img("NEWIMG01")}${img("IMGBBBBB")}`));
    expect(images.get("NEWIMG01")).toEqual(png("NEWIMG01"));
    expect(r.summary).toBe(`Restored note NOTEAAAA to its version before ${changeId}; re-imported image IMGAAAAA as NEWIMG01`);
  });

  it("an image dropped by the edit but not yet erased is restored as it is", async () => {
    images.set("IMGAAAAA", png("IMGAAAAA"));
    await create("NOTEAAAA", wrap(`<p>v1</p>${img("IMGAAAAA")}`));
    const { changeId } = await edit("NOTEAAAA", wrap(`<p>v2</p>`));
    await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap(`<p>v1</p>${img("IMGAAAAA")}`));
    expect([...images.keys()]).toEqual(["IMGAAAAA"]);
  });

  it("an image that was already gone at the time of the edit is reported as missing", async () => {
    await create("NOTEAAAA", wrap(`<p>v1</p>${img("IMGGONE1")}`));
    const { changeId } = await edit("NOTEAAAA", wrap(`<p>v2</p>`));
    const r = await log.undo(changeId);
    expect(notes.get("NOTEAAAA")!.html).toBe(wrap(`<p>v1</p>${img("IMGGONE1")}`));
    expect(r.summary).toBe(`Restored note NOTEAAAA to its version before ${changeId}; image IMGGONE1 no longer exists`);
  });
});
