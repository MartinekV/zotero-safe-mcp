// A user's edit makes an agent note the user's (SPEC Hard rule 1, ticket 14). A note counts as edited
// when its content differs from what the agent last wrote into it, compared as Markdown like undo of
// edit_note does, so the note editor's reformatting on open doesn't count. Once noticed, the take-over
// is recorded in the registry for good: the user reverting their edit doesn't hand the note back.
// Embedded images (child items) of such a note are the user's too. Tags the agent added to the note
// stay the agent's (item + tag pairs are separate objects; remove_tags / undo of add_tags still work).
import type { AgentNote, ChangeRecord } from "../changes/types";
import { noteHtmlToMarkdown } from "../notes/noteHtmlToMarkdown";
import { ToolError } from "../registry/types";

export type NoteReader = {
  /** The current HTML of the note with this key, or null if there is no such note. */
  noteHtml(libraryID: number, key: string): string | null;
  /** The key of the item's parent item, or null. */
  parentKey(libraryID: number, key: string): string | null;
};

export type UserEditRegistry = {
  agentNotes(libraryID: number, keys: readonly string[]): Promise<Map<string, AgentNote>>;
  markUserEdited(libraryID: number, keys: readonly string[]): Promise<void>;
};

/**
 * The subset of `keys` that are notes the user took over by editing them in Zotero, or children
 * (embedded images) of such notes. Newly noticed take-overs are recorded in the registry.
 */
export async function userTakenKeys(
  registry: UserEditRegistry,
  reader: NoteReader,
  libraryID: number,
  keys: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(keys)];
  const parentOf = new Map(unique.map((k) => [k, reader.parentKey(libraryID, k)]));
  const candidates = [...new Set([...unique, ...[...parentOf.values()].filter((p): p is string => p !== null)])];
  const notes = await registry.agentNotes(libraryID, candidates);
  const takenNotes = new Set<string>();
  const newlyTaken: string[] = [];
  for (const [key, note] of notes) {
    if (note.userEdited) takenNotes.add(key);
    else if (userEdited(reader.noteHtml(libraryID, key), note.html)) {
      takenNotes.add(key);
      newlyTaken.push(key);
    }
  }
  if (newlyTaken.length) await registry.markUserEdited(libraryID, newlyTaken);
  return new Set(unique.filter((k) => takenNotes.has(k) || takenNotes.has(parentOf.get(k) ?? "")));
}

function userEdited(current: string | null, agentHtml: string): boolean {
  return current !== null && noteHtmlToMarkdown(current) !== noteHtmlToMarkdown(agentHtml);
}

/** Throws unless none of `keys` was taken over by the user; `action` names what was refused. */
export function requireNotUserTaken(keys: readonly string[], taken: ReadonlySet<string>, action: string): void {
  const hit = [...new Set(keys.filter((k) => taken.has(k)))];
  if (hit.length) {
    throw new ToolError(
      `Refusing to ${action} ${hit.join(", ")}: you edited this note in Zotero; it is now yours ` +
        "(it, its images and its undo history are read-only for this plugin). Nothing was changed.",
    );
  }
}

/**
 * The library objects an undo of `change` would change: what it created, the notes it edited, and
 * the items it trashed. Tag pairs are not included (they stay the agent's).
 */
export function keysUndoWouldChange(change: ChangeRecord): string[] {
  const data = change.data as { trashed?: unknown } | null;
  const trashed = Array.isArray(data?.trashed) ? (data!.trashed as string[]) : [];
  return [...new Set([...change.objects.map((o) => o.itemKey), ...change.noteVersions.map((v) => v.noteKey), ...trashed])];
}
