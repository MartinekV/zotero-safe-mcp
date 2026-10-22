// Looking up attachment items by key for the PDF tools and GET /safe-mcp/pdf/<key>.
// Files are only ever resolved through the attachment item (getFilePathAsync), never from a client path.
import { ToolError } from "../registry/types";
import { libraryID } from "../zotero/library";
import { isItemKey } from "./attachmentKey";
import { hasPdfHeader, PDF_HEADER_WINDOW } from "./pdfHeader";

/** A file attachment (PDF, EPUB, snapshot …) in the user's library, or ToolError. */
export async function getFileAttachment(key: string): Promise<Zotero.Item> {
  if (!isItemKey(key)) throw new ToolError(`Invalid attachment key "${key}": expected 8 characters A-Z/0-9`);
  const item = (await Zotero.Items.getByLibraryAndKeyAsync(libraryID(), key)) as Zotero.Item | false;
  if (!item) throw new ToolError(`No item with key ${key}`);
  if (!item.isAttachment()) throw new ToolError(`Item ${key} is not an attachment (use get_item to find its attachment keys)`);
  if (!item.isFileAttachment()) throw new ToolError(`Attachment ${key} is a link, not a file`);
  return item;
}

/** A PDF attachment in the user's library, or ToolError. */
export async function getPdfAttachment(key: string): Promise<Zotero.Item> {
  const item = await getFileAttachment(key);
  if (!item.isPDFAttachment()) throw new ToolError(`Attachment ${key} is not a PDF (${item.attachmentContentType || "unknown type"})`);
  return item;
}

export type PdfFile = { path: string; size: number };

/** The local file of a PDF attachment, or ToolError if it isn't available on this computer. */
export async function getPdfFile(key: string): Promise<PdfFile> {
  const item = await getPdfAttachment(key);
  const path = await item.getFilePathAsync();
  if (!path) throw new ToolError(`The PDF of attachment ${key} is not available on this computer (not downloaded?)`);
  if (!hasPdfHeader(await IOUtils.read(path, { maxBytes: PDF_HEADER_WINDOW }))) {
    throw new ToolError(`The file of attachment ${key} is not a PDF (no %PDF- header)`);
  }
  const { size } = await IOUtils.stat(path);
  return { path, size: size ?? 0 };
}
