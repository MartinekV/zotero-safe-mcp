/* global Services, SafeMcp */
// Zotero bootstrap plugin entry. All logic lives in content/safe-mcp.js (built from src/).

function install(data, reason) {}

async function startup({ id, version, rootURI }, reason) {
  // Defines `SafeMcp` in this plugin's sandbox.
  Services.scriptloader.loadSubScript(rootURI + "content/safe-mcp.js");
  await SafeMcp.startup({ id, version, rootURI });
}

async function shutdown(data, reason) {
  // Also on APP_SHUTDOWN: cleanup must be complete (endpoints, patches, DB handles).
  if (typeof SafeMcp !== "undefined") await SafeMcp.shutdown();
}

function uninstall(data, reason) {}
