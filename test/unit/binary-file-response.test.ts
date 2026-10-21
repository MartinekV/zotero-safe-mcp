import { describe, it, expect, vi } from "vitest";
import { FILE_PATH_OPTION, patchRequestFinished } from "../../src/http/binaryFileResponse";

/** A stand-in for Zotero.Server.RequestHandler.prototype with the original text-only _requestFinished. */
function fakeProto() {
  const sentText: string[] = [];
  const proto: any = {
    _requestFinished(this: any, body: string) {
      sentText.push(body);
    },
  };
  return { proto, sentText, original: proto._requestFinished };
}

function handler(proto: any, pathname: string) {
  const h = Object.create(proto);
  h.pathname = pathname;
  h.response = { name: "response" };
  return h;
}

const HEAD = "HTTP/1.0 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 42\r\nContent-Length: 0\r\n\r\n";

describe("patchRequestFinished", () => {
  it("streams the file for our path, replacing the empty-body terminator", () => {
    const { proto, sentText } = fakeProto();
    const sendFile = vi.fn();
    patchRequestFinished(proto, { pathPrefix: "/safe-mcp/pdf/", sendFile });

    handler(proto, "/safe-mcp/pdf/ABCD1234")._requestFinished(HEAD, { [FILE_PATH_OPTION]: "/data/a.pdf" });

    expect(sentText).toEqual([]);
    expect(sendFile).toHaveBeenCalledWith(
      { name: "response" },
      "HTTP/1.0 200 OK\r\nContent-Type: application/pdf\r\nContent-Length: 42\r\n\r\n",
      "/data/a.pdf",
    );
  });

  it("sends only once per request", () => {
    const { proto } = fakeProto();
    const sendFile = vi.fn();
    patchRequestFinished(proto, { pathPrefix: "/safe-mcp/pdf/", sendFile });
    const h = handler(proto, "/safe-mcp/pdf/ABCD1234");
    h._requestFinished(HEAD, { [FILE_PATH_OPTION]: "/a" });
    h._requestFinished(HEAD, { [FILE_PATH_OPTION]: "/a" });
    expect(sendFile).toHaveBeenCalledTimes(1);
  });

  it("leaves every other response to Zotero, even one carrying the option on another path", () => {
    const { proto, sentText } = fakeProto();
    const sendFile = vi.fn();
    patchRequestFinished(proto, { pathPrefix: "/safe-mcp/pdf/", sendFile });

    handler(proto, "/safe-mcp")._requestFinished("json");
    handler(proto, "/connector/ping")._requestFinished("ping", { logFilter: () => "" });
    handler(proto, "/other/pdf/X")._requestFinished("other", { [FILE_PATH_OPTION]: "/etc/passwd" });

    expect(sendFile).not.toHaveBeenCalled();
    expect(sentText).toEqual(["json", "ping", "other"]);
  });

  it("restores the original on unpatch", () => {
    const { proto, original } = fakeProto();
    const unpatch = patchRequestFinished(proto, { pathPrefix: "/safe-mcp/pdf/", sendFile: vi.fn() });
    expect(proto._requestFinished).not.toBe(original);
    unpatch();
    expect(proto._requestFinished).toBe(original);
    unpatch(); // idempotent
    expect(proto._requestFinished).toBe(original);
  });

  it("does not drop a later wrapper on unpatch; our layer just becomes a pass-through", () => {
    const { proto, original, sentText } = fakeProto();
    const sendFile = vi.fn();
    const unpatch = patchRequestFinished(proto, { pathPrefix: "/safe-mcp/pdf/", sendFile });
    const ours = proto._requestFinished;
    const theirs = function (this: any, ...args: any[]) {
      return ours.apply(this, args);
    };
    proto._requestFinished = theirs;

    unpatch();
    expect(proto._requestFinished).toBe(theirs);
    handler(proto, "/safe-mcp/pdf/ABCD1234")._requestFinished(HEAD, { [FILE_PATH_OPTION]: "/a" });
    expect(sendFile).not.toHaveBeenCalled();
    expect(sentText).toEqual([HEAD]);
    expect(original).toBeTypeOf("function");
  });
});
