import { describe, expect, it } from "vitest";
import { HIGHLIGHT_COLOR_NAMES, resolveHighlightColor } from "../../src/highlight/color";
import { ToolError } from "../../src/registry/types";

// Zotero 10.0.6 Zotero.Annotations.COLORS (notes/06-annotations.md).
const ZOTERO_COLORS = [
  ["general-yellow", "#ffd400"],
  ["general-red", "#ff6666"],
  ["general-green", "#5fb236"],
  ["general-blue", "#2ea8e5"],
  ["general-purple", "#a28ae5"],
  ["general-magenta", "#e56eee"],
  ["general-orange", "#f19837"],
  ["general-gray", "#aaaaaa"],
];

describe("highlight color rule (SPEC Hard rule 2)", () => {
  it("maps every allowed name to Zotero's hex", () => {
    const expected: Record<string, string> = {
      yellow: "#ffd400",
      red: "#ff6666",
      blue: "#2ea8e5",
      purple: "#a28ae5",
      magenta: "#e56eee",
      orange: "#f19837",
      gray: "#aaaaaa",
    };
    expect([...HIGHLIGHT_COLOR_NAMES].sort()).toEqual(Object.keys(expected).sort());
    for (const [name, hex] of Object.entries(expected)) expect(resolveHighlightColor(name, ZOTERO_COLORS)).toBe(hex);
  });

  it("defaults to yellow", () => {
    expect(resolveHighlightColor(undefined, ZOTERO_COLORS)).toBe("#ffd400");
  });

  it("ignores case and surrounding spaces", () => {
    expect(resolveHighlightColor("Blue", ZOTERO_COLORS)).toBe("#2ea8e5");
    expect(resolveHighlightColor(" ORANGE ", ZOTERO_COLORS)).toBe("#f19837");
  });

  it("rejects green in any case, saying it is reserved for the user", () => {
    for (const c of ["green", "Green", "GREEN"]) {
      expect(() => resolveHighlightColor(c, ZOTERO_COLORS)).toThrow(ToolError);
      expect(() => resolveHighlightColor(c, ZOTERO_COLORS)).toThrow(/reserved/);
    }
  });

  it("rejects hex codes, including the hex of an allowed color and of green", () => {
    for (const c of ["#ffd400", "#FFD400", "ffd400", "#5fb236", "#fff"]) {
      expect(() => resolveHighlightColor(c, ZOTERO_COLORS)).toThrow(/named color/);
    }
  });

  it("rejects unknown names and the empty string", () => {
    for (const c of ["pink", "", "grey ", "black"]) expect(() => resolveHighlightColor(c, ZOTERO_COLORS)).toThrow(ToolError);
  });

  it("refuses a name Zotero's palette no longer has instead of guessing a hex", () => {
    const withoutGray = ZOTERO_COLORS.filter(([k]) => k !== "general-gray");
    expect(() => resolveHighlightColor("gray", withoutGray)).toThrow(ToolError);
  });

  it("follows a palette change in Zotero (hex read at runtime)", () => {
    const changed = ZOTERO_COLORS.map(([k, h]) => (k === "general-red" ? [k, "#ee0000"] : [k, h]));
    expect(resolveHighlightColor("red", changed)).toBe("#ee0000");
  });
});
