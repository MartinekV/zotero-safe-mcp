import { beforeEach, describe, expect, it } from "vitest";
import { createChangeLog, type ChangeLog } from "../../src/changes/changeLog";
import type { ChangeRecord, UndoHandler } from "../../src/changes/types";
import { ToolError } from "../../src/registry/types";
import { sqliteDb } from "./sqliteDb";

const L = 1;
let log: ChangeLog;
let undone: ChangeRecord[];
let now: number;

const trashCreated: UndoHandler = {
  kind: "create_note",
  async undo(change) {
    undone.push(change);
    return `Trashed ${change.objects.map((o) => o.itemKey).join(", ")}`;
  },
};

beforeEach(async () => {
  undone = [];
  now = 1_700_000_000_000;
  let n = 0;
  log = createChangeLog({
    db: sqliteDb(),
    now: () => now++,
    newId: () => `chg_${++n}`,
    undoHandlers: [trashCreated, { kind: "explodes", undo: async () => { throw new ToolError("cannot"); } }],
  });
  await log.ensureSchema();
});

async function createNote(key: string) {
  return log.recordWrite({ tool: "create_note", args: { markdown: key } }, async (w) => {
    w.ownObject({ libraryID: L, itemKey: key, kind: "note" });
    w.summary = `Created note ${key}`;
    return { noteKey: key };
  });
}

describe("recordWrite", () => {
  it("returns a changeId and the handler's result; the change is listed newest first", async () => {
    const a = await createNote("NOTEAAAA");
    const b = await createNote("NOTEBBBB");
    expect(a).toEqual({ changeId: "chg_1", result: { noteKey: "NOTEAAAA" } });
    const list = await log.list(10);
    expect(list.map((c) => [c.changeId, c.tool, c.summary, c.undone])).toEqual([
      [b.changeId, "create_note", "Created note NOTEBBBB", false],
      [a.changeId, "create_note", "Created note NOTEAAAA", false],
    ]);
    expect(await log.list(1)).toHaveLength(1);
  });

  it("records created objects as owned; other objects are not", async () => {
    await createNote("NOTEAAAA");
    expect(await log.isOwned(L, "NOTEAAAA")).toBe(true);
    expect(await log.isOwned(L, "USERNOTE")).toBe(false);
    expect(await log.isOwned(2, "NOTEAAAA")).toBe(false);
    expect(await log.ownedKeys(L, ["NOTEAAAA", "USERNOTE"])).toEqual(new Set(["NOTEAAAA"]));
  });

  it("records added tag pairs; disowning a pair removes it from the registry", async () => {
    await log.recordWrite({ tool: "add_tags", args: {} }, async (w) => {
      w.ownTag({ libraryID: L, itemKey: "PAPERAAA", tag: "llm" });
      w.ownTag({ libraryID: L, itemKey: "PAPERAAA", tag: "two" });
    });
    expect(await log.ownedTags(L, "PAPERAAA")).toEqual(new Set(["llm", "two"]));
    expect(await log.ownedTags(L, "PAPERBBB")).toEqual(new Set());
    await log.recordWrite({ tool: "remove_tags", args: {} }, async (w) => {
      w.disownTag({ libraryID: L, itemKey: "PAPERAAA", tag: "llm" });
    });
    expect(await log.ownedTags(L, "PAPERAAA")).toEqual(new Set(["two"]));
  });

  it("a failing write leaves no change, no ownership and no note version behind", async () => {
    await expect(
      log.recordWrite({ tool: "create_note", args: {} }, async (w) => {
        w.ownObject({ libraryID: L, itemKey: "NOTEFAIL", kind: "note" });
        w.saveNoteVersion({ libraryID: L, noteKey: "NOTEFAIL", html: "<p>old</p>" });
        throw new ToolError("Unknown citation key");
      }),
    ).rejects.toThrow("Unknown citation key");
    expect(await log.list(10)).toEqual([]);
    expect(await log.isOwned(L, "NOTEFAIL")).toBe(false);
  });

  it("keeps args, data and note versions with the change for its undo handler", async () => {
    const { changeId } = await log.recordWrite({ tool: "edit_note", args: { noteKey: "NOTEAAAA" } }, async (w) => {
      w.saveNoteVersion({ libraryID: L, noteKey: "NOTEAAAA", html: "<p>previous</p>" });
      w.data = { images: ["IMG00001"] };
    });
    const change = await log.get(changeId);
    expect(change).toMatchObject({
      changeId,
      tool: "edit_note",
      kind: "edit_note",
      args: { noteKey: "NOTEAAAA" },
      data: { images: ["IMG00001"] },
      summary: "edit_note",
      undone: false,
      objects: [],
      tags: [],
      noteVersions: [{ libraryID: L, noteKey: "NOTEAAAA", html: "<p>previous</p>" }],
    });
    expect(await log.get("chg_nope")).toBeNull();
  });
});

