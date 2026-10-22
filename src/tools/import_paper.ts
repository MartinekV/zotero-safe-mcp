import { parseIdentifier } from "../import/identifier";
import { runImport } from "../import/runImport";
import { zoteroImportPorts } from "../import/zoteroPorts";
import { findExistingPaper } from "../import/zoteroDuplicates";
import { defineTool, ToolError } from "../registry/types";
import { KEY_PATTERN, libraryID, requireCollection } from "../zotero/library";

type Args = { identifier: string; collectionKey?: string };

/** Budgets (see src/import/runImport.ts): the call holds the write queue for at most about their sum. */
export const LOOKUP_TIMEOUT_MS = 30_000;
export const ATTACHMENT_TIMEOUT_MS = 30_000;

export default defineTool<Args>({
  name: "import_paper",
  description:
    "Import a paper into the Zotero library by ONE identifier: a DOI (10.1038/nature12373, optional doi: prefix), " +
    "an arXiv ID (1706.03762 or hep-th/9901001, optional arXiv: prefix) or a PubMed ID (23193287). URLs, " +
    "file paths, ISBNs and titles are refused. Uses Zotero's own translators and fetches the PDF when Zotero can. " +
    "Optional collectionKey (must exist) files the item there. If a paper with the same DOI, arXiv ID or PMID is " +
    "already in the library (not in the trash), nothing is imported or changed and the result is { duplicate: true, " +
    "itemKey } of that existing item (it stays the user's; it is not filed into collectionKey). Otherwise returns the new itemKey, " +
    "its attachments (pdfAttachmentKey for read_pdf_text) and a changeId for undo. If downloads take longer than " +
    `${ATTACHMENT_TIMEOUT_MS / 1000} s the call returns with complete: false and they finish in the background.`,
  write: true,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["identifier"],
    properties: {
      identifier: { type: "string", maxLength: 300, description: "One DOI, arXiv ID or PMID" },
      collectionKey: { type: "string", pattern: KEY_PATTERN, description: "Existing collection to add the item to" },
    },
  },
  async handler(args, ctx) {
    const parsed = parseIdentifier(args.identifier);
    if (!parsed.ok) throw new ToolError(parsed.error);
    const collectionID = args.collectionKey !== undefined ? requireCollection(args.collectionKey).id : undefined;
    const existing = await findExistingPaper(libraryID(), parsed.identifier);
    if (existing) {
      const item = Zotero.Items.getByLibraryAndKey(libraryID(), existing.itemKey) as Zotero.Item;
      return {
        duplicate: true,
        itemKey: existing.itemKey,
        ...(existing.itemKeys.length > 1 ? { itemKeys: existing.itemKeys } : {}),
        title: item.getField("title"),
        identifier: parsed.identifier,
        message:
          `Already in the library as ${existing.itemKey}; nothing was imported.` +
          (args.collectionKey !== undefined ? ` It was not added to the collection ${args.collectionKey} (that would change a user item).` : ""),
      };
    }
    const ports = zoteroImportPorts({ libraryID: libraryID(), collectionID, args, identifier: parsed.identifier, log: ctx.log });
    const r = await runImport(parsed.identifier, ports, {
      lookupTimeoutMs: LOOKUP_TIMEOUT_MS,
      attachmentTimeoutMs: ATTACHMENT_TIMEOUT_MS,
      findPdf: Zotero.Prefs.get("downloadAssociatedFiles") !== false,
    });
    return {
      changeId: r.changeId,
      itemKey: r.itemKey,
      ...(r.itemKeys.length > 1 ? { itemKeys: r.itemKeys } : {}),
      title: r.title,
      identifier: parsed.identifier,
      attachments: r.attachments.map(({ key, title, contentType }) => ({ key, title, contentType: contentType ?? null })),
      notes: r.notes,
      pdfAttachmentKey: r.pdfAttachmentKey,
      complete: r.complete,
      ...(r.message ? { message: r.message } : {}),
    };
  },
});
