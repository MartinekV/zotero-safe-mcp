import { describe, it, expect } from "vitest";
import { createMcpHandler } from "../../src/mcp/handler";
import { HttpRequest, ToolDef, ToolError } from "../../src/registry/types";

function post(data: unknown): HttpRequest {
  return { method: "POST", pathname: "/safe-mcp", headers: {}, data };
}

const echo: ToolDef = {
  name: "echo",
  description: "Echo",
  write: false,
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
  handler: (args: { text: string }) => ({ echoed: args.text }),
};

function handler(tools: ToolDef[] = [echo]) {
  return createMcpHandler({ tools, version: "9.9.9", log: () => {} });
}

async function rpc(data: unknown, tools?: ToolDef[]) {
  const res = await handler(tools)(post(data));
  return { status: res.status, json: res.body ? JSON.parse(res.body) : undefined, res };
}

describe("MCP endpoint", () => {
  it("answers initialize with server info and tools capability", async () => {
    const { status, json } = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    expect(status).toBe(200);
    expect(json.id).toBe(1);
    expect(json.result.protocolVersion).toBe("2025-06-18");
    expect(json.result.serverInfo).toEqual({ name: "zotero-safe-mcp", version: "9.9.9" });
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it("answers a notification with 202 and no body", async () => {
    const { status, res } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(status).toBe(202);
    expect(res.body ?? "").toBe("");
  });

  it("answers ping with an empty result", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: "p", method: "ping" });
    expect(status).toBe(200);
    expect(json).toEqual({ jsonrpc: "2.0", id: "p", result: {} });
  });

  it("answers an unknown method with -32601", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: 2, method: "resources/list" });
    expect(status).toBe(200);
    expect(json.id).toBe(2);
    expect(json.error.code).toBe(-32601);
  });

  it.each([
    ["a missing body", null],
    ["a non-object body", "hello"],
    ["a missing jsonrpc version", { id: 1, method: "ping" }],
    ["a wrong jsonrpc version", { jsonrpc: "1.0", id: 1, method: "ping" }],
    ["a non-string method", { jsonrpc: "2.0", id: 1, method: 5 }],
    ["an object id", { jsonrpc: "2.0", id: { a: 1 }, method: "ping" }],
  ])("rejects %s as Invalid Request (400, -32600)", async (_label, data) => {
    const { status, json } = await rpc(data);
    expect(status).toBe(400);
    expect(json.id).toBe(null);
    expect(json.error.code).toBe(-32600);
  });

  it("rejects JSON-RPC batches (400, -32600)", async () => {
    const { status, json } = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    expect(status).toBe(400);
    expect(json.error.code).toBe(-32600);
    expect(json.error.message).toMatch(/batch/i);
  });

  it("accepts JSON-RPC responses from the client with 202", async () => {
    const { status } = await rpc({ jsonrpc: "2.0", id: 7, result: {} });
    expect(status).toBe(202);
  });

  it("answers GET (SSE stream request) with 405", async () => {
    const res = await handler()({ method: "GET", pathname: "/safe-mcp", headers: {}, data: null });
    expect(res.status).toBe(405);
    expect(res.headers?.Allow).toBe("POST");
  });

  describe("tools", () => {
    const call = (name: unknown, args?: unknown, tools?: ToolDef[]) =>
      rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } }, tools);

    function failing(thrown: unknown): ToolDef {
      return { ...echo, name: "boom", handler: () => { throw thrown; } };
    }

    it("lists registered tools with their schema and a read-only hint", async () => {
      const write: ToolDef = { ...echo, name: "writer", write: true };
      const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, [echo, write]);
      expect(json.result.tools).toEqual([
        { name: "echo", description: "Echo", inputSchema: echo.inputSchema, annotations: { readOnlyHint: true, destructiveHint: false } },
        { name: "writer", description: "Echo", inputSchema: echo.inputSchema, annotations: { readOnlyHint: false, destructiveHint: false } },
      ]);
    });

    it("lists no tools when none are registered", async () => {
      const { json } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, []);
      expect(json.result).toEqual({ tools: [] });
    });

    it("calls a tool and returns its result as text and structured content", async () => {
      const { status, json } = await call("echo", { text: "hi" });
      expect(status).toBe(200);
      expect(json.id).toBe(3);
      expect(json.result.isError).toBeUndefined();
      expect(JSON.parse(json.result.content[0].text)).toEqual({ echoed: "hi" });
      expect(json.result.content[0].type).toBe("text");
      expect(json.result.structuredContent).toEqual({ echoed: "hi" });
    });

    it.each([
      ["params missing", undefined],
      ["params not an object", [1]],
      ["name missing", { arguments: {} }],
      ["arguments not an object", { name: "echo", arguments: "x" }],
      ["unknown tool", { name: "nope", arguments: {} }],
    ])("answers %s with -32602", async (_label, params) => {
      const { status, json } = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params });
      expect(status).toBe(200);
      expect(json.id).toBe(4);
      expect(json.error.code).toBe(-32602);
    });

    it("returns schema violations as an isError result naming the argument", async () => {
      const { json } = await call("echo", { text: 5 });
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toMatch(/text/);
    });

    it("does not run the handler when arguments are invalid", async () => {
      let ran = false;
      const spy: ToolDef = { ...echo, handler: () => { ran = true; } };
      await call("echo", { text: "a", extra: 1 }, [spy]);
      expect(ran).toBe(false);
    });

    it("treats missing arguments as an empty object", async () => {
      const noArgs: ToolDef = { ...echo, inputSchema: { type: "object" }, handler: (a) => ({ got: a }) };
      const { json } = await call("echo", undefined, [noArgs]);
      expect(json.result.structuredContent).toEqual({ got: {} });
    });

    it.each([
      ["a ToolError", new ToolError("Item ABCD1234 not found"), "Item ABCD1234 not found"],
      ["an unexpected Error", new Error("kaboom"), "kaboom"],
      ["a bare string (Zotero rejects with strings)", "translator failed", "translator failed"],
    ])("turns %s into an isError result", async (_label, thrown, text) => {
      const { status, json } = await call("boom", { text: "x" }, [failing(thrown)]);
      expect(status).toBe(200);
      expect(json.result.isError).toBe(true);
      expect(json.result.content[0].text).toContain(text);
    });

    it("returns non-object results as text only", async () => {
      const str: ToolDef = { ...echo, handler: () => "plain" };
      const { json } = await call("echo", { text: "x" }, [str]);
      expect(json.result.content[0].text).toBe("plain");
      expect(json.result.structuredContent).toBeUndefined();
    });
  });
});
