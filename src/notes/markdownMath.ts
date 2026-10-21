// Adapted from llm-for-zotero (AGPL-3.0), src/utils/markdown.ts@435dd19
// (createMathExtensions, isEscapedDelimiter, canOpen/CloseInlineDollarMath, findClosing*DollarMath),
// reduced to the `$...$` / `$$...$$` forms and to tokens only (rendering is in markdownToNoteHtml.ts).
import type { TokenizerExtension, Tokens } from "marked";

export type MathToken = Tokens.Generic & { type: "mathBlock" | "mathInline"; text: string };

function isEscapedDelimiter(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashCount++;
  return slashCount % 2 === 1;
}

function canOpenInlineDollarMath(text: string, index: number): boolean {
  if (text[index] !== "$" || isEscapedDelimiter(text, index) || text[index + 1] === "$") return false;
  const next = text[index + 1] || "";
  return Boolean(next && !/\s/.test(next));
}

function canCloseInlineDollarMath(text: string, index: number): boolean {
  if (text[index] !== "$" || isEscapedDelimiter(text, index) || text[index - 1] === "$") return false;
  const previous = text[index - 1] || "";
  const next = text[index + 1] || "";
  if (!previous || /\s/.test(previous)) return false;
  // In prose, a dollar sign followed by a digit is almost always another currency amount.
  if (/\d/.test(next)) return false;
  return true;
}

function findClosingInlineDollarMath(text: string, openIndex: number): number {
  for (let index = openIndex + 1; index < text.length; index++) {
    if (text[index] === "$" && canCloseInlineDollarMath(text, index)) return index;
  }
  return -1;
}

function findClosingDisplayDollarMath(text: string, openIndex: number): number {
  for (let index = openIndex + 2; index < text.length - 1; index++) {
    if (text.slice(index, index + 2) === "$$" && !isEscapedDelimiter(text, index)) return index;
  }
  return -1;
}

/** marked extensions producing `mathBlock` ($$ on its own block) and `mathInline` ($...$ or $$...$$ in text). */
export const mathExtensions: TokenizerExtension[] = [
  {
    name: "mathBlock",
    level: "block",
    start(src: string) {
      // Only where a block can begin, so "so $$x$$ holds" stays one paragraph.
      const m = /(^|\n)\$\$/.exec(src);
      return m ? m.index + m[1].length : undefined;
    },
    tokenizer(src: string): MathToken | undefined {
      const m = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:[ \t]*(?:\n+|$))/.exec(src);
      if (!m) return undefined;
      return { type: "mathBlock", raw: m[0], text: m[1].trim() };
    },
  },
  {
    name: "mathInline",
    level: "inline",
    start(src: string) {
      const i = src.indexOf("$");
      return i >= 0 ? i : undefined;
    },
    tokenizer(src: string): MathToken | undefined {
      if (src.startsWith("$$")) {
        const close = findClosingDisplayDollarMath(src, 0);
        if (close > 2 && src.slice(2, close).trim()) {
          return { type: "mathInline", raw: src.slice(0, close + 2), text: src.slice(2, close).trim() };
        }
        return undefined;
      }
      if (canOpenInlineDollarMath(src, 0)) {
        const close = findClosingInlineDollarMath(src, 0);
        if (close > 0) return { type: "mathInline", raw: src.slice(0, close + 1), text: src.slice(1, close) };
      }
      return undefined;
    },
  },
];
