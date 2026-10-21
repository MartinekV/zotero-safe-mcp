/* global Zotero, Services, ChromeUtils, IOUtils, Cc, Ci */
// DEV/TEST ONLY. Exposes POST /safe-mcp-test/eval (Content-Type text/plain): the body is the body of an
// `async function (Zotero)`; the JSON of its return value is the response. NEVER install outside headless tests.
const EVAL_PATH = "/safe-mcp-test/eval";

function install() {}
function uninstall() {}

function startup() {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  function Eval() {}
  Eval.prototype = {
    supportedMethods: ["POST"],
    supportedDataTypes: ["text/plain"],
    init: async function (req) {
      try {
        const r = await new AsyncFunction("Zotero", "Services", "ChromeUtils", "IOUtils", "Cc", "Ci", req.data)(
          Zotero, Services, ChromeUtils, IOUtils, Cc, Ci,
        );
        return [200, "application/json", JSON.stringify(r === undefined ? null : r)];
      } catch (e) {
        return [500, "text/plain", String(e) + "\n" + (e && e.stack)];
      }
    },
  };
  Zotero.Server.Endpoints[EVAL_PATH] = Eval;
}

function shutdown() {
  delete Zotero.Server.Endpoints[EVAL_PATH];
}
