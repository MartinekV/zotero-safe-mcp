// Helpers for integration tests: talk to the plugin exactly like the agent does.
import { inject } from "vitest";
import { rawRequest, RawResponse, zevalAt } from "./http";

export { type RawResponse } from "./http";

export function zotero() {
  return inject("zotero");
}

/** Any HTTP request to the headless Zotero. Adds the bearer token unless `token: null`. */
export function request(
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; token?: string | null } = {},
): Promise<RawResponse> {
  const { port, token } = zotero();
  const headers: Record<string, string> = { ...opts.headers };
  const t = opts.token === undefined ? token : opts.token;
  if (t !== null) headers.Authorization = `Bearer ${t}`;
  return rawRequest(port, path, { method: opts.method, headers, body: opts.body });
}

let nextId = 1;

/** POSTs one JSON-RPC message to /safe-mcp. Returns the HTTP response and the parsed body (if any). */
export async function mcpRaw(message: unknown, opts: { token?: string | null; headers?: Record<string, string> } = {}) {
  const res = await request("/safe-mcp", {
    ...opts,
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...opts.headers },
    body: JSON.stringify(message),
  });
  let json: any;
  if (res.body && /json/.test(String(res.headers["content-type"]))) json = JSON.parse(res.body);
  return { ...res, json };
}

/** Calls an MCP method and returns `result`; throws on a JSON-RPC error. */
export async function mcp(method: string, params?: unknown): Promise<any> {
  const res = await mcpRaw({ jsonrpc: "2.0", id: nextId++, method, params });
  if (res.status !== 200 || !res.json) throw new Error(`MCP ${method}: HTTP ${res.status} ${res.body}`);
  if (res.json.error) throw new Error(`MCP ${method}: ${JSON.stringify(res.json.error)}`);
  return res.json.result;
}

/** Calls a tool; returns the MCP tool result ({ content, structuredContent?, isError? }). */
export function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  return mcp("tools/call", { name, arguments: args });
}

/** Runs JS inside Zotero (dev-only eval plugin). `code` is an async function body; `Zotero` is in scope. */
export function zeval(code: string): Promise<any> {
  return zevalAt(zotero().port, code);
}

/**
 * Disables or enables the plugin. `addon.enable()` does not wait for the plugin's async startup
 * (hooks run before endpoints are registered), so this waits until /safe-mcp is registered again.
 */
export async function setPluginEnabled(enable: boolean): Promise<void> {
  await zeval(`
    const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
    const addon = await AddonManager.getAddonByID("zotero-safe-mcp@martinekv.github.io");
    await addon.${enable ? "enable" : "disable"}();
    if (${enable}) {
      for (let i = 0; i < 200 && !Zotero.Server.Endpoints["/safe-mcp"]; i++) await Zotero.Promise.delay(25);
    }
  `);
}
