// POST /safe-mcp: MCP over Streamable HTTP, JSON responses only, stateless.
// Batches are rejected (removed from MCP in 2025-06-18). Tool failures are results with
// isError (see registry/tools.ts); only malformed calls get JSON-RPC errors.
import { PLUGIN_NAME } from "../config";
import type { RateLimiter } from "../ownership/rateLimit";
import { createToolRegistry, UnknownToolError } from "../registry/tools";
import { HttpHandler, HttpResponse, ToolDef } from "../registry/types";
import { errorDetail } from "../util/errors";
import { isPlainObject } from "../util/isPlainObject";
import { JsonRpcId, JsonRpcResponse, makeError, makeResult, RPC_ERRORS, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol";

export type McpHandlerOptions = {
  tools: ToolDef[];
  version: string;
  log(message: string): void;
  /** Caps write tool calls (SPEC: Rate limit). */
  writeLimiter?: RateLimiter;
};

class InvalidParams extends Error {}

function json(status: number, message: JsonRpcResponse): HttpResponse {
  return { status, headers: { "Content-Type": "application/json" }, body: JSON.stringify(message) };
}

function invalidRequest(detail?: string): HttpResponse {
  return json(400, makeError(null, RPC_ERRORS.INVALID_REQUEST, detail ? `Invalid Request: ${detail}` : "Invalid Request"));
}


function isValidId(v: unknown): boolean {
  return v === null || typeof v === "string" || (typeof v === "number" && Number.isFinite(v));
}

export function createMcpHandler(opts: McpHandlerOptions): HttpHandler {
  const registry = createToolRegistry(opts.tools, { writeLimiter: opts.writeLimiter });
  const ctx = { log: opts.log };

  const methods: Record<string, (params: unknown) => unknown> = {
    initialize: (params) => {
      const requested = isPlainObject(params) ? params.protocolVersion : undefined;
      return {
        protocolVersion:
          typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : SUPPORTED_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: PLUGIN_NAME, version: opts.version },
      };
    },
    ping: () => ({}),
    "tools/list": () => ({ tools: registry.list() }),
    "tools/call": (params) => {
      if (!isPlainObject(params) || typeof params.name !== "string") {
        throw new InvalidParams("tools/call requires params { name, arguments }");
      }
      const args = params.arguments ?? {};
      if (!isPlainObject(args)) throw new InvalidParams("tools/call arguments must be an object");
      return registry.call(params.name, args, ctx);
    },
  };

  return async (req) => {
    if (req.method !== "POST") return { status: 405, headers: { Allow: "POST" } };
    const msg = req.data;
    if (Array.isArray(msg)) return invalidRequest("JSON-RPC batches are not supported");
    if (!isPlainObject(msg) || msg.jsonrpc !== "2.0") return invalidRequest();
    if ("id" in msg && !isValidId(msg.id)) return invalidRequest("id must be a string, number or null");
    // A response or error the client sends back to us: nothing to do.
    if (!("method" in msg) && ("result" in msg || "error" in msg)) return { status: 202 };
    if (typeof msg.method !== "string") return invalidRequest("method must be a string");

    // Notifications (no id) are acknowledged without a body; we act on none of them.
    if (!("id" in msg)) return { status: 202 };
    const id = msg.id as JsonRpcId;

    const method = Object.hasOwn(methods, msg.method) ? methods[msg.method] : undefined;
    if (!method) return json(200, makeError(id, RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${msg.method}`));
    try {
      return json(200, makeResult(id, await method(msg.params)));
    } catch (e) {
      if (e instanceof InvalidParams || e instanceof UnknownToolError) {
        return json(200, makeError(id, RPC_ERRORS.INVALID_PARAMS, e.message));
      }
      opts.log(`MCP ${msg.method} failed: ${errorDetail(e)}`);
      return json(200, makeError(id, RPC_ERRORS.INTERNAL_ERROR, "Internal error"));
    }
  };
}
