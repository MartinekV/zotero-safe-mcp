// Page selection for read_pdf_text: parsing "1-3,7" and splitting Zotero's full text into pages.
import { ToolError } from "../registry/types";

/** JSON Schema pattern for the `pages` argument (parsePages gives the precise error). */
export const PAGES_PATTERN = "^[0-9 ,-]+$";

/** "2-4, 7" → [2, 3, 4, 7] (1-based, sorted, unique). Throws ToolError for bad input or pages > totalPages. */
export function parsePages(spec: string, totalPages: number): number[] {
  const pages = new Set<number>();
  const parts = spec.split(",").map((p) => p.trim());
  for (const part of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new ToolError(`Invalid pages "${spec}": use page numbers and ranges like "1-3,7"`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1) throw new ToolError(`Invalid pages "${spec}": page numbers start at 1`);
    if (to < from) throw new ToolError(`Invalid pages "${spec}": range ${part} is reversed`);
    if (to > totalPages) throw new ToolError(`Invalid pages "${spec}": the PDF has ${totalPages} pages`);
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Zotero's full text (PDF worker output / .zotero-ft-cache) separates pages with form feeds. */
export function splitPages(text: string): string[] {
  return text.split("\f").map((p) => p.trim());
}
