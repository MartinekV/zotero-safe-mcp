import { describe, expect, it } from "vitest";
import { llmComment } from "../../src/tools/add_highlight";

describe("add_highlight comment (SPEC Hard rule 3)", () => {
  it("prefixes [LLM], without doubling it", () => {
    expect(llmComment("key claim")).toBe("[LLM] key claim");
    expect(llmComment("[LLM] key claim")).toBe("[LLM] key claim");
    expect(llmComment(" [LLM]key")).toBe("[LLM]key");
  });
  it("is just [LLM] without a comment", () => {
    expect(llmComment(undefined)).toBe("[LLM]");
    expect(llmComment("  ")).toBe("[LLM]");
  });
  it("prefixes comments that merely mention [LLM] later", () => {
    expect(llmComment("not [LLM]")).toBe("[LLM] not [LLM]");
  });
});
