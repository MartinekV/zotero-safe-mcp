# Contributing

## Layout

```
addon/                    static plugin files, copied into the .xpi as-is
  manifest.json           __VERSION__/__PLUGIN_ID__ filled in by the build
  bootstrap.js            loads content/safe-mcp.js and calls SafeMcp.startup/shutdown
  prefs.js                default prefs (extensions.zotero-safe-mcp.*)
  prefs.xhtml, prefs-pane.js   settings pane (token, copy buttons)
src/
  index.ts                bundle entry (esbuild iife → global SafeMcp)
  plugin.ts               lifecycle: token, endpoints, pane, hooks; startup/shutdown
  config.ts               plugin id, pref names, paths
  env.ts                  runtime facts set at startup (version, rootURI, log)
  registry/types.ts       ToolDef, EndpointDef, LifecycleHook, ToolError, HttpRequest/Response
  registry/tools.ts       tool registry: list, validate, dispatch, errors → isError (the ONE place)
  registry/schema.ts      small JSON Schema validator for tool arguments
  http/protect.ts         Origin → 403, bearer token → 401, exceptions → JSON 500 (every endpoint)
  http/zoteroEndpoint.ts  adapter to Zotero.Server.Endpoints classes
  mcp/                    JSON-RPC / MCP handling for POST /safe-mcp
  tools/*.ts              one file per MCP tool            ┐ auto-registered: scripts/gen-index.mjs
  endpoints/*.ts          one file per HTTP endpoint       │ writes <dir>/index.generated.ts
  hooks/*.ts              startup/shutdown hooks           │ (gitignored; files named _* are skipped)
  undo/*.ts               one undo handler per change kind ┘
  changes/                change log + ownership registry (safe-mcp.sqlite attached to Zotero.DB), trash helpers
  ownership/              pure ownership checks, write rate limiter
  images/                 POST /safe-mcp/image uploads: PNG/JPEG sniffing + size, in-memory store with caps
  notes/                  Markdown ↔ note HTML; zoteroLookups.ts = citation/image lookups for create/edit_note
                          noteVersions.ts = edit_note's version save/restore; zoteroNotes.ts = embedded images
                          (importEmbeddedImage without its own transaction, for use inside recordWrite)
test/unit/*.test.ts       vitest, plain Node, fake Zotero objects where needed
test/integration/         *.itest.ts against a real headless Zotero
scripts/                  build.mjs, gen-index.mjs, run-zotero-headless.sh
```

Nothing lists the tools or endpoints by hand. `npm run build`, `npm test` and `npm run typecheck`
regenerate the index files, so adding a file is enough and parallel branches don't conflict.
Put shared helpers in their own directory (e.g. `src/zotero/`, `src/ownership/`), not in `src/tools/`,
or name them with a leading `_`.

## Adding a tool

Create `src/tools/<tool_name>.ts`:

```ts
import { defineTool, ToolError } from "../registry/types";

export default defineTool<{ itemKey: string }>({
  name: "get_item",
  description: "Metadata, attachments, child notes, tags and collections of one item.",
  write: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["itemKey"],
    properties: { itemKey: { type: "string", pattern: "^[A-Z0-9]{8}$" } },
  },
  async handler({ itemKey }, ctx) {
    const item = Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, itemKey);
    if (!item) throw new ToolError(`No item with key ${itemKey}`);
    return { key: item.key, title: item.getField("title") };
  },
});
```

- Arguments are validated against `inputSchema` before `handler` runs; invalid arguments become an
  `isError` result listing the problems. The keywords supported are listed in `JsonSchema`
  (`registry/types.ts`); extend `registry/schema.ts` if you need more.
- Return any JSON value. Objects are sent as pretty-printed JSON text plus `structuredContent`;
  strings are sent as-is.
