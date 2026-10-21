// The change log and ownership registry (SPEC: Storage, Hard rule 1). Tables live in the
// plugin's own SQLite file, attached to Zotero.DB as `safemcp` (hooks/change-log-db.ts), so a
// Zotero save and its ownership/change rows commit or roll back together.
import { ToolError } from "../registry/types";
import type {
  ChangeRecord,
  ChangeSummary,
  ChangeWriter,
  Db,
  NoteVersion,
  OwnedObject,
  OwnedTag,
  UndoHandler,
} from "./types";

export const SCHEMA = "safemcp";
const SCHEMA_VERSION = 1;

const DDL = [
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.changes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     changeId TEXT NOT NULL UNIQUE,
     tool TEXT NOT NULL,
     kind TEXT NOT NULL,
     args TEXT NOT NULL,
     data TEXT,
     summary TEXT NOT NULL,
     createdAt INTEGER NOT NULL,
     undone INTEGER NOT NULL DEFAULT 0,
     undoneAt INTEGER)`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.owned_objects (
     libraryID INTEGER NOT NULL,
     itemKey TEXT NOT NULL,
     kind TEXT NOT NULL,
     changeId TEXT NOT NULL,
     createdAt INTEGER NOT NULL,
     PRIMARY KEY (libraryID, itemKey))`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.owned_tags (
     libraryID INTEGER NOT NULL,
     itemKey TEXT NOT NULL,
     tag TEXT NOT NULL,
     changeId TEXT NOT NULL,
     createdAt INTEGER NOT NULL,
     PRIMARY KEY (libraryID, itemKey, tag))`,
  `CREATE TABLE IF NOT EXISTS ${SCHEMA}.note_versions (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     libraryID INTEGER NOT NULL,
     noteKey TEXT NOT NULL,
     html TEXT NOT NULL,
     changeId TEXT NOT NULL,
     savedAt INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ${SCHEMA}.owned_objects_change ON owned_objects (changeId)`,
  `CREATE INDEX IF NOT EXISTS ${SCHEMA}.note_versions_note ON note_versions (libraryID, noteKey)`,
];

export type ChangeLogOptions = {
  db: Db;
  undoHandlers?: UndoHandler[];
  now?(): number;
  newId?(): string;
  log?(message: string): void;
};

export type WriteSpec = {
  tool: string;
  /** The tool's validated arguments (stored as JSON). */
  args: unknown;
  /** Undo handler to use; defaults to `tool`. */
  kind?: string;
};

export type ChangeLog = ReturnType<typeof createChangeLog>;

/** `chg_` + 8 characters from Zotero's key alphabet. */
export function newChangeId(): string {
  const alphabet = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return "chg_" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function createChangeLog(opts: ChangeLogOptions) {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? newChangeId;
  const log = opts.log ?? (() => {});
  const handlers = new Map<string, UndoHandler>();
  for (const h of opts.undoHandlers ?? []) {
    if (handlers.has(h.kind)) throw new Error(`Two undo handlers for kind ${h.kind}`);
    handlers.set(h.kind, h);
  }

  const q = (sql: string, params: unknown[] = []) => db.queryAsync(sql, params);

  async function get(changeId: string): Promise<ChangeRecord | null> {
    const [row] = await q(`SELECT * FROM ${SCHEMA}.changes WHERE changeId = ?`, [changeId]);
    if (!row) return null;
    const objects = await q(`SELECT libraryID, itemKey, kind FROM ${SCHEMA}.owned_objects WHERE changeId = ? ORDER BY rowid`, [changeId]);
    const tags = await q(`SELECT libraryID, itemKey, tag FROM ${SCHEMA}.owned_tags WHERE changeId = ? ORDER BY rowid`, [changeId]);
    const versions = await q(`SELECT libraryID, noteKey, html FROM ${SCHEMA}.note_versions WHERE changeId = ? ORDER BY seq`, [changeId]);
    return {
      ...summaryOf(row),
      kind: row.kind,
      args: JSON.parse(row.args),
      data: row.data == null ? null : JSON.parse(row.data),
      objects: objects.map((r): OwnedObject => ({ libraryID: r.libraryID, itemKey: r.itemKey, kind: r.kind })),
      tags: tags.map((r): OwnedTag => ({ libraryID: r.libraryID, itemKey: r.itemKey, tag: r.tag })),
      noteVersions: versions.map((r): NoteVersion => ({ libraryID: r.libraryID, noteKey: r.noteKey, html: r.html })),
    };
  }

  return {
    /** Creates the tables if needed. Call after the plugin's DB is attached. */
    async ensureSchema() {
      for (const sql of DDL) await q(sql);
      await q(`PRAGMA ${SCHEMA}.user_version = ${SCHEMA_VERSION}`);
    },

    /**
     * THE way to change the library: runs `body` and records the change (log row, owned objects
     * and tags, note versions) in ONE DB transaction. Inside `body`, save with `item.save()`, never
     * `saveTx()`. A throw rolls back the Zotero changes and records nothing.
     * (Rate limiting and serialisation happen earlier, in the tool registry.)
     */
    async recordWrite<T>(spec: WriteSpec, body: (w: ChangeWriter) => Promise<T>): Promise<{ changeId: string; result: T }> {
      const changeId = newId();
      const objects: OwnedObject[] = [];
      const tags: OwnedTag[] = [];
      const disowned: OwnedTag[] = [];
      const versions: NoteVersion[] = [];
      const w: ChangeWriter = {
        changeId,
        summary: spec.tool,
        data: null,
        ownObject: (o) => void objects.push({ ...o }),
        ownTag: (t) => void tags.push({ ...t }),
        disownTag: (t) => void disowned.push({ ...t }),
        saveNoteVersion: (v) => void versions.push({ ...v }),
      };
      const result = await db.executeTransaction(async () => {
        const result = await body(w);
        const t = now();
        await q(
          `INSERT INTO ${SCHEMA}.changes (changeId, tool, kind, args, data, summary, createdAt) VALUES (?,?,?,?,?,?,?)`,
          [changeId, spec.tool, spec.kind ?? spec.tool, JSON.stringify(spec.args ?? null), w.data == null ? null : JSON.stringify(w.data), w.summary || spec.tool, t],
        );
        for (const o of objects) {
          await q(`INSERT INTO ${SCHEMA}.owned_objects VALUES (?,?,?,?,?)`, [o.libraryID, o.itemKey, o.kind, changeId, t]);
        }
        for (const d of disowned) await disownTag(d);
        for (const g of tags) {
          await q(`INSERT OR REPLACE INTO ${SCHEMA}.owned_tags VALUES (?,?,?,?,?)`, [g.libraryID, g.itemKey, g.tag, changeId, t]);
        }
        for (const v of versions) {
          await q(`INSERT INTO ${SCHEMA}.note_versions (libraryID, noteKey, html, changeId, savedAt) VALUES (?,?,?,?,?)`, [
            v.libraryID, v.noteKey, v.html, changeId, t,
          ]);
        }
        return result;
      });
      return { changeId, result };
    },

    /**
     * Reverses one change (default: the newest one not yet undone) through the undo handler for
     * its kind, and marks it undone, in one transaction. Undo itself is not a new change.
     */
    async undo(changeId?: string): Promise<{ changeId: string; tool: string; summary: string }> {
      return db.executeTransaction(async () => {
        let id = changeId;
        if (id === undefined) {
          const [row] = await q(`SELECT changeId FROM ${SCHEMA}.changes WHERE undone = 0 ORDER BY seq DESC LIMIT 1`);
          if (!row) throw new ToolError("Nothing to undo: every change is already undone.");
          id = row.changeId as string;
        }
        const change = await get(id);
        if (!change) throw new ToolError(`No change ${id} (see list_changes).`);
        if (change.undone) throw new ToolError(`Change ${id} (${change.summary}) is already undone.`);
        const handler = handlers.get(change.kind);
        if (!handler) throw new ToolError(`Change ${id} (${change.tool}) cannot be undone.`);
        const summary = await handler.undo(change, { db, disownTag, log });
        await q(`UPDATE ${SCHEMA}.changes SET undone = 1, undoneAt = ? WHERE changeId = ?`, [now(), id]);
        return { changeId: id, tool: change.tool, summary };
      });
    },

    get,

    /**
     * Records objects created after `changeId` was recorded (e.g. import_paper's attachments that
     * finished downloading later) as owned by that change, so its undo covers them. Use only for
     * objects saved by Zotero code that opens its own transactions; everything else goes through
     * recordWrite. `undone: true` means the change was undone meanwhile: the caller should then
     * trash the late objects itself (they are still recorded, so they stay editable).
     */
    async addObjects(changeId: string, objects: readonly OwnedObject[]): Promise<{ undone: boolean }> {
      return db.executeTransaction(async () => {
        const [row] = await q(`SELECT undone FROM ${SCHEMA}.changes WHERE changeId = ?`, [changeId]);
        if (!row) throw new Error(`addObjects: no change ${changeId}`);
        const t = now();
        for (const o of objects) {
          await q(`INSERT OR IGNORE INTO ${SCHEMA}.owned_objects VALUES (?,?,?,?,?)`, [o.libraryID, o.itemKey, o.kind, changeId, t]);
        }
        return { undone: row.undone === 1 };
      });
    },

    /** Newest first. */
    async list(limit: number): Promise<ChangeSummary[]> {
      const rows = await q(`SELECT * FROM ${SCHEMA}.changes ORDER BY seq DESC LIMIT ?`, [limit]);
      return rows.map(summaryOf);
    },

    async isOwned(libraryID: number, itemKey: string): Promise<boolean> {
      const rows = await q(`SELECT 1 AS x FROM ${SCHEMA}.owned_objects WHERE libraryID = ? AND itemKey = ?`, [libraryID, itemKey]);
      return rows.length > 0;
    },

    /** The subset of `keys` the plugin created. */
    async ownedKeys(libraryID: number, keys: readonly string[]): Promise<Set<string>> {
      const out = new Set<string>();
      for (let i = 0; i < keys.length; i += 500) {
        const chunk = keys.slice(i, i + 500);
        const rows = await q(
          `SELECT itemKey FROM ${SCHEMA}.owned_objects WHERE libraryID = ? AND itemKey IN (${chunk.map(() => "?").join(",")})`,
          [libraryID, ...chunk],
        );
        for (const r of rows) out.add(r.itemKey);
      }
      return out;
    },

    /** Tags on this item that the plugin added. */
    async ownedTags(libraryID: number, itemKey: string): Promise<Set<string>> {
      const rows = await q(`SELECT tag FROM ${SCHEMA}.owned_tags WHERE libraryID = ? AND itemKey = ?`, [libraryID, itemKey]);
      return new Set(rows.map((r) => r.tag as string));
    },
  };

  async function disownTag(t: OwnedTag): Promise<void> {
    await q(`DELETE FROM ${SCHEMA}.owned_tags WHERE libraryID = ? AND itemKey = ? AND tag = ?`, [t.libraryID, t.itemKey, t.tag]);
  }
}

function summaryOf(row: any): ChangeSummary {
  return {
    changeId: row.changeId,
    tool: row.tool,
    summary: row.summary,
    createdAt: new Date(row.createdAt).toISOString(),
    undone: row.undone === 1,
  };
}
