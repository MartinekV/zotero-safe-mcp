import { describe, it, expect } from "vitest";
import { isItemKey, pdfUrl } from "../../src/pdf/attachmentKey";

describe("isItemKey", () => {
  it("accepts exactly 8 upper-case letters or digits", () => {
    expect(isItemKey("ABCD1234")).toBe(true);
    expect(isItemKey("abcd1234")).toBe(false);
    expect(isItemKey("ABCD123")).toBe(false);
    expect(isItemKey("ABCD12345")).toBe(false);
    expect(isItemKey("..%2F..%2F")).toBe(false);
    expect(isItemKey("ABCD1234\n")).toBe(false);
    expect(isItemKey("ABCD/234")).toBe(false);
  });
});

describe("pdfUrl", () => {
  it("defaults to host.docker.internal on Zotero's HTTP port", () => {
    expect(pdfUrl("", 23119, "ABCD1234")).toBe("http://host.docker.internal:23119/safe-mcp/pdf/ABCD1234");
    expect(pdfUrl(undefined, 23207, "ABCD1234")).toBe("http://host.docker.internal:23207/safe-mcp/pdf/ABCD1234");
  });

  it("uses the configured base URL, ignoring a trailing slash", () => {
    expect(pdfUrl("http://localhost:23119/", 23119, "ABCD1234")).toBe("http://localhost:23119/safe-mcp/pdf/ABCD1234");
  });
});
