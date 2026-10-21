// Checks applied to EVERY endpoint before its handler runs (see plugin.ts registerEndpoints):
//   1. any Origin header → 403 (a browser made this request; SPEC: Auth, second layer)
//   2. Authorization: Bearer <token> compared in constant time → 401 otherwise
//   3. handler exceptions → JSON 500 (Zotero would otherwise send a bodyless 500)
import { HttpHandler, HttpResponse } from "../registry/types";

export type ProtectOptions = {
  getToken(): string | undefined;
  log(message: string): void;
};

function jsonError(status: number, error: string, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ error }) };
}

/** Compares two strings without returning early on the first differing character. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  // Always walk the longer input so timing doesn't reveal where they differ.
  const len = Math.max(ea.length, eb.length);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

function bearerToken(header: string | undefined): string | undefined {
  const m = /^Bearer[ ]+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1] : undefined;
}

export function protect(handler: HttpHandler, opts: ProtectOptions): HttpHandler {
  return async (req) => {
    if (req.headers.origin != null) return jsonError(403, "Requests from web pages (with an Origin header) are not allowed");
    const expected = opts.getToken();
    const given = bearerToken(req.headers.authorization);
    if (!expected || given === undefined || !constantTimeEqual(given, expected)) {
      return jsonError(401, "Missing or invalid bearer token (see the Safe MCP pane in Zotero's settings)", {
        "WWW-Authenticate": "Bearer",
      });
    }
    try {
      return await handler(req);
    } catch (e) {
      opts.log(`${req.method} ${req.pathname} failed: ${e instanceof Error ? e.stack || e.message : String(e)}`);
      return jsonError(500, "Internal error");
    }
  };
}
