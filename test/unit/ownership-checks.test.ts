import { describe, expect, it } from "vitest";
import { requireOwned, requireOwnedTagPairs, splitNewTags } from "../../src/ownership/checks";
import { ToolError } from "../../src/registry/types";

const owned = new Set(["OWNED001", "OWNED002"]);

function errorOf(fn: () => unknown): ToolError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected a ToolError");
}

describe("requireOwned", () => {
  it("accepts objects the plugin created", () => {
    expect(() => requireOwned(["OWNED001", "OWNED002"], owned, "trash")).not.toThrow();
  });

  it("refuses the user's objects, naming every one of them", () => {
    const e = errorOf(() => requireOwned(["OWNED001", "USERITM1", "USERITM2"], owned, "trash"));
    expect(e.message).toContain("USERITM1");
    expect(e.message).toContain("USERITM2");
    expect(e.message).not.toContain("OWNED001");
    expect(e.message).toMatch(/trash/);
  });
});

describe("tag pairs", () => {
  it("only tags the item does not have yet are new (pre-existing pairs are never recorded)", () => {
    expect(splitNewTags(["user-tag", "Shared"], ["new", "user-tag", "new", "other"])).toEqual({
      added: ["new", "other"],
      alreadyPresent: ["user-tag"],
    });
  });

  it("tag names are compared exactly (Zotero tags are case-sensitive)", () => {
    expect(splitNewTags(["Shared"], ["shared"]).added).toEqual(["shared"]);
  });

  it("removing a pair the plugin added is allowed; a user's pair is refused, listing the offending tags", () => {
    const ownedPairs = new Set(["llm-tag"]);
    expect(() => requireOwnedTagPairs("ITEMKEY1", ["llm-tag"], ownedPairs)).not.toThrow();
    const e = errorOf(() => requireOwnedTagPairs("ITEMKEY1", ["llm-tag", "user-tag", "other"], ownedPairs));
    expect(e.message).toContain("ITEMKEY1");
    expect(e.message).toContain('"user-tag"');
    expect(e.message).toContain('"other"');
    expect(e.message).not.toContain('"llm-tag"');
  });
});
