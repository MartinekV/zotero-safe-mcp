// The plugin's one change log, on Zotero.DB (with safe-mcp.sqlite attached by hooks/change-log-db.ts)
// and the undo handlers in src/undo/. Created on first use, so importing this needs no Zotero.
import { env } from "../env";
import undoHandlers from "../undo/index.generated";
import { createChangeLog, type ChangeLog } from "./changeLog";

let instance: ChangeLog | undefined;

export function changeLog(): ChangeLog {
  return (instance ??= createChangeLog({ db: Zotero.DB as any, undoHandlers, log: (m) => env.log(m) }));
}
