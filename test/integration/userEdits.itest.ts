// Ticket 14, end to end: once the user edits an agent's note in Zotero, it is the user's for good.
import { beforeAll, describe, expect, it } from "vitest";
import { callTool, setPluginEnabled, zeval } from "./harness";

const text = (r: any) => r.content[0].text as string;
const TAKEN = /you edited this note in Zotero; it is now yours/;

let paperKey: string;

beforeAll(async () => {
  paperKey = await zeval(`
    const p = new Zotero.Item("book"); p.setField("title", "User edit ownership test paper"); await p.saveTx();
    return p.key;
  `);
});

async function createNote(markdown: string): Promise<{ key: string; changeId: string }> {
  const r = await callTool("create_note", { parentItemKey: paperKey, markdown });
  expect(r.isError).toBeFalsy();
  return { key: r.structuredContent.noteKey, changeId: r.structuredContent.changeId };
}

/** The user edits the note in Zotero (what the note editor's save does). */
async function userSets(key: string, from: string, to: string) {
  await zeval(`
    const n = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    n.setNote(n.getNote().replace(${JSON.stringify(from)}, ${JSON.stringify(to)})); await n.saveTx();
  `);
}

async function noteState(key: string) {
  return zeval(`
    const n = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    return { html: n.getNote(), deleted: n.deleted, tags: n.getTags().map((t) => t.tag).sort() };
  `);
}

async function byLLM(key: string): Promise<boolean> {
  const notes = (await callTool("list_notes", { itemKey: paperKey })).structuredContent.notes;
  return notes.find((n: any) => n.key === key).byLLM;
}

