// POST /safe-mcp — the MCP endpoint. GET is accepted only to answer 405 (no SSE stream).
import { MCP_PATH } from "../config";
import { env } from "../env";
import { createMcpHandler } from "../mcp/handler";
import { prefWriteLimiter } from "../ownership/writeLimit";
import { EndpointDef, HttpHandler } from "../registry/types";
import tools from "../tools/index.generated";

let handler: HttpHandler | undefined;

const endpoint: EndpointDef = {
  path: MCP_PATH,
  methods: ["GET", "POST"],
  dataTypes: ["application/json"],
  handler: (req) => (handler ??= createMcpHandler({ tools, version: env.version, log: env.log, writeLimiter: prefWriteLimiter() }))(req),
};
export default endpoint;
