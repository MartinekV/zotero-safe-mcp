// A real SQLite (node:sqlite, in memory) behind the small Zotero.DB surface the change log uses,
// with the plugin's database attached as `safemcp` like in Zotero.
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../../src/changes/types";

export function sqliteDb(): Db & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("ATTACH DATABASE ':memory:' AS safemcp");
  let inTx = false;
  return {
    raw,
    async queryAsync(sql: string, params: unknown[] = []) {
      const stmt = raw.prepare(sql);
      if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return stmt.all(...(params as any[])) as any[];
      stmt.run(...(params as any[]));
      return [];
    },
    async executeTransaction<T>(fn: () => Promise<T>): Promise<T> {
      if (inTx) throw new Error("nested transaction (would deadlock in Zotero)");
      inTx = true;
      raw.exec("BEGIN");
      try {
        const result = await fn();
        raw.exec("COMMIT");
        return result;
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      } finally {
        inTx = false;
      }
    },
  };
}
