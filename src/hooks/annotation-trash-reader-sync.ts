// Zotero's reader removes annotations live only when they are erased, not when they are moved to the
// trash (notes/06-annotations.md). We trash highlights (add_highlight undo, trash), so on every `trash`
// event for an annotation, tell open readers of its attachment to drop it. Restoring fires `modify`,
// which the reader already handles.
import { env } from "../env";
import { LifecycleHook } from "../registry/types";

let observerID: string | undefined;

async function unsetInReaders(ids: number[]): Promise<void> {
  const byAttachment = new Map<number, string[]>();
  for (const id of ids) {
    const item = Zotero.Items.get(id) as Zotero.Item | false;
    if (!item || !item.isAnnotation() || !item.parentItemID) continue;
    byAttachment.set(item.parentItemID, [...(byAttachment.get(item.parentItemID) ?? []), item.key]);
  }
  if (!byAttachment.size) return;
  for (const reader of ((Zotero.Reader as any)._readers ?? []) as any[]) {
    const keys = byAttachment.get(reader.itemID);
    if (!keys) continue;
    try {
      await reader.unsetAnnotations(keys);
    } catch (e) {
      env.log(`could not remove trashed annotations from an open reader: ${e}`);
    }
  }
}

const hook: LifecycleHook = {
  name: "annotation-trash-reader-sync",
  startup() {
    if (observerID || !(globalThis as any).Zotero?.Notifier) return;
    observerID = Zotero.Notifier.registerObserver(
      {
        notify(event: string, type: string, ids: (number | string)[]) {
          if (event === "trash" && type === "item") void unsetInReaders(ids as number[]);
        },
      } as any,
      ["item"],
      "safe-mcp-annotation-trash",
    );
  },
  shutdown() {
    if (observerID) Zotero.Notifier.unregisterObserver(observerID);
    observerID = undefined;
  },
};
export default hook;
