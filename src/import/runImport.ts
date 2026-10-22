// import_paper's orchestration, independent of Zotero (the Zotero side is ./zoteroPorts.ts):
//
// 1. lookup: Zotero's identifier translators fetch metadata over the network and save NOTHING. A
//    lookup that doesn't answer within `lookupTimeoutMs` fails the call; a late answer is dropped.
// 2. save: the items (and translator notes) are saved, then `onSaved` fires and the change is
//    recorded at once, so the new item is owned before any attachment download starts to matter.
//    Only objects the save step itself reports (onSaved, onAttachment) and the PDF search returns
//    are recorded: children the user adds to the new item meanwhile are never swept in.
//    Zotero's ItemSaver opens its own transactions and does network I/O, so this can't run inside
//    recordWrite's single transaction; the window between its commit and our record is tiny, and
//    if recording fails the saved items go to the trash.
// 3. attachments download (translator PDFs, snapshots), then, if no PDF/EPUB came with the item,
//    Zotero's "Find Available PDF" (which includes open-access sources) runs. Everything created
//    is added to the same change (changeLog().addObjects).
//
// Steps 2-3 get `attachmentTimeoutMs` in total. When that runs out the call returns anyway
// (complete: false) and step 3 keeps going in the background, still recording what it creates,
// so a slow publisher never holds the serialised write queue for more than lookup + attachment
// budget.
import { ToolError } from "../registry/types";
import { errorMessage as describe } from "../util/errors";
import type { Identifier } from "./identifier";

export type SavedObject = {
  key: string;
  kind: "paper" | "attachment" | "note";
  title?: string;
  contentType?: string;
  /** For notes and attachments: the item they belong to. */
  parentKey?: string;
};

export type ImportPorts = {
  /** Metadata for the identifier from Zotero's translators; saves nothing. */
  lookup(id: Identifier): Promise<unknown[]>;
  /**
   * Saves the looked-up items. Calls `onSaved` with the top-level items and the notes saved with
   * them as soon as they are committed, then downloads attachments, calling `onAttachment` with each
   * one it creates; resolves when every download has finished.
   */
  save(items: unknown[], onSaved: (saved: SavedObject[]) => void, onAttachment: (attachment: SavedObject) => void): Promise<unknown>;
  /** Zotero's "Find Available PDF" for the item: the new attachment, or null if none was found. */
  findPdf(key: string): Promise<SavedObject | null>;
  /** Records a new change owning `objects`; returns its changeId. */
  record(objects: SavedObject[], summary: string): Promise<string>;
  /** Adds objects created later to the change (trashing them if the change was undone meanwhile). */
  addLate(changeId: string, objects: SavedObject[]): Promise<void>;
  /** Moves items to the trash (only used when recording failed). */
  discard(keys: string[]): Promise<void>;
  log(message: string): void;
};

export type ImportOptions = { lookupTimeoutMs: number; attachmentTimeoutMs: number; findPdf: boolean };

export type ImportResult = {
  changeId: string;
  itemKey: string;
  /** All top-level items, when a translator returned more than one. */
  itemKeys: string[];
  title: string;
  attachments: SavedObject[];
  notes: string[];
  pdfAttachmentKey: string | null;
  /** false: downloads were still running when the call returned; they are recorded when they finish. */
  complete: boolean;
  message?: string;
};

const PRIMARY_TYPES = new Set(["application/pdf", "application/epub+zip"]);
const TIMED_OUT = Symbol("timed out");

function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((r) => (timer = setTimeout(() => r(TIMED_OUT), Math.max(0, ms))));
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const label = (id: Identifier) => `${id.type} ${id.value}`;

