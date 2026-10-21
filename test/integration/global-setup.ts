// Starts ONE headless Zotero for the integration run with build/addon + the dev-only eval plugin,
// waits for /safe-mcp, reads the token and hands { port, token } to the tests (inject("zotero")).
// Env: ZBASE (instance dir, default <repo>/.zotero-headless), ZPORT (default 23300),
//      ZOTERO_APP (existing extracted Zotero to symlink instead of `run-zotero-headless.sh install`),
//      KEEP_ZOTERO=1 to leave the instance running afterwards.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { rawRequest, zevalAt } from "./http";

declare module "vitest" {
  export interface ProvidedContext {
    zotero: { port: number; token: string };
  }
}

const root = join(__dirname, "..", "..");
const script = join(root, "scripts", "run-zotero-headless.sh");

export default async function setup(project: TestProject) {
  const ZBASE = process.env.ZBASE || join(root, ".zotero-headless");
  const ZPORT = process.env.ZPORT || "23300";
  if (!/^\d+$/.test(ZPORT)) throw new Error(`ZPORT must be a port number, got ${ZPORT}`);
  const port = Number(ZPORT);
  const env = { ...process.env, ZBASE, ZPORT, NO_PROXY: "*", no_proxy: "*" };
  const run = (...args: string[]) => execFileSync(script, args, { env, stdio: "inherit" });

  run("start", join(root, "build", "addon"), join(root, "test", "integration", "dev-eval-plugin"));

  // Plugins start a little after the HTTP server: wait until our endpoint stops being a 404.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const res = await rawRequest(port, "/safe-mcp", { headers: { "Content-Type": "application/json" }, body: "{}" });
    if (res.status !== 404) break;
    if (Date.now() > deadline) throw new Error("safe-mcp endpoint never appeared; see `scripts/run-zotero-headless.sh log`");
    await new Promise((r) => setTimeout(r, 250));
  }
  const token = await zevalAt(port, "return Zotero.Prefs.get('extensions.zotero-safe-mcp.token', true)");
  project.provide("zotero", { port, token });

  return () => {
    if (process.env.KEEP_ZOTERO !== "1") run("stop");
  };
}
