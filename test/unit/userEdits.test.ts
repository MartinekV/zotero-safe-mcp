// Ticket 14: once the user edits a note the agent wrote, the note (and its embedded images) is the
// user's for good. Real SQLite change log, notes faked behind NoteReader.
import { beforeEach, describe, expect, it } from "vitest";
import { createChangeLog, type ChangeLog } from "../../src/changes/changeLog";
import { requireNotUserTaken, userTakenKeys, type NoteReader } from "../../src/ownership/userEdits";
import { ToolError } from "../../src/registry/types";
import { sqliteDb } from "./sqliteDb";

const L = 1;
const wrap = (body: string) => `<div data-schema-version="9">${body}</div>`;

let html: Map<string, string>;
let parents: Map<string, string>;
let reader: NoteReader;
let log: ChangeLog;

beforeEach(async () => {
  html = new Map();
  parents = new Map();
  reader = {
    noteHtml: (libraryID, key) => (libraryID === L && html.get(key)) ?? null,
    parentKey: (libraryID, key) => (libraryID === L && parents.get(key)) ?? null,
  };
  let n = 0;
  log = createChangeLog({ db: sqliteDb(), newId: () => `chg_${++n}` });
  await log.ensureSchema();
});

/** The agent writes a note (create_note / edit_note): Zotero gets the HTML and the registry remembers it. */
async function agentWrites(key: string, content: string) {
  const isNew = !html.has(key);
  html.set(key, content);
  return log.recordWrite({ tool: isNew ? "create_note" : "edit_note", args: {} }, async (w) => {
    if (isNew) w.ownObject({ libraryID: L, itemKey: key, kind: "note" });
    w.noteWritten({ libraryID: L, noteKey: key, html: content });
  });
}

const taken = (keys: string[]) => userTakenKeys(log, reader, L, keys);

describe("userTakenKeys", () => {
  it("a note still as the agent wrote it stays the agent's", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>agent text</p>"));
    expect(await taken(["NOTEAAAA"])).toEqual(new Set());
  });

  it("a note whose content the user changed in Zotero is the user's", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>agent text</p>"));
    await agentWrites("NOTEBBBB", wrap("<p>other</p>"));
    html.set("NOTEAAAA", wrap("<p>agent text and the user's sentence</p>"));
    expect(await taken(["NOTEAAAA", "NOTEBBBB"])).toEqual(new Set(["NOTEAAAA"]));
  });

  it("whitespace between blocks and attribute order are not a user edit", async () => {
    await agentWrites("NOTEAAAA", wrap('<ul><li><p>one <a href="x" rel="r">l</a></p></li></ul>'));
    html.set("NOTEAAAA", '<div data-schema-version="9">\n<ul>\n<li>\n<p>one <a rel="r" href="x">l</a></p>\n</li>\n</ul>\n</div>');
    expect(await taken(["NOTEAAAA"])).toEqual(new Set());
  });

  it("a formatting-only edit (underline, colour) is a user edit", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>one</p>"));
    await agentWrites("NOTEBBBB", wrap("<p>two</p>"));
    html.set("NOTEAAAA", wrap("<p><u>one</u></p>"));
    html.set("NOTEBBBB", wrap('<p><span style="color: #ff2020">two</span></p>'));
    expect(await taken(["NOTEAAAA", "NOTEBBBB"])).toEqual(new Set(["NOTEAAAA", "NOTEBBBB"]));
  });

  it("is permanent: the user reverting their edit doesn't hand the note back", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>agent text</p>"));
    html.set("NOTEAAAA", wrap("<p>user text</p>"));
    expect(await taken(["NOTEAAAA"])).toEqual(new Set(["NOTEAAAA"]));
    html.set("NOTEAAAA", wrap("<p>agent text</p>"));
    expect(await taken(["NOTEAAAA"])).toEqual(new Set(["NOTEAAAA"]));
  });

  it("a later agent write is compared against, not the first one", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>v1</p>"));
    await agentWrites("NOTEAAAA", wrap("<p>v2</p>"));
    expect(await taken(["NOTEAAAA"])).toEqual(new Set());
  });

  it("covers the embedded images (child items) of a note the user took over", async () => {
    await agentWrites("NOTEAAAA", wrap('<p>text</p><p><img data-attachment-key="IMGAAAAA"></p>'));
    parents.set("IMGAAAAA", "NOTEAAAA");
    parents.set("NOTEAAAA", "PAPERAAA");
    expect(await taken(["IMGAAAAA"])).toEqual(new Set());
    html.set("NOTEAAAA", wrap('<p>user text</p><p><img data-attachment-key="IMGAAAAA"></p>'));
    expect(await taken(["IMGAAAAA"])).toEqual(new Set(["IMGAAAAA"]));
  });

  it("items that aren't notes the agent wrote (highlights, papers, unknown keys) are never taken", async () => {
    html.set("USERNOTE", wrap("<p>the user's own note</p>"));
    expect(await taken(["USERNOTE", "HIGHLITE", "MISSING1"])).toEqual(new Set());
  });

  it("a note erased since the agent wrote it is not taken over", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>agent text</p>"));
    html.delete("NOTEAAAA");
    expect(await taken(["NOTEAAAA"])).toEqual(new Set());
  });

  it("a recorded take-over survives an undone agent write (records stay)", async () => {
    await agentWrites("NOTEAAAA", wrap("<p>agent text</p>"));
    html.set("NOTEAAAA", wrap("<p>user text</p>"));
    await taken(["NOTEAAAA"]);
    // The agent can't write it any more, but even a write recorded by mistake doesn't reset it.
    await agentWrites("NOTEAAAA", wrap("<p>user text</p>"));
    expect(await taken(["NOTEAAAA"])).toEqual(new Set(["NOTEAAAA"]));
  });
});

describe("requireNotUserTaken", () => {
  it("passes when nothing was taken over", () => {
    expect(() => requireNotUserTaken(["NOTEAAAA"], new Set(), "edit")).not.toThrow();
  });

  it("refuses with a clear message naming the notes", () => {
    let error: unknown;
    try {
      requireNotUserTaken(["NOTEAAAA", "NOTEBBBB"], new Set(["NOTEBBBB"]), "trash");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ToolError);
    const message = (error as ToolError).message;
    expect(message).toContain("NOTEBBBB");
    expect(message).not.toContain("NOTEAAAA");
    expect(message).toContain("you edited this note in Zotero; it is now yours");
    expect(message).toContain("trash");
    expect(message).toContain("Nothing was changed");
  });
});
