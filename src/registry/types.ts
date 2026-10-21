// Shared shapes for everything that plugs into the plugin: tools, HTTP endpoints, lifecycle hooks.
// Files in src/tools, src/endpoints and src/hooks default-export one of these (see CONTRIBUTING.md).

/** A JSON Schema object (the subset understood by ./schema.ts). */
export type JsonSchema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
};

export type ToolContext = {
  /** Log to Zotero's debug output (prefixed with the plugin name). */
  log(message: string): void;
};

export type ToolDef<Args = any> = {
  /** snake_case MCP tool name, e.g. `search_library`. */
  name: string;
  description: string;
  /** JSON Schema for the arguments; must be `type: "object"`. Arguments are validated before `handler` runs. */
  inputSchema: JsonSchema & { type: "object" };
  /** true for tools that change the library (rate-limited, ownership-checked). */
  write: boolean;
  /**
   * Returns any JSON-serialisable value (sent as text + structuredContent when it is an object).
   * Throw `ToolError` for an expected failure; any other exception is also turned into an
   * `isError` result, never a JSON-RPC error.
   */
  handler(args: Args, ctx: ToolContext): unknown | Promise<unknown>;
};

/** An expected tool failure with a message meant for the agent. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

/** Identity helper that gives tool files type inference for `args`. */
export function defineTool<Args>(def: ToolDef<Args>): ToolDef<Args> {
  return def;
}

/** The request object Zotero passes to single-argument endpoint `init(req)`. */
export type HttpRequest = {
  method: string;
  pathname: string;
  pathParams?: Record<string, string>;
  searchParams?: URLSearchParams;
  /** Lower-case header names. */
  headers: Record<string, string | undefined>;
  /** Parsed JSON object for application/json, string for text/plain, nsIInputStream for other types, else null. */
  data: unknown;
};

export type HttpResponse = {
  status: number;
  headers?: Record<string, string | number>;
  body?: string;
  /** Passed through as the 4th element of Zotero's response tuple (e.g. `{ logFilter }`). */
  options?: Record<string, unknown>;
};

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

export type EndpointDef = {
  /** Path, may contain `:param` segments (e.g. `/safe-mcp/pdf/:key`). */
  path: string;
  /** HTTP methods Zotero lets through to the handler. */
  methods: string[];
  /** Accepted request Content-Types (Zotero answers 400 for others), or "*". */
  dataTypes: string[] | "*";
  /** Called only after the Origin and bearer-token checks passed. */
  handler: HttpHandler;
};

export type LifecycleHook = {
  name: string;
  /** Runs at plugin startup, after the token exists and before endpoints are registered. */
  startup?(): void | Promise<void>;
  /** Runs at plugin shutdown (also on app quit), in reverse order. Must be idempotent. */
  shutdown?(): void | Promise<void>;
};
