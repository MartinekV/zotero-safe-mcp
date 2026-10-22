// Note HTML in a canonical form, for noticing the user's edits of agent notes (src/ownership/userEdits.ts)
// and for undo of edit_note. Zotero 10's note editor doesn't save a note on open or close when its
// images have width/height (checked headless, test/integration/user-edit-ownership.itest.ts), so the
// HTML is compared, not the Markdown it reads as: formatting-only edits (underline, colours,
// sub/superscript, image size) count. Ignored are only differences no reader sees: whitespace between
// block elements, attribute order and how characters are escaped. Pure: no Zotero globals.
import type { ChildNode } from "domhandler";
import { parseDocument } from "htmlparser2";

/** Elements whose whitespace-only text children are layout, not content. */
const BLOCK_CONTAINERS = new Set([
  "div", "body", "html", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "blockquote",
  "section", "article", "figure", "dl", "dd", "dt",
]);

export function canonicalNoteHtml(html: string): string {
  return serialize(parseDocument(html, { decodeEntities: true }).children, true);
}

/** Whether two versions of a note show the same content with the same formatting. */
export function sameNoteHtml(a: string, b: string): boolean {
  return canonicalNoteHtml(a) === canonicalNoteHtml(b);
}

function serialize(nodes: ChildNode[], inBlockContainer: boolean): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text") {
      if (inBlockContainer && !n.data.trim()) continue;
      out += JSON.stringify(n.data);
    } else if (n.type === "tag" || n.type === "script" || n.type === "style") {
      const attrs = Object.entries(n.attribs)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      out += `<${n.name}${attrs ? " " + attrs : ""}>${serialize(n.children, BLOCK_CONTAINERS.has(n.name))}</${n.name}>`;
    }
    // Comments, doctypes and processing instructions are not shown.
  }
  return out;
}
