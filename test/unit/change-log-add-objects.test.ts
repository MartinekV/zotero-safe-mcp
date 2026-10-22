// changeLog().addObjects: objects created after a change was recorded (import_paper's attachments that
// finish downloading later) join that change, so undo removes them too.
import { beforeEach, describe, expect, it } from "vitest";
import { createChangeLog, type ChangeLog } from "../../src/changes/changeLog";
import type { ChangeRecord } from "../../src/changes/types";
import { sqliteDb } from "./sqliteDb";

const L = 1;
let log: ChangeLog;
let undone: ChangeRecord[];

beforeEach(async () => {
  undone = [];
  let n = 0;
  log = createChangeLog({
    db: sqliteDb(),
    newId: () => `chg_${++n}`,
    undoHandlers: [{ kind: "import_paper", undo: async (c) => (undone.push(c), "ok") }],
  });
  await log.ensureSchema();
});

const importPaper = () =>
  log.recordWrite({ tool: "import_paper", args: {} }, async (w) => {
    w.ownObject({ libraryID: L, itemKey: "PAPERAAA", kind: "paper" });
  });

describe("addObjects", () => {
  it("records more owned objects under an existing change; undo sees all of them", async () => {
    const { changeId } = await importPaper();
    expect(await log.addObjects(changeId, [{ libraryID: L, itemKey: "PDFAAAAA", kind: "attachment" }])).toEqual({ undone: false });
    expect(await log.isOwned(L, "PDFAAAAA")).toBe(true);
    await log.undo(changeId);
    expect(undone[0].objects.map((o) => o.itemKey)).toEqual(["PAPERAAA", "PDFAAAAA"]);
  });

  it("reports when the change was undone meantime (the caller then removes the late objects itself)", async () => {
    const { changeId } = await importPaper();
    await log.undo(changeId);
    expect(await log.addObjects(changeId, [{ libraryID: L, itemKey: "PDFAAAAA", kind: "attachment" }])).toEqual({ undone: true });
    expect(await log.isOwned(L, "PDFAAAAA")).toBe(true);
  });

  it("records a late note's HTML like any agent note, so the user editing it later makes it theirs", async () => {
    const { changeId } = await importPaper();
    await log.addObjects(changeId, [{ libraryID: L, itemKey: "NOTEAAAA", kind: "note" }], [{ libraryID: L, noteKey: "NOTEAAAA", html: "<p>n</p>" }]);
    expect(await log.agentNotes(L, ["NOTEAAAA"])).toEqual(new Map([["NOTEAAAA", { html: "<p>n</p>", userEdited: false }]]));
  });

  it("refuses an unknown change and records nothing", async () => {
    await expect(log.addObjects("chg_nope", [{ libraryID: L, itemKey: "PDFAAAAA", kind: "attachment" }])).rejects.toThrow(/chg_nope/);
    expect(await log.isOwned(L, "PDFAAAAA")).toBe(false);
  });
});
