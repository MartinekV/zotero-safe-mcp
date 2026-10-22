// Builds build/addon/ (unpacked plugin, usable directly by the headless test harness)
// and zotero-safe-mcp.xpi (zip of build/addon).
import { build } from "esbuild";
import { zipSync } from "fflate";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build", "addon");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const config = readFileSync(join(root, "src", "config.ts"), "utf8");
const pluginId = /PLUGIN_ID = "([^"]+)"/.exec(config)[1];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "addon"), out, { recursive: true });
const manifestPath = join(out, "manifest.json");
writeFileSync(
  manifestPath,
  readFileSync(manifestPath, "utf8").replace("__VERSION__", pkg.version).replace("__PLUGIN_ID__", pluginId),
);
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

await build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  format: "iife",
  globalName: "SafeMcp",
  target: "firefox115",
  outfile: join(out, "content", "safe-mcp.js"),
  banner: { js: "// zotero-safe-mcp (AGPL-3.0-or-later). Includes code adapted from llm-for-zotero (AGPL-3.0)." },
  logLevel: "warning",
});

const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files[relative(out, p).split("\\").join("/")] = readFileSync(p);
  }
})(out);
writeFileSync(join(root, "zotero-safe-mcp.xpi"), zipSync(files, { level: 9 }));

// Zotero checks the manifest's update_url (the latest GitHub release's updates.json) for new versions.
const releases = "https://github.com/MartinekV/zotero-safe-mcp/releases";
const updates = {
  addons: {
    [pluginId]: {
      updates: [
        {
          version: pkg.version,
          update_link: `${releases}/download/v${pkg.version}/zotero-safe-mcp.xpi`,
          applications: { zotero: { strict_min_version: "7.0" } },
        },
      ],
    },
  },
};
writeFileSync(join(root, "updates.json"), JSON.stringify(updates, null, 2) + "\n");
console.log(`built zotero-safe-mcp.xpi (${Object.keys(files).length} files), updates.json and build/addon/`);
