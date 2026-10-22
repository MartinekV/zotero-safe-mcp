import { describe, it, expect, vi } from "vitest";
import { createPdfHandler } from "../../src/endpoints/pdf";
import { FILE_PATH_OPTION } from "../../src/http/binaryFileResponse";
import { HttpRequest, ToolError } from "../../src/registry/types";

const req = (key: string): HttpRequest => ({
  method: "GET",
  pathname: `/safe-mcp/pdf/${key}`,
  pathParams: { key },
  headers: {},
  data: null,
});

describe("GET /safe-mcp/pdf/:key handler", () => {
  it("answers 400 for a malformed key without looking anything up", async () => {
    const lookup = vi.fn();
    const handler = createPdfHandler(lookup);
    for (const key of ["abcd1234", "..", "ABCD1234.pdf", "%2E%2E%2Fetc"]) {
      const res = await handler(req(key));
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body!).error).toMatch(/8 characters/);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("answers 404 with the lookup's message for unknown items, non-PDFs and missing files", async () => {
    const handler = createPdfHandler(async () => {
      throw new ToolError("Attachment ABCD1234 is not a PDF");
    });
    const res = await handler(req("ABCD1234"));
    expect(res.status).toBe(404);
    expect(res.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body!)).toEqual({ error: "Attachment ABCD1234 is not a PDF" });
  });

  it("lets unexpected errors through (protect() turns them into a JSON 500)", async () => {
    const handler = createPdfHandler(async () => {
      throw new Error("db closed");
    });
    await expect(handler(req("ABCD1234"))).rejects.toThrow("db closed");
  });

  it("answers 200 with PDF headers and asks for the file to be streamed", async () => {
    const handler = createPdfHandler(async (key) => ({ path: `/storage/${key}/Paper “1”.pdf`, size: 1234 }));
    const res = await handler(req("ABCD1234"));
    expect(res).toEqual({
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": 1234,
        "Content-Disposition": 'attachment; filename="ABCD1234.pdf"',
      },
      body: "",
      options: { [FILE_PATH_OPTION]: "/storage/ABCD1234/Paper “1”.pdf" },
    });
  });
});
