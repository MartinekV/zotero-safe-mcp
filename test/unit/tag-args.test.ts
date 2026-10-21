import { describe, expect, it } from "vitest";
import { ToolError } from "../../src/registry/types";
import { tagNames } from "../../src/tags/tagArgs";

function errorOf(fn: () => unknown): ToolError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
  throw new Error("expected a ToolError");
}

describe("tagNames", () => {
  it("normalises like Zotero stores tags: trimmed, NFC; duplicates dropped, case kept", () => {
    // "é" (e + combining acute) is stored by Zotero as "é"
    expect(tagNames(["  to read ", "to read", "To Read", "caf" + "é", "café"], "add")).toEqual([
      "to read",
      "To Read",
      "café",
    ]);
  });

  it("refuses blank tags and tags over 255 characters", () => {
    expect(errorOf(() => tagNames(["ok", "   "], "add")).message).toMatch(/empty/i);
    expect(() => tagNames(["x".repeat(255)], "add")).not.toThrow();
    expect(errorOf(() => tagNames(["x".repeat(256)], "add")).message).toMatch(/255/);
  });

  it("refuses the reserved [LLM] tag, however it is written, for both adding and removing", () => {
    for (const t of ["[LLM]", " [llm] ", "[Llm]"]) {
      expect(errorOf(() => tagNames(["fine", t], "add")).message).toContain("[LLM]");
      expect(errorOf(() => tagNames([t], "remove")).message).toContain("[LLM]");
    }
    expect(tagNames(["LLM", "[LLM] summary"], "add")).toEqual(["LLM", "[LLM] summary"]);
  });
});
