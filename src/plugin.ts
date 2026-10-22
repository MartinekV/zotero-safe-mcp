// Plugin lifecycle: token, endpoints, settings pane, lifecycle hooks. Called from addon/bootstrap.js
// through src/index.ts. Takes the Zotero object as a parameter so it can be unit-tested with a fake.
import { LOG_PREFIX, PLUGIN_ID, TOKEN_PREF } from "./config";
import defaultEndpoints from "./endpoints/index.generated";
import defaultHooks from "./hooks/index.generated";
import { env } from "./env";
import { protect } from "./http/protect";
import { toZoteroEndpoint } from "./http/zoteroEndpoint";
import { EndpointDef, LifecycleHook } from "./registry/types";

/** Reason phrases Zotero.Server.responseCodes lacks (it would send "401 undefined"). */
const EXTRA_RESPONSE_CODES: Record<number, string> = {
  202: "Accepted",
  401: "Unauthorized",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  429: "Too Many Requests",
};

export type StartupInfo = { id: string; version: string; rootURI: string };

export type PluginDeps = {
  zotero: typeof Zotero;
  endpoints?: EndpointDef[];
  hooks?: LifecycleHook[];
};

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createPlugin({ zotero, endpoints = defaultEndpoints, hooks = defaultHooks }: PluginDeps) {
  const Z = zotero as any;
  const log = (message: string) => Z.debug(`${LOG_PREFIX} ${message}`);
  const registered = new Map<string, unknown>();
  const addedCodes: number[] = [];
  const startedHooks: LifecycleHook[] = [];
  let paneID: string | undefined;

  function getToken(): string | undefined {
    return Z.Prefs.get(TOKEN_PREF, true) || undefined;
  }

  return {
    async startup(info: StartupInfo) {
      env.version = info.version;
      env.rootURI = info.rootURI;
      env.log = log;

      if (!getToken()) Z.Prefs.set(TOKEN_PREF, generateToken(), true);

      for (const [code, phrase] of Object.entries(EXTRA_RESPONSE_CODES)) {
        if (!(code in Z.Server.responseCodes)) {
          Z.Server.responseCodes[code] = phrase;
          addedCodes.push(Number(code));
        }
      }

      for (const hook of hooks) {
        await hook.startup?.();
        startedHooks.push(hook);
      }

      for (const def of endpoints) {
        const cls = toZoteroEndpoint(def, protect(def.handler, { getToken, log }));
        Z.Server.Endpoints[def.path] = cls;
        registered.set(def.path, cls);
      }

      if (Z.PreferencePanes) {
        paneID = await Z.PreferencePanes.register({
          pluginID: PLUGIN_ID,
          src: "prefs.xhtml",
          scripts: ["prefs-pane.js"],
          label: "Safe MCP",
        });
      }
      log(`started ${info.version}: ${[...registered.keys()].join(", ")}`);
    },

    async shutdown() {
      for (const [path, cls] of registered) {
        if (Z.Server.Endpoints[path] === cls) delete Z.Server.Endpoints[path];
      }
      registered.clear();

      if (paneID !== undefined) {
        try {
          Z.PreferencePanes.unregister(paneID);
        } catch (e) {
          log(`pane unregister failed: ${e}`);
        }
        paneID = undefined;
      }

      while (startedHooks.length) {
        const hook = startedHooks.pop()!;
        try {
          await hook.shutdown?.();
        } catch (e) {
          log(`hook ${hook.name} shutdown failed: ${e}`);
        }
      }

      for (const code of addedCodes.splice(0)) delete Z.Server.responseCodes[code];
    },
  };
}
