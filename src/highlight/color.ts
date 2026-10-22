// SPEC Hard rule 2: highlight colors are Zotero's named colors except green (reserved for the user).
// Hex codes are rejected. The hex comes from Zotero's palette at runtime, so a palette change is followed.
import { ToolError } from "../registry/types";

export const HIGHLIGHT_COLOR_NAMES = ["yellow", "red", "blue", "purple", "magenta", "orange", "gray"] as const;
export type HighlightColorName = (typeof HIGHLIGHT_COLOR_NAMES)[number];
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColorName = "yellow";

/** Zotero.Annotations.COLORS: [l10nKey like "general-yellow", lowercase hex]. */
export type Palette = readonly (readonly string[])[];

export function zoteroPalette(): Palette {
  return ((Zotero.Annotations as any).COLORS ?? []) as Palette;
}

/** The name of a palette color ("yellow", also "green"), or null for colors outside the palette. */
export function colorNameOf(hex: string | null, palette: Palette): string | null {
  const entry = palette.find(([, h]) => h === hex);
  return entry ? entry[0].replace(/^general-/, "") : null;
}

/** The hex for a color name (default yellow), or ToolError for green, hex codes and unknown names. */
export function resolveHighlightColor(color: string | undefined, palette: Palette): string {
  const allowed = HIGHLIGHT_COLOR_NAMES.join(", ");
  const name = (color ?? DEFAULT_HIGHLIGHT_COLOR).trim().toLowerCase();
  if (name === "green") throw new ToolError(`Green is reserved for the user's own highlights. Use one of: ${allowed}.`);
  if (/^#?[0-9a-f]{3,8}$/.test(name) && !(HIGHLIGHT_COLOR_NAMES as readonly string[]).includes(name)) {
    throw new ToolError(`Hex colors are not accepted ("${color}"); give a named color: ${allowed}.`);
  }
  if (!(HIGHLIGHT_COLOR_NAMES as readonly string[]).includes(name)) {
    throw new ToolError(`Unknown color "${color}"; give a named color: ${allowed}.`);
  }
  const hex = palette.find(([key]) => key === `general-${name}`)?.[1];
  if (!hex || !/^#[0-9a-f]{6}$/.test(hex)) throw new ToolError(`This Zotero version has no "${name}" highlight color. Use one of: ${allowed}.`);
  return hex;
}
