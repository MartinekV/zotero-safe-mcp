// Runtime facts set once by plugin startup, readable from any module (tools, endpoints, hooks).
export const env = {
  /** Plugin version from manifest.json. */
  version: "0.0.0",
  /** "jar:file:///…/zotero-safe-mcp.xpi!/" or "file:///…/" for unpacked dev installs. */
  rootURI: "",
  /** Writes to Zotero's debug output, prefixed with [safe-mcp]. */
  log: (_message: string): void => {},
};
