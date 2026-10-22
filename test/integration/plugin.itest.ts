import { describe, it, expect } from "vitest";
import { zeval, zotero } from "./harness";

describe("settings pane", () => {
  it("shows the token and a copyable claude mcp add command", async () => {
    const shown = await zeval(`
      const pane = Zotero.PreferencePanes.pluginPanes.find((p) => p.pluginID === "zotero-safe-mcp@martinekv.github.io");
      Zotero.Utilities.Internal.openPreferences(pane.id);
      let d;
      for (let i = 0; i < 50 && !d?.getElementById("safe-mcp-command")?.value; i++) {
        await Zotero.Promise.delay(100);
        d = Services.wm.getMostRecentWindow("zotero:pref")?.document;
      }
      d.getElementById("safe-mcp-copy-command").doCommand();
      const out = { token: d.getElementById("safe-mcp-token").value, command: d.getElementById("safe-mcp-command").value,
                    status: d.getElementById("safe-mcp-status").textContent };
      d.defaultView.close();
      return out;
    `);
    const { token, port } = zotero();
    expect(shown.token).toBe(token);
    expect(shown.command).toBe(
      `claude mcp add --transport http zotero http://host.docker.internal:${port}/safe-mcp --header "Authorization: Bearer ${token}"`,
    );
    expect(shown.status).toBe("Command copied.");
  });
});
