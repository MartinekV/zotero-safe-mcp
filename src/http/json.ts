// JSON bodies for the HTTP endpoints (protect(), /safe-mcp/pdf, /safe-mcp/image).
import type { HttpResponse } from "../registry/types";

export function jsonResponse(status: number, body: unknown, headers: Record<string, string | number> = {}): HttpResponse {
  return { status, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) };
}

/** `{ "error": message }` */
export function jsonError(status: number, error: string, headers: Record<string, string | number> = {}): HttpResponse {
  return jsonResponse(status, { error }, headers);
}
