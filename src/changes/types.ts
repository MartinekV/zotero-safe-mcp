// Shapes of the change log / ownership registry (SPEC: Storage), shared by every write tool and
// undo handler. See CONTRIBUTING.md "Adding a write tool".

/** The part of Zotero.DB (Zotero.DBConnection) the change log uses. */
export type Db = {
  /** Rows of a SELECT (column values readable as properties); nothing useful for other statements. */
  queryAsync(sql: string, params?: unknown[]): Promise<any[]>;
  /** Runs `fn` in one transaction; a throw rolls everything back. Never nest. */
  executeTransaction<T>(fn: () => Promise<T>): Promise<T>;
};

/** An object the plugin created (note, highlight, imported paper, attachment, embedded image …). */
export type OwnedObject = { libraryID: number; itemKey: string; kind: string };
/** An (item, tag) pair the plugin added; pairs that existed before are never recorded. */
export type OwnedTag = { libraryID: number; itemKey: string; tag: string };
/** A note's HTML as it was before a change (for undo of edit_note). */
export type NoteVersion = { libraryID: number; noteKey: string; html: string };

/** The HTML the agent last wrote into a note, and whether the user has since taken the note over. */
export type AgentNote = { html: string; userEdited: boolean };

/** One row of list_changes. */
export type ChangeSummary = {
  changeId: string;
  tool: string;
  summary: string;
  createdAt: string;
  undone: boolean;
};

/** Everything recorded with a change, as undo handlers get it. */
export type ChangeRecord = ChangeSummary & {
  /** Selects the undo handler. Defaults to the tool name. */
  kind: string;
  /** The tool's arguments as validated. */
  args: unknown;
  /** Whatever the tool stored with `w.data` (JSON), or null. */
  data: unknown;
  objects: OwnedObject[];
  tags: OwnedTag[];
  noteVersions: NoteVersion[];
};

/**
 * Given to a write's body by `recordWrite`. Everything recorded here is written in the same DB
 * transaction as the body's Zotero saves, after the body returns; a throw records nothing.
 */
export type ChangeWriter = {
  readonly changeId: string;
  /** One line for list_changes, e.g. `Created note ABCD1234 under EFGH5678`. Defaults to the tool name. */
  summary: string;
  /** JSON-serialisable extra state for this change's undo handler. */
  data: unknown;
  ownObject(o: OwnedObject): void;
  ownTag(t: OwnedTag): void;
  /** Forget an owned pair (when the tag is removed again), so a user re-adding it later owns it. */
  disownTag(t: OwnedTag): void;
  saveNoteVersion(v: NoteVersion): void;
  /**
   * The HTML this write left in a note (after its save). Every write that creates or changes a note's
   * content records it: a later difference means the user edited the note, which makes it theirs.
   */
  noteWritten(v: NoteVersion): void;
};

export type UndoContext = {
  db: Db;
  /** Forget an owned pair, effective with the undo's commit. */
  disownTag(t: OwnedTag): Promise<void>;
  /** Own a pair (again) under the change being undone, effective with the undo's commit. */
  ownTag(t: OwnedTag): Promise<void>;
  /** Like ChangeWriter.noteWritten, for an undo that rewrites a note's content. */
  noteWritten(v: NoteVersion): Promise<void>;
  log(message: string): void;
};

/**
 * Reverses changes of one `kind`. Files in src/undo/ default-export one (auto-registered).
 * `undo` runs inside the DB transaction that marks the change undone: use `item.save()`, never
 * `saveTx()`/`eraseTx()`/`Zotero.Items.trashTx()` (nested transactions deadlock). Throw `ToolError`
 * to refuse; the change then stays not undone. Returns a one-line summary of what was reversed.
 */
export type UndoHandler = {
  kind: string;
  undo(change: ChangeRecord, ctx: UndoContext): Promise<string>;
};
