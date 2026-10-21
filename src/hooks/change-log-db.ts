// Attaches <Zotero data dir>/safe-mcp.sqlite to Zotero.DB as `safemcp` (exploration note
// 03-persistence.md, option B: same pattern as Zotero's full-text index) and creates the change-log
// tables. Re-attaches when Zotero reopens its connection; detaches on shutdown.
import { changeLog } from "../changes";
import { SCHEMA } from "../changes/changeLog";
import { LifecycleHook } from "../registry/types";

export const DB_NAME = "safe-mcp";

let onConnect: (() => Promise<void>) | undefined;

async function attach(): Promise<void> {
  const db = Zotero.DB as any;
  const attached = (await db.queryAsync("PRAGMA database_list")).some((r: any) => r.name === SCHEMA);
  if (!attached) await db.queryAsync(`ATTACH DATABASE ? AS ${SCHEMA}`, [(Zotero.DataDirectory as any).getDatabase(DB_NAME)]);
  await changeLog().ensureSchema();
}

const hook: LifecycleHook = {
  name: "change-log-db",
  async startup() {
    const db = (globalThis as any).Zotero?.DB;
    if (!db) return; // unit tests' fake Zotero
    await attach();
    onConnect = attach;
    db.onConnect(onConnect); // not called for the already-open connection, hence attach() above
  },
  async shutdown() {
    const db = (globalThis as any).Zotero?.DB;
    if (!db || !onConnect) return;
    // There is no offConnect(); remove ours from the private array.
    const cbs: unknown[] = db._onConnectCallbacks ?? [];
    const i = cbs.indexOf(onConnect);
    if (i !== -1) cbs.splice(i, 1);
    onConnect = undefined;
    try {
      await db.queryAsync(`DETACH DATABASE ${SCHEMA}`);
    } catch (e) {
      // Fails inside a transaction or after Zotero closed the DB on quit; harmless.
      Zotero.debug(`[safe-mcp] DETACH ${SCHEMA} failed: ${e}`);
    }
  },
};
export default hook;
