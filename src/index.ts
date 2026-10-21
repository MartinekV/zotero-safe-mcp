// Bundle entry. esbuild wraps this as `var SafeMcp = …` (iife, globalName SafeMcp), which
// addon/bootstrap.js loads into the plugin sandbox and calls.
import { createPlugin, StartupInfo } from "./plugin";

let plugin: ReturnType<typeof createPlugin> | undefined;

export async function startup(info: StartupInfo): Promise<void> {
  await plugin?.shutdown();
  plugin = createPlugin({ zotero: Zotero });
  await plugin.startup(info);
}

export async function shutdown(): Promise<void> {
  await plugin?.shutdown();
  plugin = undefined;
}
