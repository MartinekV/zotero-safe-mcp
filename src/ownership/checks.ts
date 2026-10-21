// Ownership checks (SPEC Hard rule 1): pure functions every write tool uses before touching the
// library. The owned sets come from the ownership registry (src/changes), never from the [LLM] tag.
import { ToolError } from "../registry/types";

/**
 * Throws unless every key is an object the plugin created. `action` names what was refused
 * ("trash", "edit", …) for the message.
 */
export function requireOwned(keys: readonly string[], owned: ReadonlySet<string>, action: string): void {
  const foreign = [...new Set(keys.filter((k) => !owned.has(k)))];
  if (foreign.length) {
    throw new ToolError(
      `Refusing to ${action}: ${foreign.join(", ")} ${foreign.length === 1 ? "was" : "were"} not created by this plugin. ` +
        "The user's items, notes, highlights and tags are read-only; nothing was changed.",
    );
  }
}

/**
 * Splits requested tags into those the item lacks (`added`: the only pairs to add and record as
 * owned) and those it already has (never recorded: Zotero's addTag returns true for them too).
 * Duplicates in `requested` are dropped.
 */
export function splitNewTags(
  existing: readonly string[],
  requested: readonly string[],
): { added: string[]; alreadyPresent: string[] } {
  const have = new Set(existing);
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  for (const tag of new Set(requested)) (have.has(tag) ? alreadyPresent : added).push(tag);
  return { added, alreadyPresent };
}

/** Throws unless every (itemKey, tag) pair was added by the plugin; lists all offending tags. */
export function requireOwnedTagPairs(itemKey: string, tags: readonly string[], ownedTags: ReadonlySet<string>): void {
  const foreign = [...new Set(tags.filter((t) => !ownedTags.has(t)))];
  if (foreign.length) {
    throw new ToolError(
      `Refusing to remove tags from ${itemKey}: ${foreign.map((t) => JSON.stringify(t)).join(", ")} ` +
        `${foreign.length === 1 ? "was" : "were"} not added by this plugin. Nothing was changed.`,
    );
  }
}
