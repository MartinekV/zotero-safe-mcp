/* global Zotero, document, window, crypto */
// Settings pane script (runs in the preferences window).
var SafeMcpPane = {
  TOKEN_PREF: "extensions.zotero-safe-mcp.token",

  token() {
    return Zotero.Prefs.get(this.TOKEN_PREF, true) || "";
  },

  url() {
    const port = Zotero.Prefs.get("httpServer.port") || 23119;
    return `http://host.docker.internal:${port}/safe-mcp`;
  },

  command() {
    return `claude mcp add --transport http zotero ${this.url()} --header "Authorization: Bearer ${this.token()}"`;
  },

  init() {
    document.getElementById("safe-mcp-url").textContent = this.url();
    this.refresh();
  },

  refresh() {
    document.getElementById("safe-mcp-token").value = this.token();
    document.getElementById("safe-mcp-command").value = this.command();
  },

  status(text) {
    document.getElementById("safe-mcp-status").textContent = text;
  },

  copyToken() {
    Zotero.Utilities.Internal.copyTextToClipboard(this.token());
    this.status("Token copied.");
  },

  copyCommand() {
    Zotero.Utilities.Internal.copyTextToClipboard(this.command());
    this.status("Command copied.");
  },

  regenerate() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    Zotero.Prefs.set(this.TOKEN_PREF, token, true);
    this.refresh();
    this.status("New token saved. Agents using the old token are locked out until reconfigured.");
  },
};

// Pane scripts run in a sandbox, but inline onload/oncommand attributes are compiled in the
// preferences window's own scope, so the handlers must be reachable from there.
window.SafeMcpPane = SafeMcpPane;
