import { ITEM_KEY_PATTERN } from "../pdf/attachmentKey";
import { getPdfAttachment } from "../pdf/attachment";
import { PAGES_PATTERN, parsePages, splitPages } from "../pdf/pages";
import { defineTool, ToolError } from "../registry/types";

type Args = { attachmentKey: string; pages?: string };
type PageText = { page: number; text: string };

/** Pages from Zotero's full-text cache (.zotero-ft-cache), or null if it has none. */
async function fromIndex(item: Zotero.Item): Promise<{ pages: string[]; total: number } | null> {
  const cache = Zotero.Fulltext.getItemCacheFile(item)?.path;
  if (!cache || !(await IOUtils.exists(cache))) return null;
  const pages = splitPages(await Zotero.File.getContentsAsync(cache) as string);
  const info = (await Zotero.Fulltext.getPages(item.id)) as { indexedPages?: number; total?: number } | false;
  const indexed = Math.min(info ? (info.indexedPages ?? pages.length) : pages.length, pages.length);
  return { pages: pages.slice(0, indexed), total: (info && info.total) || pages.length };
}

function pick(pages: string[], wanted: number[]): PageText[] {
  return wanted.map((page) => ({ page, text: pages[page - 1] ?? "" }));
}

function allPages(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

export default defineTool<Args>({
  name: "read_pdf_text",
  description:
    "Plain text of a PDF attachment, one entry per page (1-based page numbers, as in the PDF, not printed page labels). " +
    'Uses Zotero\'s full-text index, or extracts the text when the PDF isn\'t indexed. Optional `pages` like "1-3,7".',
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["attachmentKey"],
    properties: {
      attachmentKey: { type: "string", pattern: ITEM_KEY_PATTERN, description: "Key of the PDF attachment item" },
      pages: { type: "string", pattern: PAGES_PATTERN, maxLength: 200, description: 'Pages to return, e.g. "2" or "1-3,7" (default: all)' },
    },
  },
  async handler({ attachmentKey, pages }) {
    const item = await getPdfAttachment(attachmentKey);

    const index = await fromIndex(item);
    if (index) {
      const wanted = pages ? parsePages(pages, index.total) : allPages(index.total);
      if (wanted.every((p) => p <= index.pages.length)) {
        return result(attachmentKey, "fulltext-index", index.total, pick(index.pages, wanted));
      }
    }

    // Not indexed, or only partly (Zotero indexes the first fulltext.pdfMaxPages pages): extract it.
    if (!(await item.getFilePathAsync())) {
      throw new ToolError(`The PDF of attachment ${attachmentKey} is not indexed and its file is not available on this computer`);
    }
    const extracted = (await Zotero.PDFWorker.getFullText(item.id, null)) as { text: string; totalPages: number };
    const all = splitPages(extracted.text ?? "");
    const total = extracted.totalPages || all.length;
    const wanted = pages ? parsePages(pages, total) : allPages(total);
    return result(attachmentKey, "pdf-worker", total, pick(all, wanted));
  },
});

function result(attachmentKey: string, source: string, totalPages: number, pages: PageText[]) {
  const out: Record<string, unknown> = { attachmentKey, source, totalPages, pages };
  if (pages.length && pages.every((p) => !p.text)) out.note = "No text found on these pages (a scanned PDF without a text layer?)";
  return out;
}
