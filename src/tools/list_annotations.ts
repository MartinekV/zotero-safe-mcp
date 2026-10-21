import { ITEM_KEY_PATTERN } from "../pdf/attachmentKey";
import { getFileAttachment } from "../pdf/attachment";
import { defineTool, ToolDef } from "../registry/types";

/** Whether the ownership registry recorded this object as created by the plugin. */
export type IsOwned = (libraryID: number, key: string) => boolean | Promise<boolean>;

export type ListAnnotationsDeps = {
  getAttachment(key: string): Promise<Zotero.Item>;
  /**
   * Ownership registry lookup for `byLLM`. Defaults to "nothing is owned" until the registry
   * (ticket 04) is wired in at the default export below. Never derived from an `[LLM]` comment.
   */
  isOwned?: IsOwned;
  /** Zotero.Annotations.COLORS: [l10nKey like "general-yellow", hex]. */
  colors?(): readonly (readonly string[])[];
};

const notOwned: IsOwned = () => false;

function colorName(hex: string | null, colors: readonly (readonly string[])[]): string | null {
  const entry = colors.find(([, h]) => h === hex);
  return entry ? entry[0].replace(/^general-/, "") : null;
}

export function createListAnnotationsTool(deps: ListAnnotationsDeps): ToolDef<{ attachmentKey: string }> {
  const isOwned = deps.isOwned ?? notOwned;
  const colors = deps.colors ?? (() => (Zotero.Annotations as any).COLORS ?? []);
  return defineTool<{ attachmentKey: string }>({
    name: "list_annotations",
    description:
      "Annotations (highlights, notes, …) of a PDF or other file attachment, in reading order: key, type, color, text, comment, " +
      "page (the label shown in Zotero), pageIndex (0-based) and byLLM (true only for annotations this plugin created).",
    write: false,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["attachmentKey"],
      properties: { attachmentKey: { type: "string", pattern: ITEM_KEY_PATTERN, description: "Key of the attachment item" } },
    },
    async handler({ attachmentKey }) {
      const attachment = await deps.getAttachment(attachmentKey);
      const items = (attachment.getAnnotations() as Zotero.Item[])
        .slice()
        .sort((a, b) => String(a.annotationSortIndex).localeCompare(String(b.annotationSortIndex)));
      const palette = colors();
      const annotations = [];
      for (const a of items) {
        let pageIndex: number | null = null;
        try {
          const p = JSON.parse(a.annotationPosition || "{}").pageIndex;
          if (Number.isInteger(p)) pageIndex = p;
        } catch {
          // Unparseable position: leave pageIndex null.
        }
        annotations.push({
          key: a.key,
          type: a.annotationType,
          color: a.annotationColor ?? null,
          colorName: colorName(a.annotationColor ?? null, palette),
          text: a.annotationText ?? null,
          comment: a.annotationComment ?? null,
          page: a.annotationPageLabel || (pageIndex === null ? null : String(pageIndex + 1)),
          pageIndex,
          byLLM: (await isOwned(a.libraryID, a.key)) === true,
        });
      }
      return { attachmentKey, annotations };
    },
  });
}

export default createListAnnotationsTool({ getAttachment: getFileAttachment, isOwned: notOwned });
