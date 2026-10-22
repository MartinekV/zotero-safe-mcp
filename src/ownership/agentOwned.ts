// The ownership checks write tools use, wired to the registry and Zotero: an object is the agent's
// when the plugin created it (src/changes) and the user hasn't taken it over by editing it
// (src/ownership/userEdits.ts).
import { changeLog } from "../changes";
import type { ChangeRecord } from "../changes/types";
import { zoteroNoteReader } from "../notes/zoteroNotes";
import { ToolError } from "../registry/types";
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

/**
 * Throws a ToolError if undoing `change` would change a note (or its images) the user took over, or
 * trash an object that has children that aren't the agent's (they would go to the trash with it).
 */
export async function requireUndoable(change: ChangeRecord, libraryID: number): Promise<void> {
  const keys = keysUndoWouldChange(change);
  requireNotUserTaken(keys, await userTakenKeys(changeLog(), zoteroNoteReader, libraryID, keys), `undo ${change.changeId} of`);
  await requireNoUserChildren(libraryID, change.objects.map((o) => o.itemKey), `undo ${change.changeId}, which would trash`);
}

/**
 * Throws a ToolError if any of `keys` has a descendant (child note or attachment, a highlight on an
 * attachment, trashed ones included) that isn't the agent's: trashing a parent takes its children
 * along, and emptying the trash would erase them. Embedded images of a note are part of the note
 * (a user adding one is an edit of the note, which makes the note the user's).
 */
export async function requireNoUserChildren(libraryID: number, keys: readonly string[], action: string): Promise<void> {
  const parentOf = new Map<string, string>();
  for (const key of new Set(keys)) {
    for (const child of descendants(libraryID, key)) if (!parentOf.has(child)) parentOf.set(child, key);
  }
  if (!parentOf.size) return;
  const own = await agentOwnedKeys(libraryID, [...parentOf.keys()]);
  const foreign = [...parentOf.keys()].filter((k) => !own.has(k));
  if (!foreign.length) return;
  const parents = [...new Set(foreign.map((k) => parentOf.get(k)!))];
  throw new ToolError(
    `Refusing to ${action} ${parents.join(", ")}: ${foreign.join(", ")} ${foreign.length === 1 ? "is" : "are"} the user's ` +
      `(a note, attachment or highlight added to it, or a note of the agent's the user edited), and would go to the trash with it. ` +
      "Nothing was changed.",
  );
}

/** Keys of the item's children and grandchildren (notes, attachments, annotations), trashed ones included. */
function descendants(libraryID: number, key: string): string[] {
  const out: string[] = [];
  const visit = (item: Zotero.Item | false | undefined) => {
    if (!item) return;
    const ids: number[] = [];
    if (item.isRegularItem()) ids.push(...item.getNotes(true), ...item.getAttachments(true));
    if (item.isFileAttachment()) ids.push(...item.getAnnotations(true).map((a) => a.id));
    for (const id of ids) {
      const child = Zotero.Items.get(id) as Zotero.Item | false;
      if (!child) continue;
      out.push(child.key);
      visit(child);
    }
  };
  visit(Zotero.Items.getByLibraryAndKey(libraryID, key));
  return out;
}
