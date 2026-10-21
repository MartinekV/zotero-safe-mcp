// The tool registry: listing, argument validation, dispatch, and the ONE place where tool
// failures become MCP `isError` results.
import type { McpToolCallResult, McpToolDefinition } from "../mcp/protocol";
import { validate } from "./schema";
import { ToolContext, ToolDef, ToolError } from "./types";

/** The call itself is malformed (unknown tool): a JSON-RPC -32602, not a tool result. */
export class UnknownToolError extends Error {}

export type ToolRegistry = {
  list(): McpToolDefinition[];
  call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<McpToolCallResult>;
};

export function createToolRegistry(tools: ToolDef[]): ToolRegistry {
  const byName = new Map<string, ToolDef>();
  for (const tool of tools) {
    if (byName.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    byName.set(tool.name, tool);
  }

  return {
    list: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: !t.write, destructiveHint: false },
      })),

    async call(name, args, ctx) {
      const tool = byName.get(name);
      if (!tool) throw new UnknownToolError(`Unknown tool: ${name}`);
      const problems = validate(tool.inputSchema, args);
      if (problems.length) return errorResult(`Invalid arguments: ${problems.join("; ")}`);
      try {
        return toResult(await tool.handler(args, ctx));
      } catch (e) {
        if (e instanceof ToolError) return errorResult(e.message);
        ctx.log(`tool ${name} failed: ${describe(e)}${e instanceof Error && e.stack ? `\n${e.stack}` : ""}`);
        return errorResult(`Internal error in ${name}: ${describe(e)}`);
      }
    },
  };
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorResult(text: string): McpToolCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

function toResult(value: unknown): McpToolCallResult {
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  const text = JSON.stringify(value ?? null, null, 2);
  const result: McpToolCallResult = { content: [{ type: "text", text }] };
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    result.structuredContent = value as Record<string, unknown>;
  }
  return result;
}
