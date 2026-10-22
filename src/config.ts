// Plugin-wide constants. Must match addon/manifest.json and addon/prefs.js.
export const PLUGIN_ID = "zotero-safe-mcp@martinekv.github.io";
export const PLUGIN_NAME = "zotero-safe-mcp";
export const PREF_PREFIX = "extensions.zotero-safe-mcp.";
export const TOKEN_PREF = `${PREF_PREFIX}token`;
export const MCP_PATH = "/safe-mcp";
/** GET <PDF_PATH_PREFIX><attachmentKey> streams a PDF attachment. */
export const PDF_PATH_PREFIX = `${MCP_PATH}/pdf/`;
/** Base URL get_pdf_url puts in front of the PDF path; empty = http://host.docker.internal:<Zotero port>. */
export const PDF_URL_BASE_PREF = `${PREF_PREFIX}pdfUrlBase`;
/** Zotero's own pref for its HTTP server port, and that port's default. */
export const ZOTERO_PORT_PREF = "httpServer.port";
export const DEFAULT_ZOTERO_PORT = 23119;
/** Item and collection keys as Zotero makes them (and the only form tool arguments accept). */
export const KEY_PATTERN = "^[A-Z0-9]{8}$";
/** Prefix of every line the plugin writes to Zotero's debug output. */
export const LOG_PREFIX = "[safe-mcp]";
/** Write tool calls allowed per minute (SPEC: Rate limit). */
export const WRITES_PER_MINUTE_PREF = `${PREF_PREFIX}writesPerMinute`;
export const DEFAULT_WRITES_PER_MINUTE = 30;
/** Tag put on every note the plugin creates (SPEC Hard rule 3). */
export const LLM_TAG = "[LLM]";
/** POST an image (PNG/JPEG bytes) here to use it in a note as ![caption](image:<imageId>). */
export const IMAGE_PATH = `${MCP_PATH}/image`;
