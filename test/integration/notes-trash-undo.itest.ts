// create_note, list_notes, trash, undo, list_changes and the write rate limit, end to end.
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { INTEGRATION_WRITES_PER_MINUTE } from "./global-setup";
import { callTool, setPluginEnabled, zeval } from "./harness";

const PDF = join(__dirname, "fixtures", "wonderland_short.pdf");
const text = (r: any) => r.content[0].text as string;

let paperKey: string;
let userNoteKey: string;
let collectionKey: string;

beforeAll(async () => {
  ({ paperKey, userNoteKey, collectionKey } = await zeval(`
    const p = new Zotero.Item("book"); p.setField("title", "Notes test paper"); p.setField("date", "1865");
    p.setCreators([{ firstName: "Lewis", lastName: "Carroll", creatorType: "author" }]);
    await p.saveTx();
    const n = new Zotero.Item("note"); n.parentID = p.id; n.setNote("<p>The user's own note</p>");
    n.addTag("[LLM]"); // the user (or the agent via add_tags) can put the tag on anything: not ownership
    await n.saveTx();
    const c = new Zotero.Collection(); c.name = "Notes test collection"; await c.saveTx();
    return { paperKey: p.key, userNoteKey: n.key, collectionKey: c.key };
  `));
});

async function item(key: string) {
  return zeval(`
    const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    return i ? { deleted: i.deleted, html: i.isNote() ? i.getNote() : null, tags: i.getTags().map((t) => t.tag),
                 parentKey: i.parentKey || null, collections: i.getCollections().map((id) => Zotero.Collections.get(id).key) } : null;
  `);
}

async function changeCount(): Promise<number> {
  return (await callTool("list_changes", { limit: 200 })).structuredContent.changes.length;
}

describe("create_note + list_notes", () => {
  it("creates an [LLM]-tagged child note with citations, recorded as owned and listed as Markdown", async () => {
    const r = await callTool("create_note", {
      parentItemKey: paperKey,
      markdown: `# Summary\n\nAs argued in [@${paperKey}], **rabbits** are late. $x^2$`,
    });
    expect(r.isError).toBeFalsy();
    const { changeId, noteKey, title } = r.structuredContent;
    expect(changeId).toMatch(/^chg_[A-Z0-9]{8}$/);
    expect(title).toBe("Summary");

    const note = await item(noteKey);
    expect(note).toMatchObject({ deleted: false, parentKey: paperKey, tags: ["[LLM]"] });
    expect(note.html).toContain('<span class="citation"');
    expect(note.html).toContain("Carroll, 1865");

    const notes = (await callTool("list_notes", { itemKey: paperKey })).structuredContent.notes;
    expect(notes).toContainEqual({
      key: noteKey,
      parentKey: paperKey,
      title: "Summary",
      content: `# Summary\n\nAs argued in [@${paperKey}], **rabbits** are late. $x^2$`,
      byLLM: true,
    });
    expect(notes.find((n: any) => n.key === userNoteKey)).toMatchObject({ byLLM: false, content: "The user's own note" });

    const [latest] = (await callTool("list_changes", { limit: 1 })).structuredContent.changes;
    expect(latest).toMatchObject({ changeId, tool: "create_note", undone: false });
    expect(latest.summary).toContain(noteKey);
  });

  it("creates a standalone note in a collection", async () => {
    const r = await callTool("create_note", { collectionKey, markdown: "Standalone" });
    expect(r.isError).toBeFalsy();
    expect(await item(r.structuredContent.noteKey)).toMatchObject({ parentKey: null, collections: [collectionKey] });
    const notes = (await callTool("list_notes", { collectionKey })).structuredContent.notes;
    expect(notes).toEqual([{ key: r.structuredContent.noteKey, parentKey: null, title: "Standalone", content: "Standalone", byLLM: true }]);
  });

  it("an unknown citation key fails the call and creates nothing", async () => {
    const before = await zeval(`return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).length;`);
    const changes = await changeCount();
    const r = await callTool("create_note", { parentItemKey: paperKey, markdown: "See [@ZZZZZZZZ]" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/ZZZZZZZZ/);
    expect(await zeval(`return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).length;`)).toBe(before);
    expect(await changeCount()).toBe(changes);
  });

  it("needs exactly one of parentItemKey / collectionKey, and a regular parent", async () => {
    expect((await callTool("create_note", { markdown: "x" })).isError).toBe(true);
    expect((await callTool("create_note", { markdown: "x", parentItemKey: paperKey, collectionKey })).isError).toBe(true);
    const r = await callTool("create_note", { markdown: "x", parentItemKey: userNoteKey });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/regular items/);
  });
});

