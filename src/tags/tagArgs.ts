// Argument handling shared by add_tags and remove_tags.
import { LLM_TAG } from "../config";
import type { JsonSchema } from "../registry/types";
import { ToolError } from "../registry/types";
import { requireItem } from "../zotero/library";

export const TAG_LIST_SCHEMA: JsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 50,
  items: { type: "string", minLength: 1, maxLength: 1000 },
};

/** Zotero's limit for tags that sync (Zotero.Tags.MAX_SYNC_LENGTH). */
export const MAX_TAG_LENGTH = 255;

/**
 * Tag names as Zotero stores them (Zotero.Tags.cleanData: trimmed, NFC), duplicates dropped. Case is
 * kept: Zotero tags are case-sensitive. Refuses blank or over-long names and the reserved [LLM] tag in
 * any case: it marks the agent's notes (SPEC Hard rule 3), so the agent may neither put it on other
 * items nor take it off its notes.
 */
export function tagNames(requested: readonly string[], action: "add" | "remove"): string[] {
  const names = [...new Set(requested.map((t) => t.trim().normalize()))];
  if (names.some((t) => t === "")) throw new ToolError("Tags cannot be empty or only whitespace; nothing was changed.");
  const long = names.filter((t) => t.length > MAX_TAG_LENGTH);
  if (long.length) {
    throw new ToolError(`Tags can be at most ${MAX_TAG_LENGTH} characters (${long.map((t) => JSON.stringify(t.slice(0, 40) + "…")).join(", ")}); nothing was changed.`);
  }
  if (names.some((t) => t.toLowerCase() === LLM_TAG.toLowerCase())) {
    throw new ToolError(
      `${LLM_TAG} is reserved: the plugin puts it on the notes it creates, so it cannot be ${action === "add" ? "added" : "removed"} ` +
        "with tags tools; nothing was changed.",
    );
  }
  return names;
}

/** An item tags can be added to: exists and is not in the trash. */
export function requireTaggableItem(key: string): Zotero.Item {
  const item = requireItem(key);
  if (item.deleted) throw new ToolError(`${key} is in the trash; restore it before tagging it.`);
  return item;
}
