// Raw HTTP client for the headless Zotero. Uses node:http directly so no proxy env var can ever
// route a test request anywhere but 127.0.0.1.
import { request as httpRequest } from "node:http";

export type RawResponse = {
  /** false when Zotero closed the connection without answering (its browser/CSRF guard). */
  answered: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export function rawRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body, "utf8");
    const headers: Record<string, string | number> = { "User-Agent": "safe-mcp-integration-test", ...opts.headers };
    if (body) headers["Content-Length"] = body.length;
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: opts.method ?? (body ? "POST" : "GET"), headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            answered: true,
            status: res.statusCode ?? 0,
            statusText: res.statusMessage ?? "",
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNRESET" || /socket hang up/.test(e.message)) {
        resolve({ answered: false, status: 0, statusText: "", headers: {}, body: "" });
      } else reject(e);
    });
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout: ${path}`)));
    req.end(body);
  });
}

/** Runs JS inside Zotero via the dev-only eval plugin; `code` is an async function body with Zotero in scope. */
export async function zevalAt(port: number, code: string): Promise<any> {
  const res = await rawRequest(port, "/safe-mcp-test/eval", { headers: { "Content-Type": "text/plain" }, body: code });
  if (res.status !== 200) throw new Error(`zeval failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body);
}
