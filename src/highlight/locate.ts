// Adapted from llm-for-zotero (AGPL-3.0), src/services/pdf/pdfAnnotationResolver.ts@435dd19
// Finds a quoted passage in a PDF's glyph data and builds a Zotero highlight position from it.
// Differences from the original: works on pdf.js getPageData() output loaded in the main window (no
// reader tab is opened), finds passages that cross a page break (position.nextPageRects), leaves
// ignorable glyphs and glyphs without geometry out of the rects, and `occurrence` also works without
// `page` (document order). Rects and text follow the reader's getRectsFromChars / getTextFromChars
// (reader/src/pdf/selection.js), so the result is what a manual selection of the same glyphs gives.
import { ToolError } from "../registry/types";
import { buildQuoteTextIndex, findQuoteSourceSpansAllowingLayoutArtifacts } from "./quoteTextNormalization";

/** One glyph of pdf.js `getPageData({pageIndex}).chars` (Zotero's fork). Flags are present only when true. */
export type PdfChar = {
  c: string;
  rect: number[];
  inlineRect?: number[];
  ignorable?: boolean;
  spaceAfter?: boolean;
  lineBreakAfter?: boolean;
  paragraphBreakAfter?: boolean;
};
export type PdfPage = { chars: PdfChar[]; viewBox: number[] };
/** Pages are loaded on demand (0-based). */
export type PdfPages = { numPages: number; page(pageIndex: number): Promise<PdfPage> };

export type HighlightRequest = {
  text: string;
  /** 1-based page to search (the passage must start there). */
  page?: number;
  /** 1-based: which match to take, counted on `page` if given, else in document order. */
  occurrence?: number;
};

export type HighlightPosition = { pageIndex: number; rects: number[][]; nextPageRects?: number[][] };

export type LocatedHighlight = {
  position: HighlightPosition;
  sortIndex: string;
  /** The highlighted text as Zotero would store it for a manual selection of the same glyphs. */
  text: string;
  /** How many matches the search scope had (1 unless `occurrence` picked one). */
  matches: number;
};

type CharRef = { pageIndex: number; charIndex: number };
type Match = { start: CharRef; end: CharRef /* inclusive */ };

/** Page text for the matcher plus, for every UTF-16 unit, the glyph it came from. */
type Indexed = { text: string; refs: CharRef[] };

function indexChars(pageIndex: number, chars: PdfChar[], from = 0, to = chars.length): Indexed {
  let text = "";
  const refs: CharRef[] = [];
  for (let i = from; i < to; i++) {
    const ch = chars[i];
    if (ch.ignorable) continue;
    const value = ch.c + (ch.lineBreakAfter || ch.paragraphBreakAfter ? "\n" : ch.spaceAfter ? " " : "");
    text += value;
    for (let k = 0; k < value.length; k++) refs.push({ pageIndex, charIndex: i });
  }
  return { text, refs };
}

function concat(a: Indexed, b: Indexed): Indexed {
  return { text: `${a.text}\n${b.text}`, refs: [...a.refs, a.refs[a.refs.length - 1], ...b.refs] };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function spans(indexed: Indexed, quote: string): Match[] {
  if (!indexed.text) return [];
  const q = quote.trim();
  const trimStart = WORD_CHAR.test(q[0] ?? "");
  const trimEnd = WORD_CHAR.test(q[q.length - 1] ?? "");
  const t = indexed.text;
  return findQuoteSourceSpansAllowingLayoutArtifacts(buildQuoteTextIndex(t), quote).map((s) => {
    // The matcher widens spans to adjacent quote marks and punctuation; keep them only if quoted.
    let a = s.sourceStart;
    let b = s.sourceEnd;
    if (trimStart) while (a < b - 1 && !WORD_CHAR.test(t[a])) a++;
    if (trimEnd) while (b > a + 1 && !WORD_CHAR.test(t[b - 1])) b--;
    return { start: indexed.refs[a], end: indexed.refs[b - 1] };
  });
}

const validRect = (r: unknown): r is number[] =>
  Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) && r[2] > r[0] && r[3] > r[1];

