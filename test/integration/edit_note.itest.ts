// edit_note and its undo, end to end: ownership refusal, [LLM] tag, version restore, embedded images.
import { beforeAll, describe, expect, it } from "vitest";
import { callTool, request, zeval } from "./harness";

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const text = (r: any) => r.content[0].text as string;

let paperKey: string;
let userNoteKey: string;

beforeAll(async () => {
  ({ paperKey, userNoteKey } = await zeval(`
    const p = new Zotero.Item("book"); p.setField("title", "Edit note test paper"); await p.saveTx();
    const n = new Zotero.Item("note"); n.parentID = p.id; n.setNote("<p>The user's note</p>"); n.addTag("[LLM]");
    await n.saveTx();
    return { paperKey: p.key, userNoteKey: n.key };
  `));
});

async function note(key: string) {
  return zeval(`
    const L = Zotero.Libraries.userLibraryID;
    const n = Zotero.Items.getByLibraryAndKey(L, ${JSON.stringify(key)});
    const images = [];
    for (const a of Zotero.Items.get(n.getAttachments())) {
      const path = await a.getFilePathAsync();
      images.push({ key: a.key, bytes: path ? btoa(String.fromCharCode(...(await IOUtils.read(path)))) : null });
    }
    return { html: n.getNote(), deleted: n.deleted, tags: n.getTags().map((t) => t.tag), images };
  `);
}

async function createNote(markdown: string): Promise<string> {
  const r = await callTool("create_note", { parentItemKey: paperKey, markdown });
  expect(r.isError).toBeFalsy();
  return r.structuredContent.noteKey;
}

/**
 * Creates a note with `text` and one embedded image (uploaded via POST /safe-mcp/image), as the agent
 * does. (Adding the image through Zotero would be a user edit: the note would become the user's.)
 */
async function createNoteWithImage(text: string, alt: string): Promise<{ key: string; img: string }> {
  const res = await request("/safe-mcp/image", { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.from(PNG_1x1, "base64") });
  expect(res.status).toBe(200);
  const { imageId } = JSON.parse(res.body);
  const r = await callTool("create_note", { parentItemKey: paperKey, markdown: `${text}\n\n![${alt}](image:${imageId})` });
  expect(r.isError).toBeFalsy();
  return { key: r.structuredContent.noteKey, img: r.structuredContent.imageKeys[0] };
}

async function listed(noteKey: string): Promise<string> {
  const notes = (await callTool("list_notes", { itemKey: noteKey })).structuredContent.notes;
  return notes[0].content;
}

describe("edit_note", () => {
  it("refuses notes the user made, even with an [LLM] tag, and changes nothing", async () => {
    const r = await callTool("edit_note", { noteKey: userNoteKey, markdown: "overwritten" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Refusing to edit: .* not created by this plugin/);
    expect((await note(userNoteKey)).html).toBe("<p>The user's note</p>");
    expect((await callTool("edit_note", { noteKey: paperKey, markdown: "x" })).isError).toBe(true);
  });

  it("replaces an owned note's content and keeps its [LLM] tag; undo restores the previous version, then undo of create trashes it", async () => {
    const key = await createNote("# First\n\nversion one");
    const before = (await note(key)).html;
    const r = await callTool("edit_note", { noteKey: key, markdown: "# Second\n\nversion **two**" });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ noteKey: key, title: "Second" });
    expect(r.structuredContent.changeId).toMatch(/^chg_/);
    expect(await listed(key)).toBe("# Second\n\nversion **two**");
    expect((await note(key)).tags).toEqual(["[LLM]"]);
    const changes = (await callTool("list_changes", {})).structuredContent.changes;
    expect(changes[0]).toMatchObject({ changeId: r.structuredContent.changeId, tool: "edit_note", summary: `Edited note ${key} "Second"` });

    const u = await callTool("undo", {});
    expect(u.structuredContent).toMatchObject({ undoneChangeId: r.structuredContent.changeId, tool: "edit_note" });
    expect((await note(key)).html).toBe(before);
    await callTool("undo", {});
    expect((await note(key)).deleted).toBe(true);
    const again = await callTool("edit_note", { noteKey: key, markdown: "x" });
    expect(text(again)).toMatch(/in the trash/);
  });

  it("refuses to undo when the user changed the note in Zotero after the edit (the note is the user's now)", async () => {
    const key = await createNote("v1");
    const r = await callTool("edit_note", { noteKey: key, markdown: "v2" });
    await zeval(`
      const n = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
      n.setNote(n.getNote().replace("v2", "v2 plus the user's words")); await n.saveTx();
    `);
    const u = await callTool("undo", { changeId: r.structuredContent.changeId });
    expect(u.isError).toBe(true);
    expect(text(u)).toMatch(/you edited this note in Zotero; it is now yours/);
    expect(await listed(key)).toBe("v2 plus the user's words");
  });
});

describe("edit_note with embedded images", () => {
  it("a list_notes → edit_note round trip keeps the note's images, with their size", async () => {
    const { key, img } = await createNoteWithImage("Figure below", "a dot");
    const md = await listed(key);
    expect(md).toBe(`Figure below\n\n![a dot](image:${img})`);
    const r = await callTool("edit_note", { noteKey: key, markdown: `Figure below, explained\n\n${md.split("\n\n")[1]}` });
    expect(r.isError).toBeFalsy();
    const n = await note(key);
    expect(n.html).toMatch(new RegExp(`<img[^>]*data-attachment-key="${img}"`));
    expect(n.html).toMatch(/width="1"/);
    expect(n.images.map((i: any) => i.key)).toEqual([img]);
  });

  it("refuses image keys that are not the note's own images", async () => {
    const { img: foreign } = await createNoteWithImage("other", "theirs");
    const key = await createNote("mine");
    const r = await callTool("edit_note", { noteKey: key, markdown: `![x](image:${foreign})` });
    expect(r.isError).toBe(true);
    expect(await listed(key)).toBe("mine");
  });

  it("undo re-imports an image the edit dropped after Zotero erased it", async () => {
    const { key, img } = await createNoteWithImage("With image", "dot");
    const r = await callTool("edit_note", { noteKey: key, markdown: "No image any more" });
    // What Zotero does when the user closes the note in the editor:
    await zeval(`
      const n = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
      await Zotero.Notes.deleteUnusedEmbeddedImages(n);
    `);
    expect((await note(key)).images).toEqual([]);

    const u = await callTool("undo", { changeId: r.structuredContent.changeId });
    expect(u.isError).toBeFalsy();
    const n = await note(key);
    expect(n.images).toHaveLength(1);
    const [{ key: newKey, bytes }] = n.images;
    expect(newKey).not.toBe(img);
    expect(bytes).toBe(PNG_1x1);
    expect(u.structuredContent.summary).toContain(`re-imported image ${img} as ${newKey}`);
    expect(await listed(key)).toBe(`With image\n\n![dot](image:${newKey})`);
  });
});
