// The Zotero side of noteVersions.ts: notes and their embedded-image attachments
// (exploration notes 05-note-html.md "Embedded images").
import type { NoteLike, NoteStore, SavedImage } from "./noteVersions";

const EXTENSIONS: Record<string, string> = {
  "image/apng": "apng",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/bmp": "bmp",
};

/** The embedded-image attachment with this key, if it exists. */
export function embeddedImageAttachment(libraryID: number, key: string): Zotero.Item | null {
  const att = Zotero.Items.getByLibraryAndKey(libraryID, key);
  return att && att.isEmbeddedImageAttachment() ? att : null;
}

/**
 * Zotero.Attachments.importEmbeddedImage without its own transaction: call inside recordWrite's
 * body or an undo handler. The note must be saved. Returns the new attachment.
 */
export async function importEmbeddedImage(note: Zotero.Item, bytes: Uint8Array, contentType: string): Promise<Zotero.Item> {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new Error(`Unsupported embedded image content type '${contentType}'`);
  const filename = `image.${ext}`;
  const att = new Zotero.Item("attachment");
  att.libraryID = note.libraryID;
  att.parentID = note.id;
  att.attachmentLinkMode = Zotero.Attachments.LINK_MODE_EMBEDDED_IMAGE;
  att.attachmentPath = "storage:" + filename;
  att.attachmentContentType = contentType;
  await att.save();
  const dir = await (Zotero.Attachments as any).createDirectoryForItem(att);
  await IOUtils.write(PathUtils.join(dir as string, filename), bytes);
  return att;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const zoteroNoteStore: NoteStore = {
  getNote(libraryID, key) {
    const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
    return item && item.isNote() ? (item as unknown as NoteLike) : null;
  },
  imageExists: (libraryID, key) => embeddedImageAttachment(libraryID, key) !== null,
  async readImage(libraryID, key): Promise<SavedImage | null> {
    const att = embeddedImageAttachment(libraryID, key);
    const path = att && (await att.getFilePathAsync());
    if (!att || !path) return null;
    return { attachmentKey: key, contentType: att.attachmentContentType, base64: toBase64(await IOUtils.read(path)) };
  },
  async importImage(note, image) {
    const att = await importEmbeddedImage(note as unknown as Zotero.Item, fromBase64(image.base64), image.contentType);
    return att.key;
  },
};
