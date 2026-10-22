import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../../src/registry/tools";
import { createRateLimiter } from "../../src/ownership/rateLimit";
import { defineTool } from "../../src/registry/types";

const ctx = { log: () => {} };

function setup(perMinute = 2) {
  let now = 1_000_000;
  const calls: string[] = [];
  const tool = (name: string, write: boolean) =>
    defineTool({
      name,
      description: name,
      write,
      inputSchema: { type: "object" },
      handler() {
        calls.push(name);
        return { ok: name };
      },
    });
  const limiter = createRateLimiter({ perMinute: () => perMinute, now: () => now });
  const registry = createToolRegistry([tool("write_a", true), tool("write_b", true), tool("read_a", false)], {
    writeLimiter: limiter,
  });
  return { registry, calls, advance: (ms: number) => (now += ms) };
}

describe("write rate limit", () => {
  it("allows up to the cap per minute across all write tools, then fails without running the tool", async () => {
    const { registry, calls } = setup(2);
    expect((await registry.call("write_a", {}, ctx)).isError).toBeUndefined();
    expect((await registry.call("write_b", {}, ctx)).isError).toBeUndefined();
    const over = await registry.call("write_a", {}, ctx);
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toMatch(/rate limit/i);
    expect(over.content[0].text).toMatch(/2 write/);
    expect(calls).toEqual(["write_a", "write_b"]);
  });

  it("does not count or block read tools", async () => {
    const { registry, calls } = setup(1);
    await registry.call("write_a", {}, ctx);
    for (let i = 0; i < 5; i++) expect((await registry.call("read_a", {}, ctx)).isError).toBeUndefined();
    expect((await registry.call("write_a", {}, ctx)).isError).toBe(true);
    expect(calls).toEqual(["write_a", "read_a", "read_a", "read_a", "read_a", "read_a"]);
  });

  it("is a sliding one-minute window", async () => {
    const { registry, advance } = setup(2);
    await registry.call("write_a", {}, ctx); // t=0
    advance(30_000);
    await registry.call("write_a", {}, ctx); // t=30s
    advance(29_999);
    expect((await registry.call("write_a", {}, ctx)).isError).toBe(true); // first still inside the window
    advance(1);
    expect((await registry.call("write_a", {}, ctx)).isError).toBeUndefined(); // first one left the window
    expect((await registry.call("write_a", {}, ctx)).isError).toBe(true);
  });

  it("calls rejected for invalid arguments do not use up the budget", async () => {
    let now = 0;
    const limiter = createRateLimiter({ perMinute: () => 1, now: () => now });
    const strict = defineTool({
      name: "strict_write",
      description: "x",
      write: true,
      inputSchema: { type: "object", required: ["x"], properties: { x: { type: "string" } } },
      handler: () => "done",
    });
    const registry = createToolRegistry([strict], { writeLimiter: limiter });
    expect((await registry.call("strict_write", {}, ctx)).isError).toBe(true);
    expect((await registry.call("strict_write", { x: "a" }, ctx)).content[0].text).toBe("done");
  });
});

describe("write serialisation", () => {
  it("runs write tools one at a time, in call order", async () => {
    const events: string[] = [];
    const slow = (name: string, ms: number) =>
      defineTool({
        name,
        description: name,
        write: true,
        inputSchema: { type: "object" },
        async handler() {
          events.push(`start ${name}`);
          await new Promise((r) => setTimeout(r, ms));
          events.push(`end ${name}`);
          return name;
        },
      });
    const registry = createToolRegistry([slow("w1", 20), slow("w2", 1)]);
    await Promise.all([registry.call("w1", {}, ctx), registry.call("w2", {}, ctx)]);
    expect(events).toEqual(["start w1", "end w1", "start w2", "end w2"]);
  });

  it("a failing write does not block the next one", async () => {
    const boom = defineTool({ name: "boom", description: "x", write: true, inputSchema: { type: "object" }, handler: () => { throw new Error("x"); } });
    const ok = defineTool({ name: "ok", description: "x", write: true, inputSchema: { type: "object" }, handler: () => "fine" });
    const registry = createToolRegistry([boom, ok]);
    const [a, b] = await Promise.all([registry.call("boom", {}, ctx), registry.call("ok", {}, ctx)]);
    expect(a.isError).toBe(true);
    expect(b.content[0].text).toBe("fine");
  });
});
