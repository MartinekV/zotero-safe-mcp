// list_annotations' rows: an attachment's annotations in reading order, with byLLM from the ownership
// registry (never from an [LLM] comment). Pure apart from the item objects passed in.
import { colorNameOf, type Palette } from "./color";

/** Whether the ownership registry recorded this object as created by the plugin. */
export type IsOwned = (libraryID: number, key: string) => boolean | Promise<boolean>;

/** The parts of a Zotero annotation item used here. */
type AnnotationLike = {
  key: string;
  libraryID: number;
  annotationType: string;
  annotationColor?: string | null;
  annotationText?: string | null;
  annotationComment?: string | null;
  annotationPageLabel?: string | null;
  annotationPosition?: string | null;
  annotationSortIndex?: string | null;
};

export type AnnotationRow = {
  key: string;
  type: string;
  color: string | null;
  colorName: string | null;
  text: string | null;
  comment: string | null;
  page: string | null;
  pageIndex: number | null;
  byLLM: boolean;
};

export async function listAnnotations(
  attachment: { getAnnotations(): unknown[] },
  isOwned: IsOwned,
  palette: Palette,
): Promise<AnnotationRow[]> {
  const items = (attachment.getAnnotations() as AnnotationLike[])
    .slice()
    .sort((a, b) => String(a.annotationSortIndex).localeCompare(String(b.annotationSortIndex)));
  const rows: AnnotationRow[] = [];
  for (const a of items) {
    let pageIndex: number | null = null;
    try {
      const p = JSON.parse(a.annotationPosition || "{}").pageIndex;
      if (Number.isInteger(p)) pageIndex = p;
    } catch {
      // Unparseable position: leave pageIndex null.
    }
    rows.push({
      key: a.key,
      type: a.annotationType,
      color: a.annotationColor ?? null,
      colorName: colorNameOf(a.annotationColor ?? null, palette),
      text: a.annotationText ?? null,
      comment: a.annotationComment ?? null,
      page: a.annotationPageLabel || (pageIndex === null ? null : String(pageIndex + 1)),
      pageIndex,
      byLLM: (await isOwned(a.libraryID, a.key)) === true,
    });
  }
  return rows;
}