/** Whether glyph rect `r` lies on the line `line`: at least half of it vertically, and not far to the side. */
function onLine(r: number[], line: number[]): boolean {
  const overlap = Math.min(r[3], line[3]) - Math.max(r[1], line[1]);
  const height = line[3] - line[1];
  return overlap >= 0.5 * (r[3] - r[1]) && r[0] <= line[2] + 2 * height && r[2] >= line[0] - 2 * height;
}

/**
 * reader getRectsFromChars, minus glyphs without usable geometry and ignorable glyphs that are not on
 * the line (a line-end hyphen is ignorable and stays covered, like in a manual selection).
 */
function rectsFromChars(chars: PdfChar[]): number[][] {
  const lines: number[][] = [];
  let cur: number[] | null = null;
  for (const ch of chars) {
    const r = ch.inlineRect ?? ch.rect;
    if (validRect(r) && (!ch.ignorable || (cur && onLine(r, cur)))) {
      cur = cur
        ? [Math.min(cur[0], r[0]), Math.min(cur[1], r[1]), Math.max(cur[2], r[2]), Math.max(cur[3], r[3])]
        : r.slice();
    }
    if (ch.lineBreakAfter && cur) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((r) => r.map((v) => parseFloat(v.toFixed(3))));
}

/** reader getTextFromChars. */
function textFromChars(chars: PdfChar[]): string {
  let s = "";
  for (const ch of chars) {
    if (ch.ignorable) continue;
    s += ch.c;
    if (ch.spaceAfter || ch.lineBreakAfter || ch.paragraphBreakAfter) s += " ";
  }
  return s.trim();
}

function sortIndex(pageIndex: number, offset: number, rects: number[][], viewBox: number[]): string {
  const topY = Math.max(...rects.map((r) => r[3]));
  const top = Math.max(0, Math.floor(viewBox[3] - viewBox[1] - topY));
  return [
    String(pageIndex).slice(0, 5).padStart(5, "0"),
    String(offset).slice(0, 6).padStart(6, "0"),
    String(top).slice(0, 5).padStart(5, "0"),
  ].join("|");
}

/** Characters of the neighbouring page searched for a passage crossing a page break. */
function crossWindow(quote: string): number {
  return Math.max(400, quote.length * 3);
}

async function findMatches(pdf: PdfPages, quote: string, pageIndexes: number[]): Promise<Match[]> {
  const out: Match[] = [];
  for (const p of pageIndexes) {
    const { chars } = await pdf.page(p);
    const onPage = spans(indexChars(p, chars), quote);
    let across: Match[] = [];
    if (p + 1 < pdf.numPages) {
      const next = (await pdf.page(p + 1)).chars;
      const w = crossWindow(quote);
      const tail = indexChars(p, chars, Math.max(0, chars.length - w));
      const head = indexChars(p + 1, next, 0, Math.min(next.length, w));
      if (tail.refs.length && head.refs.length) {
        across = spans(concat(tail, head), quote).filter((m) => m.start.pageIndex === p && m.end.pageIndex === p + 1);
      }
    }
    out.push(...[...onPage, ...across].sort((a, b) => a.start.charIndex - b.start.charIndex));
  }
  return out;
}

/** Splits glyphs into lines (at lineBreakAfter). */
function splitLines(chars: PdfChar[]): PdfChar[][] {
  const lines: PdfChar[][] = [];
  let cur: PdfChar[] = [];
  for (const ch of chars) {
    cur.push(ch);
    if (ch.lineBreakAfter) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}

const hasWords = (line: PdfChar[]) => line.some((ch) => !ch.ignorable && /\p{L}/u.test(ch.c));

/**
 * For a passage crossing a page break: drop lines without letters (page numbers) at the bottom of the
 * first page and the top of the next one, which the matcher skipped but a plain slice would include.
 */
function trimPageEdges(chars: PdfChar[], edge: "end" | "start"): PdfChar[] {
  const lines = splitLines(chars);
  if (edge === "end") while (lines.length > 1 && !hasWords(lines[lines.length - 1])) lines.pop();
  else while (lines.length > 1 && !hasWords(lines[0])) lines.shift();
  return lines.flat();
}

const pageList = (ms: Match[]) => [...new Set(ms.map((m) => m.start.pageIndex + 1))].join(", ");

/**
 * Locate `req.text` and build the highlight position. Throws ToolError if the passage is not found,
 * if it matches more than once and neither `page` nor `occurrence` narrows it to one, or if the
 * glyphs carry no usable geometry. Never estimates coordinates.
 */
export async function locateHighlight(pdf: PdfPages, req: HighlightRequest): Promise<LocatedHighlight> {
  const quote = req.text;
  if (!/[\p{L}\p{N}]/u.test(quote)) throw new ToolError("The text to highlight has no letters or digits.");
  if (req.page !== undefined && (req.page < 1 || req.page > pdf.numPages)) {
    throw new ToolError(`page ${req.page} is outside this PDF (pages 1–${pdf.numPages}).`);
  }
  const all = Array.from({ length: pdf.numPages }, (_, i) => i);
  const scope = req.page !== undefined ? [req.page - 1] : all;
  const matches = await findMatches(pdf, quote, scope);
  const where = req.page !== undefined ? ` on page ${req.page}` : "";

  if (!matches.length) {
    if (req.page !== undefined) {
      const elsewhere = await findMatches(pdf, quote, all);
      if (elsewhere.length) {
        throw new ToolError(`The passage is not on page ${req.page}; it occurs on page(s) ${pageList(elsewhere)}. No highlight was created.`);
      }
    }
    throw new ToolError(
      `The passage was not found${where} in the PDF's text layer. Quote the PDF exactly (see read_pdf_text); ` +
        "scanned PDFs without a text layer cannot be highlighted. No highlight was created.",
    );
  }
  let chosen: Match | undefined;
  if (req.occurrence !== undefined) {
    chosen = matches[req.occurrence - 1];
    if (!chosen) {
      throw new ToolError(`occurrence ${req.occurrence} requested, but the passage occurs only ${matches.length} time(s)${where}. No highlight was created.`);
    }
  } else if (matches.length === 1) {
    chosen = matches[0];
  } else {
    throw new ToolError(
      `The passage occurs ${matches.length} times${where} (page(s) ${pageList(matches)}). Give page and/or occurrence ` +
        "(1-based, in reading order), or quote a longer, unique passage. No highlight was created.",
    );
  }

  const { start, end } = chosen;
  const first = await pdf.page(start.pageIndex);
  const firstChars =
    end.pageIndex === start.pageIndex
      ? first.chars.slice(start.charIndex, end.charIndex + 1)
      : trimPageEdges(first.chars.slice(start.charIndex), "end");
  const rects = rectsFromChars(firstChars);
  let text = textFromChars(firstChars);
  const position: HighlightPosition = { pageIndex: start.pageIndex, rects };
  if (end.pageIndex !== start.pageIndex) {
    const nextChars = trimPageEdges((await pdf.page(end.pageIndex)).chars.slice(0, end.charIndex + 1), "start");
    position.nextPageRects = rectsFromChars(nextChars);
    text += " " + textFromChars(nextChars);
    if (!position.nextPageRects.length) delete position.nextPageRects;
  }
  if (!rects.length) {
    throw new ToolError("The PDF has no usable glyph positions for this passage. No highlight was created.");
  }
  return { position, sortIndex: sortIndex(start.pageIndex, start.charIndex, rects, first.viewBox), text, matches: matches.length };
}
