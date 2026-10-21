import { describe, it, expect } from "vitest";
import { sniffImage } from "../../src/images/imageFormat";
import { jpeg, PNG_1x1, png } from "./imageFixtures";

describe("sniffImage", () => {
  it("recognises a real 1x1 PNG by its bytes", () => {
    expect(sniffImage(PNG_1x1)).toEqual({ contentType: "image/png", width: 1, height: 1 });
  });

  it("reads PNG width and height from IHDR", () => {
    expect(sniffImage(png(640, 480))).toEqual({ contentType: "image/png", width: 640, height: 480 });
  });

  it("reads JPEG width and height from the SOF segment, skipping APP segments", () => {
    expect(sniffImage(jpeg(800, 600))).toEqual({ contentType: "image/jpeg", width: 800, height: 600 });
    expect(sniffImage(jpeg(1024, 768, { progressive: true }))).toEqual({ contentType: "image/jpeg", width: 1024, height: 768 });
  });

  it("swaps JPEG width and height when EXIF orientation rotates by 90 degrees (as browsers display it)", () => {
    expect(sniffImage(jpeg(800, 600, { orientation: 6 }))).toMatchObject({ width: 600, height: 800 });
    expect(sniffImage(jpeg(800, 600, { orientation: 8, littleEndian: true }))).toMatchObject({ width: 600, height: 800 });
    expect(sniffImage(jpeg(800, 600, { orientation: 3 }))).toMatchObject({ width: 800, height: 600 });
    expect(sniffImage(jpeg(800, 600, { orientation: 1, littleEndian: true }))).toMatchObject({ width: 800, height: 600 });
  });

  it("rejects other formats, truncated headers and empty input", () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
    const pdf = new TextEncoder().encode("%PDF-1.7\n");
    expect(sniffImage(gif)).toBeNull();
    expect(sniffImage(pdf)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(png(10, 10).subarray(0, 20))).toBeNull();
    expect(sniffImage(jpeg(10, 10).subarray(0, 25))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffImage(png(0, 10))).toBeNull();
  });
});
