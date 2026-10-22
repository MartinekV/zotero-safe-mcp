// The ownership checks write tools use, wired to the registry and Zotero: an object is the agent's
// when the plugin created it (src/changes) and the user hasn't taken it over by editing it
// (src/ownership/userEdits.ts).
import { changeLog } from "../changes";
import type { ChangeRecord } from "../changes/types";
import { zoteroNoteReader } from "../notes/zoteroNotes";
import { requireOwned } from "./checks";
import { keysUndoWouldChange, requireNotUserTaken, userTakenKeys } from "./userEdits";

/** The subset of `keys` that are still the agent's (for byLLM). */
export async function agentOwnedKeys(libraryID: number, keys: readonly string[]): Promise<Set<string>> {
  const owned = await changeLog().ownedKeys(libraryID, keys);
  const taken = await userTakenKeys(changeLog(), zoteroNoteReader, libraryID, [...owned]);
  return new Set([...owned].filter((k) => !taken.has(k)));
}

/** Throws a ToolError unless every key is still the agent's; `action` names what was refused. */
export async function requireAgentOwned(libraryID: number, keys: readonly string[], action: string): Promise<void> {
  requireOwned(keys, await changeLog().ownedKeys(libraryID, keys), action);
  requireNotUserTaken(keys, await userTakenKeys(changeLog(), zoteroNoteReader, libraryID, keys), action);
}

/** Throws a ToolError if undoing `change` would change a note (or its images) the user took over. */
export async function requireUndoable(change: ChangeRecord, libraryID: number): Promise<void> {
  const keys = keysUndoWouldChange(change);
  requireNotUserTaken(keys, await userTakenKeys(changeLog(), zoteroNoteReader, libraryID, keys), `undo ${change.changeId} of`);
}