export async function runImport(id: Identifier, ports: ImportPorts, opts: ImportOptions): Promise<ImportResult> {
  // 1. Lookup (network only).
  let found: unknown[] | typeof TIMED_OUT;
  try {
    found = await within(ports.lookup(id), opts.lookupTimeoutMs);
  } catch (e) {
    throw new ToolError(`Zotero could not import ${label(id)}: ${describe(e)}. Nothing was imported.`);
  }
  if (found === TIMED_OUT) {
    throw new ToolError(
      `Zotero's lookup of ${label(id)} did not answer within ${Math.round(opts.lookupTimeoutMs / 1000)} s. Nothing was imported; try again later.`,
    );
  }
  if (!found.length) throw new ToolError(`Zotero's translators found nothing for ${label(id)}. Nothing was imported.`);

  // 2. Save, recording the change as soon as the top-level items exist.
  const deadline = Date.now() + opts.attachmentTimeoutMs;
  const recorded = new Map<string, SavedObject>();
  const arrived: SavedObject[] = []; // attachments reported by the save step, not yet recorded
  let top: SavedObject[] = [];
  let changeId!: Promise<string>;
  let downloads!: Promise<unknown>;
  const saved = new Promise<void>((resolveSaved, rejectSaved) => {
    const onSaved = (objects: SavedObject[]) => {
      top = objects.filter((o) => o.parentKey === undefined);
      for (const o of objects) recorded.set(o.key, o);
      const items = top;
      const first = items[0];
      const summary =
        `Imported ${first ? `${first.key} "${first.title ?? ""}"` : "nothing"}` +
        (items.length > 1 ? ` (+${items.length - 1} more)` : "") +
        ` from ${label(id)}`;
      changeId = ports.record(objects, summary).catch(async (e) => {
        await ports.discard(objects.map((o) => o.key)).catch((d) => ports.log(`import_paper: discarding failed: ${describe(d)}`));
        throw e;
      });
      resolveSaved();
    };
    const done = ports.save(found as unknown[], onSaved, (a) => void arrived.push(a));
    done.then(
      () => resolveSaved(), // no-op once onSaved ran
      (e) => rejectSaved(e),
    );
    downloads = done;
  });
  try {
    await saved;
  } catch (e) {
    throw new ToolError(`Saving ${label(id)} failed: ${describe(e)}. Nothing was imported.`);
  }
  if (!top.length) throw new ToolError(`Zotero saved no items for ${label(id)}.`);
  const cid = await changeId;

  // 3. Attachments, then Find Available PDF; recorded as they appear.
  const childrenOf = (key: string) => [...recorded.values()].filter((o) => o.parentKey === key);
  const recordNew = async (extra: SavedObject[] = []) => {
    const fresh: SavedObject[] = [];
    for (const o of [...arrived.splice(0), ...extra]) {
      if (!recorded.has(o.key)) recorded.set(o.key, o), fresh.push(o);
    }
    if (!fresh.length) return;
    await ports.addLate(cid, fresh);
  };
  const rest = (async () => {
    await downloads.catch((e) => ports.log(`import_paper: attachment download failed: ${describe(e)}`));
    await recordNew();
    if (!opts.findPdf) return;
    for (const item of top) {
      if (item.kind !== "paper" || hasPrimary(childrenOf(item.key))) continue;
      const pdf = await ports.findPdf(item.key).catch((e) => {
        ports.log(`import_paper: Find Available PDF failed: ${describe(e)}`);
        return null;
      });
      await recordNew(pdf ? [pdf] : []);
    }
  })();
  rest.catch((e) => ports.log(`import_paper: recording attachments of ${cid} failed: ${describe(e)}`));
  const complete = (await within(rest, deadline - Date.now())) !== TIMED_OUT;

  const children = childrenOf(top[0].key);
  const attachments = children.filter((c) => c.kind === "attachment");
  const result: ImportResult = {
    changeId: cid,
    itemKey: top[0].key,
    itemKeys: top.map((t) => t.key),
    title: top[0].title ?? "",
    attachments,
    notes: children.filter((c) => c.kind === "note").map((c) => c.key),
    pdfAttachmentKey: attachments.find((a) => a.contentType && PRIMARY_TYPES.has(a.contentType))?.key ?? null,
    complete,
  };
  if (!complete) {
    result.message =
      `Attachments (PDF) were still downloading after ${Math.round(opts.attachmentTimeoutMs / 1000)} s. They continue in the ` +
      `background and are recorded under ${cid}; check get_item ${top[0].key} later.`;
  }
  return result;
}

function hasPrimary(children: SavedObject[]): boolean {
  return children.some((c) => c.kind === "attachment" && c.contentType !== undefined && PRIMARY_TYPES.has(c.contentType));
}
