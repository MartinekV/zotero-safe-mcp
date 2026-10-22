// The `data` each change kind stores for its undo handler (ChangeWriter.data), shared by the tool that
// writes it, the handler in src/undo/ that reads it, and the ownership checks that look into it.
// (edit_note's is EditNoteData in src/notes/noteVersions.ts.)
import type { AnnotationSnapshot } from "../highlight/annotationItem";
import type { ChangeRecord } from "./types";

/** add_highlight: a copy of the highlight as created. */
export type AddHighlightData = { annotation: AnnotationSnapshot };

/** trash: what the call moved to the trash, and copies of the highlights among them. */
export type TrashData = { libraryID: number; trashed: string[]; annotations?: AnnotationSnapshot[] };

/** remove_tags: the tags the call removed. */
export type RemoveTagsData = { libraryID: number; itemKey: string; removed: string[] };

/** The keys a `trash` change moved to the trash (none for other kinds). */
export function trashedKeys(change: ChangeRecord): string[] {
  if (change.kind !== "trash") return [];
  const data = change.data as TrashData | null;
  return Array.isArray(data?.trashed) ? data!.trashed : [];
}
