import { describe, it, expect } from "vitest";
import { mcp, mcpRaw, request, zeval } from "./harness";

describe("POST /safe-mcp in a real Zotero", () => {
  it("initializes", async () => {
    const result = await mcp("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "itest", version: "0" },
    });
    expect(result.serverInfo.name).toBe("zotero-safe-mcp");
    expect(result.protocolVersion).toBe("2025-06-18");
  });

  it("acknowledges notifications/initialized with 202 and no body", async () => {
    const res = await mcpRaw({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.status).toBe(202);
    expect(res.statusText).toBe("Accepted");
    expect(res.body).toBe("");
  });

  it("lists tools and answers ping", async () => {
    expect(Array.isArray((await mcp("tools/list")).tools)).toBe(true);
    expect(await mcp("ping")).toEqual({});
  });

  it("rejects requests without the token with 401 Unauthorized", async () => {
    const res = await mcpRaw({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: null });
    expect(res.status).toBe(401);
    expect(res.statusText).toBe("Unauthorized");
    const wrong = await mcpRaw({ jsonrpc: "2.0", id: 1, method: "ping" }, { token: "0".repeat(64) });
    expect(wrong.status).toBe(401);
  });

  it("never serves a request carrying an Origin header", async () => {
    const res = await mcpRaw({ jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { Origin: "https://evil.example" } });
    // Zotero's own browser guard drops the connection before our 403 check is reached.
    expect(res.answered === false || res.status === 403).toBe(true);
  });

  it("answers GET with 405", async () => {
    const res = await request("/safe-mcp");
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe("POST");
  });

  it("unregisters its endpoints when disabled and restores them when enabled", async () => {
    const toggle = (enable: boolean) =>
      zeval(`
        const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
        const addon = await AddonManager.getAddonByID("zotero-safe-mcp@martinekv.github.io");
        await addon.${enable ? "enable" : "disable"}();
        return Object.keys(Zotero.Server.Endpoints).filter((p) => p.startsWith("/safe-mcp") && !p.startsWith("/safe-mcp-test"));
      `);
    expect(await toggle(false)).toEqual([]);
    expect((await mcpRaw({ jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
    expect(await toggle(true)).toContain("/safe-mcp");
    expect(await mcp("ping")).toEqual({});
  });
});
