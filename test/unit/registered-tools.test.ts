// Sanity checks over every tool file in src/tools (auto-registered via index.generated.ts).
import { describe, it, expect } from "vitest";
import tools from "../../src/tools/index.generated";
import { createToolRegistry } from "../../src/registry/tools";

describe("registered tools", () => {
  it("have unique snake_case names, a description and an object schema", () => {
    expect(() => createToolRegistry(tools)).not.toThrow();
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema.type).toBe("object");
      expect(typeof t.write).toBe("boolean");
    }
  });
});
