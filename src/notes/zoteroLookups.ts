// The Zotero side of markdownToNoteHtml's lookups, for create_note / edit_note.
import { imageUploads } from "../images";
import type { ImageUploads, StoredImage } from "../images/uploads";
import { libraryID } from "../zotero/library";
import type { CitedItem, NoteLookups } from "./markdownToNoteHtml";
import { importEmbeddedImage, newAttachmentKey } from "./zoteroNotes";

/** `[@KEY]` → a Zotero citation of that regular (non-trashed) item; anything else fails the call. */
export function resolveCitation(itemKey: string): CitedItem | null {
  const item = Zotero.Items.getByLibraryAndKey(libraryID(), itemKey);
  if (!item || item.deleted || !item.isRegularItem()) return null;
  const uri = Zotero.URI.getItemURI(item);
  const itemData = (Zotero.Utilities as any).Item.itemToCSLJSON(item);
  const label = (Zotero as any).EditorInstanceUtilities._formatCitationItemPreview({ uris: [uri], itemData });
  return { uri, itemData, label };
}

export type NoteLookupsWithUploads = NoteLookups & {
  /**
   * Inside recordWrite, once the note is saved: imports the uploaded images its HTML references as
   * embedded-image attachments of the note, under the keys resolveImage gave them. Returns those keys.
   */
  importImages(note: Zotero.Item): Promise<string[]>;
  /** After the write committed: the uploads it used are gone (each imageId works once). */
  consumeUploads(): void;
};

/**
 * Lookups for a note's Markdown. `image:<imageId>` resolves uploads from POST /safe-mcp/image: each
 * gets a fresh attachment key now (the HTML needs it before the note exists) and is imported by
 * importImages. A call that fails before consumeUploads leaves the uploads usable.
 */
export function noteLookups(uploads: ImageUploads = imageUploads()): NoteLookupsWithUploads {
  const pending = new Map<string, { image: StoredImage; attachmentKey: string }>();
  return {
    resolveCitation,
    resolveImage(imageId) {
      const image = uploads.get(imageId);
      if (!image) return null;
      const attachmentKey = pending.get(imageId)?.attachmentKey ?? newAttachmentKey(libraryID());
      pending.set(imageId, { image, attachmentKey });
      return { attachmentKey, width: image.width, height: image.height };
    },
    async importImages(note) {
      const keys: string[] = [];
      for (const { image, attachmentKey } of pending.values()) {
        await importEmbeddedImage(note, image.bytes, image.contentType, attachmentKey);
        keys.push(attachmentKey);
      }
      return keys;
    },
    consumeUploads() {
      uploads.take(pending.keys());
    },
  };
}

/** ", with images K1, K2" for change summaries ("" without images). */
export function withImages(imageKeys: readonly string[]): string {
  return imageKeys.length ? ` with image${imageKeys.length === 1 ? "" : "s"} ${imageKeys.join(", ")}` : "";
}