describe("undo", () => {
  it("by default undoes the last change not yet undone, newest first", async () => {
    await createNote("NOTEAAAA");
    await createNote("NOTEBBBB");
    expect(await log.undo()).toMatchObject({ changeId: "chg_2", summary: "Trashed NOTEBBBB" });
    expect(await log.undo()).toMatchObject({ changeId: "chg_1", summary: "Trashed NOTEAAAA" });
    await expect(log.undo()).rejects.toThrow(/nothing to undo/i);
    expect(undone.map((c) => c.objects[0].itemKey)).toEqual(["NOTEBBBB", "NOTEAAAA"]);
    expect((await log.list(10)).map((c) => c.undone)).toEqual([true, true]);
  });

  it("undoes a specific change by id, and the default then skips it", async () => {
    await createNote("NOTEAAAA");
    await createNote("NOTEBBBB");
    await log.undo("chg_1");
    expect(await log.undo()).toMatchObject({ changeId: "chg_2" });
    await expect(log.undo()).rejects.toThrow(/nothing to undo/i);
  });

  it("refuses to undo a change twice, and refuses unknown ids", async () => {
    await createNote("NOTEAAAA");
    await log.undo("chg_1");
    await expect(log.undo("chg_1")).rejects.toThrow(/already undone/i);
    expect(undone).toHaveLength(1);
    await expect(log.undo("chg_99")).rejects.toThrow(/no change chg_99/i);
  });

  it("refuses changes whose kind has no undo handler", async () => {
    await log.recordWrite({ tool: "mystery", args: {} }, async () => {});
    await expect(log.undo()).rejects.toThrow(/cannot be undone/i);
    expect((await log.list(1))[0].undone).toBe(false);
  });

  it("dispatches on the recorded kind, not the tool name", async () => {
    await log.recordWrite({ tool: "import_paper", kind: "create_note", args: {} }, async (w) => {
      w.ownObject({ libraryID: L, itemKey: "PAPERAAA", kind: "paper" });
    });
    expect(await log.undo()).toMatchObject({ tool: "import_paper", summary: "Trashed PAPERAAA" });
  });

  it("a failing undo handler leaves the change not undone", async () => {
    await log.recordWrite({ tool: "x", kind: "explodes", args: {} }, async () => {});
    await expect(log.undo()).rejects.toThrow("cannot");
    expect((await log.list(1))[0].undone).toBe(false);
  });

  it("an undo handler can own a tag pair again (undo of a removal); a failing undo owns nothing", async () => {
    const pair = { libraryID: L, itemKey: "PAPERAAA", tag: "llm" };
    const reown = (fail: boolean): UndoHandler => ({
      kind: fail ? "reown-fails" : "reown",
      async undo(_change, ctx) {
        await ctx.ownTag(pair);
        if (fail) throw new ToolError("cannot");
        return "Restored";
      },
    });
    log = createChangeLog({ db: sqliteDb(), undoHandlers: [reown(false), reown(true)] });
    await log.ensureSchema();
    const failing = await log.recordWrite({ tool: "remove_tags", kind: "reown-fails", args: {} }, async () => {});
    await expect(log.undo(failing.changeId)).rejects.toThrow("cannot");
    expect(await log.ownedTags(L, "PAPERAAA")).toEqual(new Set());
    const { changeId } = await log.recordWrite({ tool: "remove_tags", kind: "reown", args: {} }, async () => {});
    await log.undo(changeId);
    expect(await log.ownedTags(L, "PAPERAAA")).toEqual(new Set(["llm"]));
  });
});

it("rejects two undo handlers for the same kind", () => {
  expect(() => createChangeLog({ db: sqliteDb(), undoHandlers: [trashCreated, trashCreated] })).toThrow(/create_note/);
});