describe("a note the user edited in Zotero", () => {
  it("is refused by edit_note, trash and undo of its creation and edits, and list_notes reports byLLM false", async () => {
    const created = await createNote("agent version one");
    const edited = await callTool("edit_note", { noteKey: created.key, markdown: "agent version two" });
    expect(edited.isError).toBeFalsy();
    expect(await byLLM(created.key)).toBe(true);

    await userSets(created.key, "agent version two", "agent version two, and the user's thought");
    const before = await noteState(created.key);

    const e = await callTool("edit_note", { noteKey: created.key, markdown: "overwritten" });
    expect(e.isError).toBe(true);
    expect(text(e)).toMatch(TAKEN);
    const t = await callTool("trash", { itemKeys: [created.key] });
    expect(t.isError).toBe(true);
    expect(text(t)).toMatch(TAKEN);
    for (const changeId of [edited.structuredContent.changeId, created.changeId]) {
      const u = await callTool("undo", { changeId });
      expect(u.isError).toBe(true);
      expect(text(u)).toMatch(TAKEN);
    }
    const d = await callTool("undo", {}); // the newest change is the edit
    expect(d.isError).toBe(true);
    expect(text(d)).toMatch(TAKEN);

    expect(await noteState(created.key)).toEqual(before);
    expect(await byLLM(created.key)).toBe(false);
    const changes = (await callTool("list_changes", {})).structuredContent.changes;
    expect(changes.find((c: any) => c.changeId === created.changeId).undone).toBe(false);
  });

  it("stays the user's after the user reverts the edit", async () => {
    const { key } = await createNote("agent text");
    await userSets(key, "agent text", "user text");
    expect(await byLLM(key)).toBe(false); // the take-over is noticed (and recorded) here
    await userSets(key, "user text", "agent text");
    expect(await byLLM(key)).toBe(false);
    expect(text(await callTool("edit_note", { noteKey: key, markdown: "again" }))).toMatch(TAKEN);
  });

  it("stays the user's after the user reverts the edit before any tool looked at it", async () => {
    const { key } = await createNote("agent draft");
    await userSets(key, "agent draft", "user draft");
    await zeval("await Zotero.Promise.delay(300);"); // the plugin's Notifier observer runs after the commit
    await userSets(key, "user draft", "agent draft");
    expect(text(await callTool("edit_note", { noteKey: key, markdown: "again" }))).toMatch(TAKEN);
    expect(await byLLM(key)).toBe(false);
  });

  it("keeps the tags the agent added to it as the agent's: remove_tags still works", async () => {
    const { key } = await createNote("tagged note");
    expect((await callTool("add_tags", { itemKey: key, tags: ["agent-tag"] })).isError).toBeFalsy();
    await userSets(key, "tagged note", "tagged note, edited");
    const r = await callTool("remove_tags", { itemKey: key, tags: ["agent-tag"] });
    expect(r.isError).toBeFalsy();
    expect((await noteState(key)).tags).toEqual(["[LLM]"]);
  });

  it("a note the user didn't change stays the agent's (edits and trash still work)", async () => {
    const { key } = await createNote("untouched");
    // A save that leaves the content as it was (the note editor rewriting its formatting) isn't an edit.
    await zeval(`
      const n = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
      n.setNote(n.getNote().replace("<p>", "\\n<p>")); await n.saveTx();
    `);
    expect(await byLLM(key)).toBe(true);
    expect((await callTool("edit_note", { noteKey: key, markdown: "still mine" })).isError).toBeFalsy();
    expect((await callTool("trash", { itemKeys: [key] })).isError).toBeFalsy();
  });

  it("a formatting-only edit (underline, text colour) makes it the user's; undo of the agent's edit keeps the user's HTML", async () => {
    const { key } = await createNote("plain words here");
    const edited = await callTool("edit_note", { noteKey: key, markdown: "agent words here" });
    expect(edited.isError).toBeFalsy();
    await userSets(key, "agent words", '<u>agent</u> <span style="color: #ff2020">words</span>');
    const before = await noteState(key);
    const u = await callTool("undo", { changeId: edited.structuredContent.changeId });
    expect(u.isError).toBe(true);
    expect(text(u)).toMatch(TAKEN);
    expect(await noteState(key)).toEqual(before);
    expect(await byLLM(key)).toBe(false);
  });

  it("opening and closing it in Zotero's note editor is not an edit", async () => {
    const { key } = await createNote(
      "# Heading\n\nSome **bold**, *italic*, `code`, [a link](https://example.org/?a=1&b=2) and $x^2$.\n\n" +
        "$$\ny = mx + b\n$$\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n```\ncode block\n```",
    );
    const before = await noteState(key);
    const after = await zeval(`
      const note = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
      const win = Zotero.getMainWindow();
      const ei = await Zotero.Notes.open(note.id, null, {});
      await ei._initPromise;
      await Zotero.Promise.delay(1500);
      for (const t of win.Zotero_Tabs._tabs.filter((t) => t.type == "note")) win.Zotero_Tabs.close(t.id);
      await Zotero.Promise.delay(1000);
      return note.getNote();
    `);
    expect(after).toBe(before.html); // the editor doesn't save on open/close
    expect(await byLLM(key)).toBe(true);
    expect((await callTool("edit_note", { noteKey: key, markdown: "still the agent's" })).isError).toBeFalsy();
  });

  it("is not watched while the plugin is disabled (its observer is gone); the check when a tool looks remains", async () => {
    const { key } = await createNote("draft while off");
    await setPluginEnabled(false);
    try {
      await userSets(key, "draft while off", "user's words while off");
      await zeval("await Zotero.Promise.delay(300);");
      await userSets(key, "user's words while off", "draft while off");
    } finally {
      await setPluginEnabled(true);
    }
    // Reverted while nothing watched: indistinguishable from no edit.
    expect(await byLLM(key)).toBe(true);
    await setPluginEnabled(false);
    try {
      await userSets(key, "draft while off", "kept edit while off");
    } finally {
      await setPluginEnabled(true);
    }
    expect(text(await callTool("edit_note", { noteKey: key, markdown: "x" }))).toMatch(TAKEN);
  });
});
