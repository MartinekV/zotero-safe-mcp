import { describe, expect, it } from "vitest";
import { hasPdfHeader } from "../../src/pdf/pdfHeader";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("hasPdfHeader", () => {
  it("accepts %PDF- at the start, or after a little leading junk as PDF readers do", () => {
    expect(hasPdfHeader(bytes("%PDF-1.7\n..."))).toBe(true);
    expect(hasPdfHeader(bytes("﻿junk%PDF-1.4"))).toBe(true);
  });

  it("rejects anything else", () => {
    expect(hasPdfHeader(bytes("not a pdf"))).toBe(false);
    expect(hasPdfHeader(bytes("%PDF"))).toBe(false);
    expect(hasPdfHeader(bytes(""))).toBe(false);
    expect(hasPdfHeader(bytes("x".repeat(1100) + "%PDF-1.7"))).toBe(false);
  });
});
