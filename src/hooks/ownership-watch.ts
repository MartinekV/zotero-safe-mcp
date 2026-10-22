// Keeps ownership in step with what the user does in Zotero while the plugin runs (SPEC Hard rule 1):
// - an owned (item, tag) pair removed by anything but the plugin is forgotten, so the user adding the
//   tag back later owns it (the plugin's own removals disown the pair in the same transaction);
// - an agent note saved with content other than what the agent last wrote is recorded as taken over
//   at once, so the user reverting the edit later doesn't hand it back.
// The checks tools make when they look (src/ownership/userEdits.ts) stay as the fallback for changes
// made while the plugin was disabled. Work runs after Zotero's commit, never inside notify().
import { changeLog } from "../changes";
import type { OwnedTag } from "../changes/types";
import { env } from "../env";
import { zoteroNoteReader } from "../notes/zoteroNotes";
import { userTakenKeys } from "../ownership/userEdits";
import type { LifecycleHook } from "../registry/types";
import { errorMessage } from "../util/errors";

let observerID: string | undefined;

function removedPairs(ids: string[], extraData: Record<string, any>): OwnedTag[] {
  const out: OwnedTag[] = [];
  for (const id of ids) {
    const tag = extraData?.[id]?.tag;
    const itemID = Number(String(id).split("-")[0]);
    const lk = (Zotero.Items as any).getLibraryAndKeyFromID(itemID) as { libraryID: number; key: string } | false;
    if (typeof tag === "string" && lk) out.push({ libraryID: lk.libraryID, itemKey: lk.key, tag });
  }
  return out;
}

async function noticeNoteEdits(ids: number[]): Promise<void> {
  const byLibrary = new Map<number, string[]>();
  for (const id of ids) {
    const item = Zotero.Items.get(id) as Zotero.Item | false;
    if (item && item.isNote()) byLibrary.set(item.libraryID, [...(byLibrary.get(item.libraryID) ?? []), item.key]);
  }
  // In a transaction, so a plugin write can't land between reading the agent's HTML and the note's.
  for (const [libraryID, keys] of byLibrary) {
    await Zotero.DB.executeTransaction(() => userTakenKeys(changeLog(), zoteroNoteReader, libraryID, keys));
  }
}

const hook: LifecycleHook = {
  name: "ownership-watch",
  startup() {
    if (observerID || !(globalThis as any).Zotero?.Notifier) return;
    observerID = Zotero.Notifier.registerObserver(
      {
        notify(event: string, type: string, ids: (number | string)[], extraData: Record<string, any>) {
          const at = Date.now();
          let work: Promise<void> | undefined;
          if (type === "item-tag" && event === "remove") {
            const pairs = removedPairs(ids as string[], extraData);
            if (pairs.length) work = changeLog().disownRemovedTags(pairs, at);
          } else if (type === "item" && event === "modify") {
            work = noticeNoteEdits(ids as number[]);
          }
          work?.catch((e) => env.log(`ownership-watch: ${errorMessage(e)}`));
        },
      } as any,
      ["item", "item-tag"],
      "safe-mcp-ownership-watch",
    );
  },
  shutdown() {
    if (observerID) Zotero.Notifier.unregisterObserver(observerID);
    observerID = undefined;
  },
};
export default hook;
