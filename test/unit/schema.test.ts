import { describe, it, expect } from "vitest";
import { validate } from "../../src/registry/schema";
import { JsonSchema } from "../../src/registry/types";

const schema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key"],
  properties: {
    key: { type: "string", pattern: "^[A-Z0-9]{8}$" },
    limit: { type: "integer", minimum: 1, maximum: 100 },
    color: { type: "string", enum: ["yellow", "red"] },
    tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 3 },
  },
};

describe("argument schema validation", () => {
  it("accepts valid arguments", () => {
    expect(validate(schema, { key: "ABCD1234", limit: 5, color: "red", tags: ["x"] })).toEqual([]);
  });

  it.each([
    [{}, "arguments.key is required"],
    [{ key: "abc" }, "arguments.key must match ^[A-Z0-9]{8}$"],
    [{ key: "ABCD1234", limit: 1.5 }, "arguments.limit must be an integer"],
    [{ key: "ABCD1234", limit: 0 }, "arguments.limit must be >= 1"],
    [{ key: "ABCD1234", limit: 101 }, "arguments.limit must be <= 100"],
    [{ key: "ABCD1234", color: "green" }, 'arguments.color must be one of "yellow", "red"'],
    [{ key: "ABCD1234", tags: [] }, "arguments.tags must have at least 1 items"],
    [{ key: "ABCD1234", tags: ["a", "b", "c", "d"] }, "arguments.tags must have at most 3 items"],
    [{ key: "ABCD1234", tags: [""] }, "arguments.tags[0] must have at least 1 characters"],
    [{ key: "ABCD1234", extra: 1 }, "arguments.extra is not allowed"],
  ])("reports %j", (value, message) => {
    expect(validate(schema, value)).toContain(message);
  });
});
