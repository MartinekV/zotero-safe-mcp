/** `"a", "b"`: tag names as they appear in messages and change summaries. */
export function quoteTags(tags: readonly string[]): string {
  return tags.map((t) => JSON.stringify(t)).join(", ");
}
