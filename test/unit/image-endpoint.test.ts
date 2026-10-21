import { describe, it, expect, vi } from "vitest";
import { createImageUploadHandler } from "../../src/endpoints/image";
import { createImageUploads } from "../../src/images/uploads";
import { HttpRequest } from "../../src/registry/types";
import { jpeg, PNG_1x1, png } from "./imageFixtures";

/** A fake nsIInputStream: the handler only passes it to readBody. */
const stream = (bytes: Uint8Array) => ({ bytes });
const readBody = vi.fn((s: any, max: number) => (s.bytes as Uint8Array).subarray(0, max));

function req(bytes: Uint8Array | null, headers: Record<string, string> = {}): HttpRequest {
  return {
    method: "POST",
    pathname: "/safe-mcp/image",
    headers: {
      "content-type": "image/png",
      ...(bytes ? { "content-length": String(bytes.length) } : {}),
      ...headers,
    },
    data: bytes ? stream(bytes) : null,
  };
}

function setup(limits = {}) {
  readBody.mockClear();
  const uploads = createImageUploads({ maxImageBytes: 1000, maxTotalBytes: 3000, maxCount: 2, ttlMs: 60_000, ...limits });
  return { uploads, handler: createImageUploadHandler({ uploads: () => uploads, readBody }) };
}

const json = (res: { body?: string }) => JSON.parse(res.body!);

describe("POST /safe-mcp/image handler", () => {
  it("stores a PNG and answers with its imageId, size and the Markdown to use", async () => {
    const { uploads, handler } = setup();
    const res = await handler(req(PNG_1x1));
    expect(res.status).toBe(200);
    const body = json(res);
    expect(body).toMatchObject({ contentType: "image/png", width: 1, height: 1, bytes: PNG_1x1.length });
    expect(body.markdown).toBe(`![caption](image:${body.imageId})`);
    expect(uploads.get(body.imageId)?.bytes).toEqual(PNG_1x1);
  });

  it("accepts a JPEG sent as image/jpeg or application/octet-stream", async () => {
    const { handler } = setup();
    expect(json(await handler(req(jpeg(30, 20), { "content-type": "image/jpeg" })))).toMatchObject({ contentType: "image/jpeg", width: 30, height: 20 });
    expect((await handler(req(jpeg(30, 20), { "content-type": "application/octet-stream" }))).status).toBe(200);
  });

  it("answers 413 without reading the body when Content-Length is over the limit", async () => {
    const { handler } = setup();
    const res = await handler(req(png(1, 1), { "content-length": "1001" }));
    expect(res.status).toBe(413);
    expect(json(res).error).toMatch(/larger than/);
    expect(readBody).not.toHaveBeenCalled();
  });

  it("never reads more than the limit, even if the body is longer than announced", async () => {
    const { uploads, handler } = setup();
    const res = await handler(req(png(1, 1, 2000), { "content-length": "100" }));
    expect(res.status).toBe(413);
    expect(readBody).toHaveBeenCalledWith(expect.anything(), 1001);
    expect(uploads.stats().count).toBe(0);
  });

  it("answers 415 for bytes that are not a PNG/JPEG, or don't match the declared type", async () => {
    const { uploads, handler } = setup();
    const gif = new TextEncoder().encode("GIF89a\x01\x00\x01\x00");
    expect((await handler(req(gif))).status).toBe(415);
    const mismatch = await handler(req(jpeg(3, 3), { "content-type": "image/png" }));
    expect(mismatch.status).toBe(415);
    expect(json(mismatch).error).toMatch(/image\/jpeg/);
    expect(uploads.stats().count).toBe(0);
  });

  it("answers 415 when there is no body stream (no or unsupported Content-Type)", async () => {
    const { handler } = setup();
    const res = await handler({ ...req(null), headers: { "content-length": "10" } });
    expect(res.status).toBe(415);
    expect(json(res).error).toMatch(/Content-Type: image\/png/);
  });

  it("answers 429 with Retry-After once the upload caps are reached, before reading the body", async () => {
    const { handler } = setup();
    expect((await handler(req(png(1, 1)))).status).toBe(200);
    expect((await handler(req(png(1, 1)))).status).toBe(200);
    readBody.mockClear();
    const res = await handler(req(png(1, 1)));
    expect(res.status).toBe(429);
    expect(Number(res.headers?.["Retry-After"])).toBeGreaterThan(0);
    expect(json(res).error).toMatch(/Too many unused uploads/);
    expect(readBody).not.toHaveBeenCalled();
  });
});
