// add_tags, remove_tags and undo of both, end to end.
import { beforeEach, describe, expect, it } from "vitest";
import { callTool, zeval } from "./harness";

const text = (r: any) => r.content[0].text as string;

/** A fresh paper with the user's own tags (manual "user-tag", automatic "auto-tag"). */
async function userPaper(): Promise<string> {
  const { key } = await zeval(`
    const p = new Zotero.Item("book"); p.setField("title", "Tags test paper");
    p.addTag("user-tag"); p.addTag("auto-tag", 1);
    await p.saveTx();
    return { key: p.key };
  `);
  return key;
}

async function tagsOf(key: string): Promise<{ tag: string; type: number }[]> {
  return zeval(`
    const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(key)});
    return i.getTags().map((t) => ({ tag: t.tag, type: t.type || 0 })).sort((a, b) => a.tag.localeCompare(b.tag));
  `);
}

const names = async (key: string) => (await tagsOf(key)).map((t) => t.tag);

let paper: string;
beforeEach(async () => {
  paper = await userPaper();
});

describe("add_tags", () => {
  it("adds new tags as manual tags and reports which were already there", async () => {
    const r = await callTool("add_tags", { itemKey: paper, tags: ["llm-a", "user-tag", "auto-tag", "llm-b"] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ itemKey: paper, added: ["llm-a", "llm-b"], alreadyPresent: ["user-tag", "auto-tag"] });
    expect(r.structuredContent.changeId).toMatch(/^chg_/);
    expect(await tagsOf(paper)).toEqual([
      { tag: "auto-tag", type: 1 }, // pre-existing automatic tag untouched (addTag would convert it)
      { tag: "llm-a", type: 0 },
      { tag: "llm-b", type: 0 },
      { tag: "user-tag", type: 0 },
    ]);
  });
});

describe("add_tags edge cases", () => {
  it("stores tags trimmed, and the trimmed pair is the one owned", async () => {
    const r = await callTool("add_tags", { itemKey: paper, tags: ["  spaced out  "] });
    expect(r.structuredContent.added).toEqual(["spaced out"]);
    expect(await names(paper)).toContain("spaced out");
    expect((await callTool("remove_tags", { itemKey: paper, tags: ["spaced out "] })).isError).toBeFalsy();
  });

  it("refuses [LLM], a call that adds nothing, unknown and trashed items; none of them records a change", async () => {
    const before = (await callTool("list_changes", { limit: 1 })).structuredContent.changes[0]?.changeId;
    const llm = await callTool("add_tags", { itemKey: paper, tags: ["ok", "[llm]"] });
    expect(llm.isError).toBe(true);
    expect(text(llm)).toContain("reserved");
    const nothing = await callTool("add_tags", { itemKey: paper, tags: ["user-tag", "auto-tag"] });
    expect(nothing.isError).toBe(true);
    expect(text(nothing)).toContain("nothing was changed");
    expect((await callTool("add_tags", { itemKey: "ZZZZZZZZ", tags: ["x"] })).isError).toBe(true);
    await zeval(`
      const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(paper)});
      i.deleted = true; await i.saveTx();
    `);
    expect(text(await callTool("add_tags", { itemKey: paper, tags: ["x"] }))).toContain("trash");
    expect(await names(paper)).toEqual(["auto-tag", "user-tag"]);
    expect((await callTool("list_changes", { limit: 1 })).structuredContent.changes[0]?.changeId).toBe(before);
  });
});

describe("remove_tags", () => {
  it("removes tags the plugin added", async () => {
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a", "llm-b"] });
    const r = await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ itemKey: paper, removed: ["llm-a"] });
    expect(r.structuredContent.changeId).toMatch(/^chg_/);
    expect(await names(paper)).toEqual(["auto-tag", "llm-b", "user-tag"]);
  });

  it("refuses the user's tags, also ones add_tags reported as already present, and then removes nothing", async () => {
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a", "user-tag"] });
    const r = await callTool("remove_tags", { itemKey: paper, tags: ["llm-a", "user-tag", "auto-tag"] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('"user-tag"');
    expect(text(r)).toContain('"auto-tag"');
    expect(text(r)).not.toContain('"llm-a"');
    expect(await names(paper)).toEqual(["auto-tag", "llm-a", "user-tag"]);
  });

  it("refuses removing [LLM] from the plugin's own notes", async () => {
    const { noteKey } = (await callTool("create_note", { parentItemKey: paper, markdown: "Mine" })).structuredContent;
    const r = await callTool("remove_tags", { itemKey: noteKey, tags: ["[LLM]"] });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("reserved");
    expect(await names(noteKey)).toEqual(["[LLM]"]);
  });

  it("a tag the user re-adds after the plugin removed it belongs to the user", async () => {
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a"] });
    await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] });
    await zeval(`
      const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(paper)});
      i.addTag("llm-a"); await i.saveTx();
    `);
    expect((await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] })).isError).toBe(true);
  });
});

describe("undo", () => {
  it("of add_tags removes the tags it added that are still there, and nothing else", async () => {
    const { changeId } = (await callTool("add_tags", { itemKey: paper, tags: ["llm-a", "llm-b", "user-tag"] })).structuredContent;
    await zeval(`
      const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(paper)});
      i.removeTag("llm-b"); await i.saveTx();
    `);
    const r = await callTool("undo", { changeId });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.summary).toContain('"llm-a"');
    expect(await names(paper)).toEqual(["auto-tag", "user-tag"]);
    // The pairs are forgotten: a user re-adding the tag owns it.
    await zeval(`
      const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(paper)});
      i.addTag("llm-a"); await i.saveTx();
    `);
    expect((await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] })).isError).toBe(true);
  });

  it("of add_tags leaves a tag that a later add_tags added again (that change owns it now)", async () => {
    const first = (await callTool("add_tags", { itemKey: paper, tags: ["llm-a"] })).structuredContent.changeId;
    await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] });
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a"] });
    expect((await callTool("undo", { changeId: first })).isError).toBeFalsy();
    expect(await names(paper)).toContain("llm-a");
  });

  it("of remove_tags puts the removed tags back, owned again", async () => {
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a", "llm-b"] });
    const { changeId } = (await callTool("remove_tags", { itemKey: paper, tags: ["llm-a", "llm-b"] })).structuredContent;
    expect((await callTool("undo", { changeId })).isError).toBeFalsy();
    expect(await tagsOf(paper)).toEqual([
      { tag: "auto-tag", type: 1 },
      { tag: "llm-a", type: 0 },
      { tag: "llm-b", type: 0 },
      { tag: "user-tag", type: 0 },
    ]);
    expect((await callTool("remove_tags", { itemKey: paper, tags: ["llm-a", "llm-b"] })).isError).toBeFalsy();
  });

  it("of remove_tags does not take over a tag the user has since added back", async () => {
    await callTool("add_tags", { itemKey: paper, tags: ["llm-a"] });
    const { changeId } = (await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] })).structuredContent;
    await zeval(`
      const i = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(paper)});
      i.addTag("llm-a"); await i.saveTx();
    `);
    expect((await callTool("undo", { changeId })).isError).toBeFalsy();
    expect((await callTool("remove_tags", { itemKey: paper, tags: ["llm-a"] })).isError).toBe(true);
  });
});
