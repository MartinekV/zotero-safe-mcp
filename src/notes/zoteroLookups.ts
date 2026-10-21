// The Zotero side of markdownToNoteHtml's lookups, for create_note / edit_note.
import { ToolError } from "../registry/types";
import { libraryID } from "../zotero/library";
import type { CitedItem, NoteLookups } from "./markdownToNoteHtml";

/** `[@KEY]` → a Zotero citation of that regular (non-trashed) item; anything else fails the call. */
export function resolveCitation(itemKey: string): CitedItem | null {
  const item = Zotero.Items.getByLibraryAndKey(libraryID(), itemKey);
  if (!item || item.deleted || !item.isRegularItem()) return null;
  const uri = Zotero.URI.getItemURI(item);
  const itemData = (Zotero.Utilities as any).Item.itemToCSLJSON(item);
  const label = (Zotero as any).EditorInstanceUtilities._formatCitationItemPreview({ uris: [uri], itemData });
  return { uri, itemData, label };
}

/** Lookups for a note's Markdown. Embedded images come with POST /safe-mcp/image (ticket 10). */
export function noteLookups(): NoteLookups {
  return {
    resolveCitation,
    resolveImage(imageId) {
      throw new ToolError(`Images are not supported yet (image:${imageId}); leave the image out.`);
    },
  };
}