describe("trash", () => {
  it("refuses the user's items with a clear error and changes nothing", async () => {
    const own = (await callTool("create_note", { parentItemKey: paperKey, markdown: "mine" })).structuredContent.noteKey;
    const changes = await changeCount();
    const r = await callTool("trash", { itemKeys: [own, userNoteKey, paperKey] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain(userNoteKey);
    expect(text(r)).toContain(paperKey);
    expect(text(r)).toMatch(/not created by this plugin/);
    expect((await item(own)).deleted).toBe(false);
    expect((await item(userNoteKey)).deleted).toBe(false);
    expect((await item(paperKey)).deleted).toBe(false);
    expect(await changeCount()).toBe(changes);
  });

  it("moves owned notes to the trash; undo restores them", async () => {
    const own = (await callTool("create_note", { parentItemKey: paperKey, markdown: "to trash" })).structuredContent.noteKey;
    const r = await callTool("trash", { itemKeys: [own] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ trashed: [own], alreadyInTrash: [] });
    expect((await item(own)).deleted).toBe(true);
    const listed = (await callTool("list_notes", { itemKey: paperKey })).structuredContent.notes;
    expect(listed.map((n: any) => n.key)).not.toContain(own);

    const u = await callTool("undo", { changeId: r.structuredContent.changeId });
    expect(u.isError).toBeFalsy();
    expect(u.structuredContent).toMatchObject({ undoneChangeId: r.structuredContent.changeId, tool: "trash" });
    expect((await item(own)).deleted).toBe(false);
  });
});

describe("undo", () => {
  it("defaults to the last change; undoing create_note trashes the note; a second undo of it is refused", async () => {
    const c = (await callTool("create_note", { parentItemKey: paperKey, markdown: "undo me" })).structuredContent;
    const u = await callTool("undo", {});
    expect(u.isError).toBeFalsy();
    expect(u.structuredContent).toMatchObject({ undoneChangeId: c.changeId, tool: "create_note" });
    expect((await item(c.noteKey)).deleted).toBe(true);
    const changes = (await callTool("list_changes", {})).structuredContent.changes;
    expect(changes.find((x: any) => x.changeId === c.changeId).undone).toBe(true);

    const again = await callTool("undo", { changeId: c.changeId });
    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/already undone/);
    expect((await callTool("undo", { changeId: "chg_NOPE2345" })).isError).toBe(true);
  });
});

describe("ownership registry storage", () => {
  it("lives in safe-mcp.sqlite in the Zotero data directory, attached to Zotero.DB", async () => {
    const r = await zeval(`
      const path = Zotero.DataDirectory.getDatabase("safe-mcp");
      const dbs = (await Zotero.DB.queryAsync("PRAGMA database_list")).map((r) => ({ name: r.name, file: r.file }));
      const owned = await Zotero.DB.valueQueryAsync("SELECT COUNT(*) FROM safemcp.owned_objects");
      return { path, dataDir: Zotero.DataDirectory.dir, exists: await IOUtils.exists(path), dbs, owned };
    `);
    expect(r.exists).toBe(true);
    expect(r.path.startsWith(r.dataDir)).toBe(true);
    expect(r.dbs).toContainEqual({ name: "safemcp", file: r.path });
    expect(r.owned).toBeGreaterThan(0);
  });

  it("is detached on disable and kept across re-enable (changes and ownership survive)", async () => {
    const c = (await callTool("create_note", { parentItemKey: paperKey, markdown: "survives" })).structuredContent;
    const attached = `return (await Zotero.DB.queryAsync("PRAGMA database_list")).some((r) => r.name === "safemcp");`;
    const toggle = setPluginEnabled;
    const callbacks = `return Zotero.DB._onConnectCallbacks.length`;
    const n = await zeval(callbacks);
    await toggle(false);
    try {
      expect(await zeval(attached)).toBe(false);
      expect(await zeval(callbacks)).toBe(n - 1);
    } finally {
      await toggle(true);
    }
    expect(await zeval(attached)).toBe(true);
    expect(await zeval(callbacks)).toBe(n);
    const changes = (await callTool("list_changes", {})).structuredContent.changes;
    expect(changes[0]).toMatchObject({ changeId: c.changeId, undone: false });
    const notes = (await callTool("list_notes", { itemKey: c.noteKey })).structuredContent.notes;
    expect(notes).toMatchObject([{ key: c.noteKey, byLLM: true }]);
  });
});

describe("list_annotations byLLM", () => {
  it("comes from the registry", async () => {
    const { pdfKey, userAnnot, ownAnnot } = await zeval(`
      const p = new Zotero.Item("book"); p.setField("title", "Annot owner test"); await p.saveTx();
      const att = await Zotero.Attachments.importFromFile({ file: ${JSON.stringify(PDF)}, parentItemID: p.id });
      const mk = (comment) => Zotero.Annotations.saveFromJSON(att, {
        key: Zotero.DataObjectUtilities.generateKey(), type: "highlight", text: "Alice", comment, color: "#ffd400",
        pageLabel: "2", sortIndex: "00001|000071|00230", position: { pageIndex: 1, rects: [[42, 552, 447, 561]] },
      });
      const u = await mk("[LLM] not really"); const o = await mk("[LLM] ours");
      // Record o as owned the way add_highlight will (ticket 08), straight into the registry.
      await Zotero.DB.queryAsync("INSERT INTO safemcp.owned_objects VALUES (?,?,?,?,?)", [o.libraryID, o.key, "highlight", "chg_TEST2345", Date.now()]);
      return { pdfKey: att.key, userAnnot: u.key, ownAnnot: o.key };
    `);
    const anns = (await callTool("list_annotations", { attachmentKey: pdfKey })).structuredContent.annotations;
    expect(anns.find((a: any) => a.key === userAnnot).byLLM).toBe(false);
    expect(anns.find((a: any) => a.key === ownAnnot).byLLM).toBe(true);
  });
});

describe("write rate limit", () => {
  it("over the cap a write fails without side effects; reads still work", async () => {
    await callTool("create_note", { parentItemKey: paperKey, markdown: "inside the window" });
    await zeval(`Zotero.Prefs.set("extensions.zotero-safe-mcp.writesPerMinute", 1, true)`);
    try {
      const before = await zeval(`return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).length;`);
      const changes = await changeCount();
      const r = await callTool("create_note", { parentItemKey: paperKey, markdown: "over the cap" });
      expect(r.isError).toBe(true);
      expect(text(r)).toMatch(/rate limit.*1 write/i);
      expect(await zeval(`return (await Zotero.Items.getAll(Zotero.Libraries.userLibraryID)).length;`)).toBe(before);
      expect(await changeCount()).toBe(changes);
      expect((await callTool("undo", {})).isError).toBe(true); // undo is a write too
      expect((await callTool("list_notes", { itemKey: paperKey })).isError).toBeFalsy();
    } finally {
      await zeval(`Zotero.Prefs.set("extensions.zotero-safe-mcp.writesPerMinute", ${INTEGRATION_WRITES_PER_MINUTE}, true)`);
    }
  });
});