- Throw `ToolError("message for the agent")` for expected failures. Anything else thrown (including
  Zotero's bare-string rejections) also becomes an `isError` result and is logged to Zotero's debug output.
- `write: true` marks tools that change the library: read-only hint off, and `registry/tools.ts` `call`
  applies the write rate limit (pref `writesPerMinute`, default 30, checked before the handler so a
  refused call has no side effects) and runs write tools one at a time. See "Adding a write tool".
- Unit-test pure logic in `test/unit/<tool_name>.test.ts`; test the tool end to end in
  `test/integration/<tool_name>.itest.ts`.

## Adding a write tool

Every change to the library goes through `changeLog().recordWrite` (`src/changes/index.ts`), which runs
your body and records the change in ONE DB transaction with the Zotero saves: a throw anywhere rolls back
both, so a failed call leaves neither items nor registry rows behind.

```ts
import { changeLog } from "../changes";
import { requireOwned } from "../ownership/checks";

async handler(args) {
  const L = libraryID();
  // 1. Check everything first (ownership, existence) and throw ToolError: nothing written yet.
  requireOwned([args.noteKey], await changeLog().ownedKeys(L, [args.noteKey]), "edit");
  // 2. Write inside recordWrite. Use item.save(), NEVER saveTx()/eraseTx()/Zotero.Items.trashTx()
  //    (nested transactions deadlock for 30 s) — and no other executeTransaction inside.
  const { changeId, result } = await changeLog().recordWrite({ tool: "edit_note", args }, async (w) => {
    w.saveNoteVersion({ libraryID: L, noteKey: note.key, html: note.getNote() }); // previous version
    note.setNote(html);
    await note.save();
    w.summary = `Edited note ${note.key}`;   // shown by list_changes
    return { noteKey: note.key };
  });
  return { changeId, ...result };            // every write returns its changeId
}
```

The `ChangeWriter` `w` (`src/changes/types.ts`) records, all with the change's `changeId`:
`ownObject({ libraryID, itemKey, kind })` for every object created (notes, highlights, papers, their
attachments), `ownTag` for each (item, tag) pair newly added (use `splitNewTags` from
`ownership/checks.ts`: pairs that already existed are never recorded), `disownTag` when a pair is removed
again, `saveNoteVersion` for the HTML before an edit, `data` for any other JSON the undo needs, and
`summary`. Ownership queries: `changeLog().isOwned`, `ownedKeys`, `ownedTags`; checks that throw a clear
`ToolError`: `requireOwned`, `requireOwnedTagPairs` (`src/ownership/checks.ts`). `byLLM` in read results
always comes from the registry, never from the `[LLM]` tag. Trash, never erase: `setDeleted` in
`src/changes/trash.ts`.

### Undo handlers

`undo` dispatches on the change's `kind` (defaults to the tool name; pass `kind` to `recordWrite` to
reuse another kind's handler) to the handler in `src/undo/<kind>.ts`, auto-registered like tools:

```ts
import type { UndoHandler } from "../changes/types";
const handler: UndoHandler = {
  kind: "edit_note",
  async undo(change, ctx) {   // change: args, data, objects, tags, noteVersions recorded with it
    ...                       // inside the undo transaction: item.save() only; throw ToolError to refuse
    return "Restored note ABCD1234 to its previous version";
  },
};
export default handler;
```

The change log marks the change undone in the same transaction; a change is undone at most once, and
undo itself is not recorded as a change. `ctx.disownTag` forgets a pair (do this when undo removes a
tag, so a user adding it again later owns it). For changes that only created objects,
`trashCreatedObjects` (`src/undo/create_note.ts`) trashes everything in `change.objects`.
Unit-test changes against a real SQLite with `test/unit/sqliteDb.ts` (see `change-log.test.ts`).

## Adding an HTTP endpoint

Create `src/endpoints/<name>.ts` default-exporting an `EndpointDef`
(`{ path, methods, dataTypes, handler }`, see `src/endpoints/mcp.ts`). `plugin.ts` wraps every
endpoint in `protect()` (Origin, token, exception checks), registers it at startup and removes it at
shutdown. Paths may use `:param` segments (`/safe-mcp/pdf/:key` → `req.pathParams.key`). Zotero quirks
to know (details in the exploration notes):

- Zotero itself answers 400 for methods or content types not in `methods`/`dataTypes`, and for
  invalid JSON before the handler runs. It drops browser requests (UA `Mozilla/…` or any `Origin`)
  without a reply. Never set `allowRequestsFromUnsafeWebContent`.
- `application/json` arrives parsed in `req.data`; other types arrive as an `nsIInputStream`.
- Reason phrases for 202/401/405/413/415/429 are added by `plugin.ts`.
- String bodies are sent UTF-8 encoded. To send a file's raw bytes, return an empty body with the real
  `Content-Length` and `options: { [FILE_PATH_OPTION]: path }` (`src/http/binaryFileResponse.ts`); the patch
  installed by `hooks/binary-file-responses.ts` only acts on paths under `/safe-mcp/pdf/` (widen `pathPrefix` there).

## Adding startup/shutdown work

Create `src/hooks/<name>.ts` default-exporting a `LifecycleHook` (`{ name, startup?, shutdown? }`).
Hooks start in file-name order after the token exists and before endpoints are registered. They shut
down in reverse order on disable, uninstall, upgrade and app quit. Shutdown must be idempotent and must
undo everything (DB handles, monkeypatches, notifier observers): Zotero keeps running after a disable.

## Integration tests (headless Zotero)

`npm run test:integration` builds the plugin, starts ONE headless Zotero 10.0.6 (Xvfb, fresh profile
and data dir) with `build/addon` plus the dev-only eval plugin (`test/integration/dev-eval-plugin`,
which serves `POST /safe-mcp-test/eval`), runs `test/integration/*.itest.ts` one file at a time, then stops it.

| Env | Default | Meaning |
|---|---|---|
| `ZBASE` | `<repo>/.zotero-headless` | instance dir (profile, data, log). One instance per ZBASE. |
| `ZPORT` | `23300` | HTTP port of the instance |
| `ZOTERO_APP` | — | existing extracted Zotero app dir to symlink as `$ZBASE/app` |
| `KEEP_ZOTERO` | — | `1` leaves the instance running after the tests |

First time on a machine: `scripts/run-zotero-headless.sh install` (apt deps + download), or set
`ZOTERO_APP`. Run parallel instances with different `ZBASE` and `ZPORT`; `run-zotero-headless.sh stop`
only stops the instance of its own `ZBASE`. Debug log: `$(scripts/run-zotero-headless.sh log)`.

In tests, use `test/integration/harness.ts`:

```ts
import { callTool, mcp, mcpRaw, request, zeval, zotero } from "./harness";

const { key } = await zeval(`const i = new Zotero.Item("book"); i.setField("title", "T"); await i.saveTx(); return { key: i.key };`);
const result = await callTool("get_item", { itemKey: key });
```

Global setup raises the write rate limit pref (`INTEGRATION_WRITES_PER_MINUTE`) because all files share
one instance and one rate-limit window; a test that lowers it must restore it. To disable/re-enable the
plugin use `setPluginEnabled` (it waits for the async startup). Everything goes to `127.0.0.1:$ZPORT`
through `node:http` (no proxy). Never point tests at
`host.docker.internal:23119`: that is the user's real library. Files share one library, so create the
data each test needs instead of relying on another file's leftovers.
