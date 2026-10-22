// Adapted from llm-for-zotero (AGPL-3.0), src/agent/services/zotero/importCapability.ts@435dd19
// (lookup with libraryID:false, then ItemSaver.saveItems, then addAvailableFile).
// The Zotero side of import_paper (orchestration and its reasoning: ./runImport.ts). Metadata comes
// from Zotero's own identifier translators (Zotero.Translate.Search, as "Add Item by Identifier"),
// saving goes through Zotero.Translate.ItemSaver, as the translators would, but in two steps so a
// slow lookup can be abandoned before anything is saved.
import { changeLog } from "../changes";
import { setDeleted } from "../changes/trash";
import type { Identifier } from "./identifier";
import type { ImportPorts, SavedObject } from "./runImport";

const Z = () => Zotero as any;

function toSaved(item: Zotero.Item): SavedObject {
  const parent = item.parentKey ? { parentKey: item.parentKey } : {};
  if (item.isNote()) return { key: item.key, kind: "note", ...parent };
  if (item.isAttachment()) {
    return { key: item.key, kind: "attachment", title: item.getField("title") as string, contentType: item.attachmentContentType || undefined, ...parent };
  }
  return { key: item.key, kind: "paper", title: item.getField("title") as string };
}

export function zoteroImportPorts(opts: {
  libraryID: number;
  collectionID?: number;
  args: unknown;
  identifier: Identifier;
  log(message: string): void;
}): ImportPorts {
  const L = opts.libraryID;
  const trash = (keys: string[]) => Zotero.DB.executeTransaction(() => setDeleted(L, keys, true));
  return {
    async lookup(id) {
      const translate = new (Z().Translate.Search)();
      translate.setIdentifier({ [id.type]: id.value });
      const translators = await translate.getTranslators();
      if (!translators.length) throw new Error(`Zotero has no translator for ${id.type}`);
      translate.setTranslator(translators); // the whole list: falls through to the next on failure
      // libraryID: false → item JSON only; nothing is saved.
      return await translate.translate({ libraryID: false });
    },

    async save(items, onSaved, onAttachment) {
      const ItemSaver = Z().Translate.ItemSaver;
      const saver = new ItemSaver({
        libraryID: L,
        collections: opts.collectionID !== undefined ? [opts.collectionID] : false,
        attachmentMode: ItemSaver.ATTACHMENT_MODE_DOWNLOAD, // the user's downloadAssociatedFiles/automaticSnapshots prefs apply
        forceTagType: 1,
        saveOptions: { skipSelect: true }, // don't change the user's selection
      });
      // Ownership comes only from what this saver creates (never from the item's children, which may
      // include the user's): capture the notes and attachments its own save methods return.
      const notes: Zotero.Item[] = [];
      const saveNote = saver._saveNote;
      saver._saveNote = async function (...a: unknown[]) {
        const note = await saveNote.apply(this, a);
        if (note) notes.push(note);
        return note;
      };
      const saveAttachment = saver._saveAttachment;
      saver._saveAttachment = async function (...a: unknown[]) {
        const att = await saveAttachment.apply(this, a);
        if (att) onAttachment(toSaved(att));
        return att;
      };
      // The saver's own open-access download doesn't return its attachment; runImport's Find
      // Available PDF step (findPdf below, open-access sources included) does that instead.
      saver._getOpenAccessPDFURLs = async () => null;
      saver.saveOpenAccessAttachment = async () => {};
      return saver.saveItems(items, () => {}, (_json: unknown, saved: Zotero.Item[]) => {
        const all = new Map([...saved, ...notes].map((i) => [i.key, toSaved(i)]));
        onSaved([...all.values()]);
      });
    },

    async findPdf(key) {
      const item = Zotero.Items.getByLibraryAndKey(L, key);
      if (!item) return null;
      const att = await Z().Attachments.addAvailableFile(item);
      return att ? toSaved(att) : null;
    },

    async record(objects, summary) {
      const { changeId } = await changeLog().recordWrite({ tool: "import_paper", args: opts.args }, async (w) => {
        for (const o of objects) {
          w.ownObject({ libraryID: L, itemKey: o.key, kind: o.kind });
          // Notes the translator added: the user editing one makes it theirs, as for create_note.
          const item = o.kind === "note" ? Zotero.Items.getByLibraryAndKey(L, o.key) : null;
          if (item && item.isNote()) w.noteWritten({ libraryID: L, noteKey: o.key, html: item.getNote() });
        }
        w.data = { identifier: opts.identifier };
        w.summary = summary;
      });
      return changeId;
    },

    async addLate(changeId, objects) {
      const { undone } = await changeLog().addObjects(
        changeId,
        objects.map((o) => ({ libraryID: L, itemKey: o.key, kind: o.kind })),
        objects.flatMap((o) => {
          const note = o.kind === "note" ? Zotero.Items.getByLibraryAndKey(L, o.key) : null;
          return note && note.isNote() ? [{ libraryID: L, noteKey: o.key, html: note.getNote() }] : [];
        }),
      );
      if (undone) await trash(objects.map((o) => o.key));
    },

    async discard(keys) {
      await trash(keys);
    },

    log: opts.log,
  };
}
