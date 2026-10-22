// POST /safe-mcp/image and ![caption](image:<imageId>) in create_note / edit_note, end to end.
import { beforeAll, describe, expect, it } from "vitest";
import { callTool, request, setPluginEnabled, zeval } from "./harness";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/** A PNG header claiming 640x480 (Zotero stores the bytes as given; only the size is read). */
function png640x480(): Buffer {
  const b = Buffer.from(PNG_1x1);
  b.writeUInt32BE(640, 16);
  b.writeUInt32BE(480, 20);
  return b;
}

const text = (r: any) => r.content[0].text as string;
let paperKey: string;

beforeAll(async () => {
  paperKey = await zeval(`
    const p = new Zotero.Item("book"); p.setField("title", "Image upload test paper"); await p.saveTx();
    return p.key;
  `);
});

async function upload(bytes: Uint8Array, contentType = "image/png") {
  const res = await request("/safe-mcp/image", { method: "POST", headers: { "Content-Type": contentType }, body: bytes });
  return { status: res.status, json: JSON.parse(res.body || "null"), headers: res.headers };
}

async function noteWithImages(key: string) {
  return zeval(`
    const L = Zotero.Libraries.userLibraryID;
    const n = Zotero.Items.getByLibraryAndKey(L, ${JSON.stringify(key)});
    const images = [];
    for (const a of Zotero.Items.get(n.getAttachments())) {
      const path = await a.getFilePathAsync();
      images.push({
        key: a.key, embedded: a.isEmbeddedImageAttachment(), contentType: a.attachmentContentType,
        bytes: path ? btoa(String.fromCharCode(...(await IOUtils.read(path)))) : null,
      });
    }
    return { html: n.getNote(), images };
  `);
}

describe("POST /safe-mcp/image", () => {
  it("needs the bearer token", async () => {
    const res = await request("/safe-mcp/image", { method: "POST", headers: { "Content-Type": "image/png" }, body: PNG_1x1, token: null });
    expect(res.status).toBe(401);
  });

  it("returns an imageId with the image's type and size", async () => {
    const r = await upload(png640x480());
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ contentType: "image/png", width: 640, height: 480, bytes: PNG_1x1.length });
    expect(r.json.markdown).toBe(`![caption](image:${r.json.imageId})`);
  });

  it("answers 415 for bytes that are not a PNG or JPEG", async () => {
    const r = await upload(Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"));
    expect(r.status).toBe(415);
    expect(r.json.error).toMatch(/Not a PNG or JPEG/);
  });

  it("answers 413 Payload Too Large over 10 MB", async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1);
    PNG_1x1.copy(big);
    const res = await request("/safe-mcp/image", { method: "POST", headers: { "Content-Type": "image/png" }, body: big });
    expect(res.status).toBe(413);
    expect(res.statusText).toBe("Payload Too Large");
  });
});

describe("images in notes", () => {
  it("create_note stores an uploaded image as an embedded image of the note, with its size", async () => {
    const { json } = await upload(png640x480());
    const r = await callTool("create_note", { parentItemKey: paperKey, markdown: `# Figure\n\n![A "figure"](image:${json.imageId})` });
    expect(r.isError, text(r)).toBeFalsy();
    const note = await noteWithImages(r.structuredContent.noteKey);
    expect(note.images).toHaveLength(1);
    const [img] = note.images;
    expect(img).toMatchObject({ embedded: true, contentType: "image/png", bytes: png640x480().toString("base64") });
    expect(note.html).toContain(`<img alt="A &quot;figure&quot;" data-attachment-key="${img.key}" width="640" height="480">`);
  });

  it("the note editor shows the image without rewriting the note, and keeps it when the note closes", async () => {
    const { json } = await upload(PNG_1x1);
    const r = await callTool("create_note", { parentItemKey: paperKey, markdown: `![dot](image:${json.imageId})` });
    const noteKey = r.structuredContent.noteKey;
    const before = await noteWithImages(noteKey);
    const after = await zeval(`
      const note = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(noteKey)});
      const win = Zotero.getMainWindow();
      const ei = await Zotero.Notes.open(note.id, null, {});
      await ei._initPromise;
      await Zotero.Promise.delay(1500);
      const editor = ei._iframeWindow.wrappedJSObject.getDataSync(false).html;
      for (const t of win.Zotero_Tabs._tabs.filter((t) => t.type == "note")) win.Zotero_Tabs.close(t.id);
      await Zotero.Promise.delay(1000); // closing runs deleteUnusedEmbeddedImages
      const image = Zotero.Items.getByLibraryAndKey(note.libraryID, ${JSON.stringify(before.images[0].key)});
      return { stored: note.getNote(), editor, imageExists: !!image && !image.deleted };
    `);
    expect(after.stored).toBe(before.html);
    expect(after.imageExists).toBe(true);
    expect(after.editor).toContain(`data-attachment-key="${before.images[0].key}"`);
  });

  it("an imageId works once", async () => {
    const { json } = await upload(PNG_1x1);
    const first = await callTool("create_note", { parentItemKey: paperKey, markdown: `![one](image:${json.imageId})` });
    expect(first.isError).toBeFalsy();
    const again = await callTool("create_note", { parentItemKey: paperKey, markdown: `![two](image:${json.imageId})` });
    expect(again.isError).toBe(true);
    expect(text(again)).toMatch(/Unknown image id/);
  });

  it("a call that fails leaves the upload usable", async () => {
    const { json } = await upload(PNG_1x1);
    const failed = await callTool("create_note", { parentItemKey: paperKey, markdown: `![x](image:${json.imageId}) [@ZZZZZZZZ]` });
    expect(failed.isError).toBe(true);
    const ok = await callTool("create_note", { parentItemKey: paperKey, markdown: `![x](image:${json.imageId})` });
    expect(ok.isError, text(ok)).toBeFalsy();
  });

  it("edit_note adds an uploaded image and keeps the note's existing one (list_notes round trip)", async () => {
    const a = (await upload(PNG_1x1)).json.imageId;
    const created = await callTool("create_note", { parentItemKey: paperKey, markdown: `![first](image:${a})` });
    const noteKey = created.structuredContent.noteKey;
    const [existing] = (await noteWithImages(noteKey)).images;

    const listed = (await callTool("list_notes", { itemKey: noteKey })).structuredContent.notes[0].content as string;
    expect(listed).toContain(`image:${existing.key}`);
    const b = (await upload(png640x480())).json.imageId;
    const r = await callTool("edit_note", { noteKey, markdown: `${listed}\n\n![second](image:${b})` });
    expect(r.isError, text(r)).toBeFalsy();

    const note = await noteWithImages(noteKey);
    expect(note.images).toHaveLength(2);
    const added = note.images.find((i: any) => i.key !== existing.key);
    expect(note.html).toContain(`data-attachment-key="${existing.key}"`);
    expect(note.html).toContain(`<img alt="second" data-attachment-key="${added.key}" width="640" height="480">`);
  });

  it("uploads are discarded when the plugin shuts down", async () => {
    const { json } = await upload(PNG_1x1);
    await setPluginEnabled(false);
    await setPluginEnabled(true);
    const r = await callTool("create_note", { parentItemKey: paperKey, markdown: `![x](image:${json.imageId})` });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Unknown image id/);
  });
});
