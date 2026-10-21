import { describe, it, expect } from "vitest";
import { protect, constantTimeEqual } from "../../src/http/protect";
import { HttpRequest, HttpResponse } from "../../src/registry/types";

const TOKEN = "a".repeat(64);

function req(headers: Record<string, string>): HttpRequest {
  return { method: "POST", pathname: "/safe-mcp", headers, data: {} };
}

const ok = async (): Promise<HttpResponse> => ({ status: 200, body: "inner" });

function guarded(inner = ok, token: string | undefined = TOKEN) {
  return protect(inner, { getToken: () => token, log: () => {} });
}

describe("protect (applied to every endpoint)", () => {
  it("passes a request with the right bearer token to the endpoint", async () => {
    const res = await guarded()(req({ authorization: `Bearer ${TOKEN}` }));
    expect(res).toEqual({ status: 200, body: "inner" });
  });

  it.each([
    ["no Authorization header", {}],
    ["a wrong token", { authorization: `Bearer ${"b".repeat(64)}` }],
    ["a token prefix", { authorization: `Bearer ${TOKEN.slice(0, 10)}` }],
    ["the token without the Bearer scheme", { authorization: TOKEN }],
    ["Basic auth", { authorization: `Basic ${TOKEN}` }],
    ["an empty bearer", { authorization: "Bearer " }],
  ])("rejects %s with 401 without calling the endpoint", async (_label, headers) => {
    let called = false;
    const res = await guarded(async () => { called = true; return { status: 200 }; })(req(headers));
    expect(res.status).toBe(401);
    expect(res.headers?.["WWW-Authenticate"]).toBe("Bearer");
    expect(JSON.parse(res.body!).error).toMatch(/token/i);
    expect(called).toBe(false);
  });

  it("accepts a case-insensitive Bearer scheme", async () => {
    const res = await guarded()(req({ authorization: `bearer ${TOKEN}` }));
    expect(res.status).toBe(200);
  });

  it("rejects every request when no token is configured", async () => {
    const res = await guarded(ok, "")(req({ authorization: "Bearer " }));
    expect(res.status).toBe(401);
  });

  it("rejects a request with an Origin header with 403, even with the right token", async () => {
    let called = false;
    const res = await guarded(async () => { called = true; return { status: 200 }; })(
      req({ authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it("rejects an Origin header even when it is empty or 'null'", async () => {
    for (const origin of ["", "null"]) {
      const res = await guarded()(req({ authorization: `Bearer ${TOKEN}`, origin }));
      expect(res.status).toBe(403);
    }
  });

  it("turns an endpoint exception into a JSON 500 instead of a bodyless one", async () => {
    const res = await guarded(async () => { throw new Error("boom"); })(req({ authorization: `Bearer ${TOKEN}` }));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body!).error).toMatch(/internal/i);
  });
});

describe("constantTimeEqual", () => {
  it("is true only for identical strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
    expect(constantTimeEqual("é", "é")).toBe(false);
  });
});
