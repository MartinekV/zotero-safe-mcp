import { describe, it, expect, beforeEach } from "vitest";
import { createPlugin } from "../../src/plugin";
import { PLUGIN_ID, TOKEN_PREF } from "../../src/config";
import { EndpointDef, LifecycleHook } from "../../src/registry/types";

/** Just enough of the Zotero global for the plugin lifecycle. */
function fakeZotero() {
  const prefs = new Map<string, unknown>();
  const panes: Record<string, unknown> = {};
  return {
    prefs,
    panes,
    debug: (_m: string) => {},
    Prefs: {
      get: (name: string, global?: boolean) => (global ? prefs.get(name) : prefs.get(`extensions.zotero.${name}`)),
      set: (name: string, value: unknown, global?: boolean) => {
        prefs.set(global ? name : `extensions.zotero.${name}`, value);
      },
    },
    Server: {
      Endpoints: { "/connector/ping": class Ping {} } as Record<string, any>,
      responseCodes: { 200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" } as Record<number, string>,
    },
    PreferencePanes: {
      register: async (opts: { pluginID: string; src: string }) => {
        const id = `pane-${Object.keys(panes).length}`;
        panes[id] = opts;
        return id;
      },
      unregister: (id: string) => {
        delete panes[id];
      },
    },
  };
}

const echoEndpoint: EndpointDef = {
  path: "/safe-mcp/echo/:key",
  methods: ["POST"],
  dataTypes: ["application/json"],
  handler: async (req) => ({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.pathParams) }),
};

const info = { id: PLUGIN_ID, version: "1.2.3", rootURI: "file:///plugin/" };

let Z: ReturnType<typeof fakeZotero>;
beforeEach(() => {
  Z = fakeZotero();
});

function plugin(opts: { endpoints?: EndpointDef[]; hooks?: LifecycleHook[] } = {}) {
  return createPlugin({ zotero: Z as any, endpoints: opts.endpoints ?? [echoEndpoint], hooks: opts.hooks ?? [] });
}

async function send(path: string, headers: Record<string, string>, data: unknown = {}) {
  const Endpoint = Z.Server.Endpoints[path];
  const endpoint = new Endpoint();
  expect(endpoint.init.length).toBe(1); // Zotero picks the request-object form by arity
  return endpoint.init({ method: "POST", pathname: path, pathParams: { key: "ABCD1234" }, headers, data });
}

describe("plugin lifecycle", () => {
  it("generates a random token on first startup and keeps it on later startups", async () => {
    await plugin().startup(info);
    const token = Z.prefs.get(TOKEN_PREF) as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await plugin().shutdown();

    await plugin().startup(info);
    expect(Z.prefs.get(TOKEN_PREF)).toBe(token);

    const other = fakeZotero();
    await createPlugin({ zotero: other as any, endpoints: [], hooks: [] }).startup(info);
    expect(other.prefs.get(TOKEN_PREF)).not.toBe(token);
  });

  it("registers endpoints that answer authorised requests with Zotero's response tuple", async () => {
    await plugin().startup(info);
    expect(new Z.Server.Endpoints["/safe-mcp/echo/:key"]().supportedMethods).toEqual(["POST"]);
    const token = Z.prefs.get(TOKEN_PREF);
    const [status, headers, body] = await send("/safe-mcp/echo/:key", { authorization: `Bearer ${token}` });
    expect(status).toBe(200);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(body)).toEqual({ key: "ABCD1234" });
  });

  it("does not opt endpoints into browser requests", async () => {
    await plugin().startup(info);
    const endpoint = new Z.Server.Endpoints["/safe-mcp/echo/:key"]();
    expect(endpoint.allowRequestsFromUnsafeWebContent).toBeFalsy();
    expect(endpoint.supportedDataTypes).toEqual(["application/json"]);
  });

  it("protects every registered endpoint with the token and Origin checks", async () => {
    await plugin().startup(info);
    const token = Z.prefs.get(TOKEN_PREF);
    const [noAuth] = await send("/safe-mcp/echo/:key", {});
    expect(noAuth).toBe(401);
    const [withOrigin] = await send("/safe-mcp/echo/:key", { authorization: `Bearer ${token}`, origin: "https://x.example" });
    expect(withOrigin).toBe(403);
  });

  it("registers the MCP endpoint by default", async () => {
    await createPlugin({ zotero: Z as any }).startup(info);
    const token = Z.prefs.get(TOKEN_PREF);
    const [status, , body] = await send("/safe-mcp", { authorization: `Bearer ${token}` }, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("unregisters its endpoints on shutdown and leaves Zotero's alone", async () => {
    const p = plugin();
    await p.startup(info);
    await p.shutdown();
    expect(Object.keys(Z.Server.Endpoints)).toEqual(["/connector/ping"]);
  });

  it("does not delete an endpoint another plugin re-registered at the same path", async () => {
    const p = plugin();
    await p.startup(info);
    class Theirs {}
    Z.Server.Endpoints["/safe-mcp/echo/:key"] = Theirs;
    await p.shutdown();
    expect(Z.Server.Endpoints["/safe-mcp/echo/:key"]).toBe(Theirs);
  });

  it("adds missing HTTP reason phrases while running and removes only those on shutdown", async () => {
    const p = plugin();
    await p.startup(info);
    expect(Z.Server.responseCodes[401]).toBe("Unauthorized");
    expect(Z.Server.responseCodes[202]).toBe("Accepted");
    expect(Z.Server.responseCodes[405]).toBe("Method Not Allowed");
    expect(Z.Server.responseCodes[413]).toBe("Payload Too Large");
    expect(Z.Server.responseCodes[429]).toBe("Too Many Requests");
    await p.shutdown();
    expect(Z.Server.responseCodes).toEqual({ 200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 500: "Internal Server Error" });
  });

  it("registers the settings pane for this plugin and unregisters it on shutdown", async () => {
    const p = plugin();
    await p.startup(info);
    expect(Object.values(Z.panes)).toEqual([expect.objectContaining({ pluginID: PLUGIN_ID, src: "prefs.xhtml" })]);
    await p.shutdown();
    expect(Z.panes).toEqual({});
  });

  it("runs hooks at startup in order and at shutdown in reverse, even if one fails", async () => {
    const calls: string[] = [];
    const hook = (name: string, failShutdown = false): LifecycleHook => ({
      name,
      startup: () => { calls.push(`start ${name}`); },
      shutdown: () => { calls.push(`stop ${name}`); if (failShutdown) throw new Error("x"); },
    });
    const p = plugin({ hooks: [hook("a"), hook("b", true)] });
    await p.startup(info);
    await p.shutdown();
    expect(calls).toEqual(["start a", "start b", "stop b", "stop a"]);
  });

  it("shutdown is idempotent and safe before startup", async () => {
    const p = plugin();
    await p.shutdown();
    await p.startup(info);
    await p.shutdown();
    await p.shutdown();
    expect(Object.keys(Z.Server.Endpoints)).toEqual(["/connector/ping"]);
  });
});
