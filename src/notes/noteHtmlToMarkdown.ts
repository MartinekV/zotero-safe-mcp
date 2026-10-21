// Zotero note HTML → the Markdown dialect markdownToNoteHtml reads (for list_notes). Pure: no Zotero globals.
// Handles the note editor's own output and, more loosely, older or pasted HTML: unknown elements
// give their text. Citations come back as [@KEY] and embedded images as ![alt](image:<attachmentKey>).
import type { ChildNode, Element } from "domhandler";
import { parseDocument } from "htmlparser2";

export function noteHtmlToMarkdown(html: string): string {
  const doc = parseDocument(html, { decodeEntities: true });
  return blocks(doc.children).join("\n\n");
}

const CONTAINERS = new Set([
  "div", "body", "html", "section", "article", "header", "footer", "main", "aside", "nav", "figure",
  "figcaption", "dl", "dd", "dt", "li", "tbody", "thead", "tfoot", "details", "summary", "center",
]);
const BLOCKS = new Set([
  ...CONTAINERS, "p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "ul", "ol", "table", "hr", "tr", "td", "th",
]);
const SKIP = new Set(["script", "style", "head", "title", "template"]);

const isElement = (n: ChildNode): n is Element => n.type === "tag" || n.type === "script" || n.type === "style";
const isBlock = (n: ChildNode) => isElement(n) && BLOCKS.has(n.name);
const hasClass = (el: Element, cls: string) => (el.attribs.class ?? "").split(/\s+/).includes(cls);

/** Block-level Markdown for a list of nodes; runs of inline nodes become paragraphs. */
function blocks(nodes: ChildNode[]): string[] {
  const out: string[] = [];
  let run: ChildNode[] = [];
  const flush = () => {
    const p = paragraph(run);
    if (p) out.push(p);
    run = [];
  };
  for (const node of nodes) {
    if (!isBlock(node)) {
      run.push(node);
      continue;
    }
    flush();
    out.push(...block(node as Element));
  }
  flush();
  return out;
}

function block(el: Element): string[] {
  const name = el.name;
  if (/^h[1-6]$/.test(name)) {
    const text = inline(el.children, { singleLine: true });
    return text ? [`${"#".repeat(Number(name[1]))} ${text}`] : [];
  }
  switch (name) {
    case "p": {
      const p = paragraph(el.children);
      return p ? [p] : [];
    }
    case "pre":
      return [hasClass(el, "math") ? displayMath(textOf(el)) : codeBlock(textOf(el))];
    case "blockquote":
      return [
        blocks(el.children)
          .join("\n\n")
          .split("\n")
          .map((l) => (l ? `> ${l}` : ">"))
          .join("\n"),
      ];
    case "ul":
    case "ol":
      return [list(el)];
    case "table":
      return table(el);
    case "hr":
      return ["---"];
  }
  return blocks(el.children);
}

function paragraph(nodes: ChildNode[]): string {
  const text = inline(nodes, { singleLine: false });
  return text
    .split("\n")
    .map((line) => escapeLineStart(line.trimStart()))
    .join("\n")
    .trim()
    .replace(/\\$/, "");
}

function list(el: Element): string {
  const ordered = el.name === "ol";
  let n = ordered ? parseInt(el.attribs.start ?? "1", 10) : 0;
  if (!Number.isFinite(n)) n = 1;
  const items: string[] = [];
  for (const child of el.children) {
    if (!isElement(child)) {
      if (textOf(child).trim()) items.push(`- ${paragraph([child])}`);
      continue;
    }
    const marker = ordered ? `${n++}. ` : "- ";
    const parts = child.name === "li" ? blocks(child.children) : block(child);
    let body = "";
    parts.forEach((part, i) => {
      if (i > 0) body += /^(- |\d+\. )/.test(part) ? "\n" : "\n\n";
      body += part;
    });
    const indent = " ".repeat(marker.length);
    items.push(marker + body.split("\n").map((l, i) => (i === 0 || !l ? l : indent + l)).join("\n"));
  }
  return items.join("\n");
}

function table(el: Element): string[] {
  const rows: string[][] = [];
  const collect = (nodes: ChildNode[]) => {
    for (const n of nodes) {
      if (!isElement(n)) continue;
      if (n.name === "tr") {
        rows.push(
          n.children
            .filter((c): c is Element => isElement(c) && (c.name === "td" || c.name === "th"))
            .map((c) => cell(c)),
        );
      } else collect(n.children);
    }
  };
  collect(el.children);
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length), 1);
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")];
}

function cell(el: Element): string {
  // Cells hold paragraphs; a GFM cell is one line.
  const parts = el.children.map((c) =>
    isElement(c) && BLOCKS.has(c.name) ? inline(c.children, { singleLine: true }) : inline([c], { singleLine: true }),
  );
  // GFM splits cells at every unescaped pipe, even inside code and math, and unescapes \| afterwards.
  return parts.join(" ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

type InlineContext = { singleLine: boolean };

function inline(nodes: ChildNode[], ctx: InlineContext): string {
  let out = "";
  for (const node of nodes) out += inlineNode(node, ctx);
  return out.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n");
}

function inlineNode(node: ChildNode, ctx: InlineContext): string {
  if (node.type === "text") return escapeText(collapse(node.data));
  if (!isElement(node) || SKIP.has(node.name)) return "";
  const el = node;
  const inner = () => inline(el.children, ctx);
  switch (el.name) {
    case "strong":
    case "b":
      return wrapMark("**", inner());
    case "em":
    case "i":
    case "cite":
    case "dfn":
      return wrapMark("*", inner());
    case "s":
    case "strike":
    case "del":
      return wrapMark("~~", inner());
    case "code":
    case "tt":
    case "kbd":
    case "samp":
      return codeSpan(collapse(textOf(el)));
    case "br":
      return ctx.singleLine ? " " : "\\\n";
    case "a": {
      const text = inner();
      const href = (el.attribs.href ?? "").trim();
      if (!/^(https?|mailto|zotero):/i.test(href)) return text;
      return `[${text || escapeText(href)}](${/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, encodeURIComponent)}>` : href})`;
    }
    case "img": {
      const key = el.attribs["data-attachment-key"];
      const alt = escapeText(collapse(el.attribs.alt ?? ""));
      return key ? `![${alt}](image:${key})` : escapeText(`[image${alt ? `: ${el.attribs.alt}` : ""}]`);
    }
    case "span": {
      if (hasClass(el, "math")) return inlineMath(textOf(el));
      if (hasClass(el, "citation")) return citation(el) ?? inner();
      if (/line-through/.test(el.attribs.style ?? "")) return wrapMark("~~", inner());
      return inner();
    }
  }
  return inner();
}

function citation(el: Element): string | null {
  try {
    const data = JSON.parse(decodeURIComponent(el.attribs["data-citation"] ?? ""));
    const keys = (data.citationItems as { uris: string[] }[]).map((ci) => {
      const m = /\/items\/([A-Z0-9]{8})$/.exec(ci.uris?.[0] ?? "");
      if (!m) throw new Error("no key");
      return m[1];
    });
    return keys.length ? `[${keys.map((k) => "@" + k).join("; ")}]` : null;
  } catch {
    return null;
  }
}

function inlineMath(text: string): string {
  const tex = stripDelimiters(text, "$").trim();
  return tex ? `$${tex}$` : "";
}

function displayMath(text: string): string {
  const tex = stripDelimiters(text, "$$").trim();
  return tex.includes("\n") ? `$$\n${tex}\n$$` : `$$${tex}$$`;
}

function stripDelimiters(text: string, d: string): string {
  const t = text.trim();
  return t.startsWith(d) && t.endsWith(d) && t.length >= 2 * d.length ? t.slice(d.length, -d.length) : t;
}

function codeBlock(text: string): string {
  const code = text.replace(/ /g, " ").replace(/\n$/, "");
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${code}\n${fence}`;
}

function codeSpan(text: string): string {
  if (!text) return "";
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** `**  x **` doesn't parse as bold; move the spaces outside the markers. */
function wrapMark(marker: string, content: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(content)!;
  return m[2] ? `${m[1]}${marker}${m[2]}${marker}${m[3]}` : content;
}

function textOf(node: ChildNode): string {
  if (node.type === "text") return node.data;
  if (!isElement(node)) return "";
  if (node.name === "br") return "\n";
  return node.children.map(textOf).join("");
}

function collapse(s: string): string {
  return s.replace(/ /g, " ").replace(/[ \t\r\n]+/g, " ");
}

/** Escapes characters that markdownToNoteHtml would otherwise read as markup. */
function escapeText(s: string): string {
  const out = s
    .replace(/[\\`*[\]<$~]/g, "\\$&")
    .replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, (m) => m.replace("_", "\\_"))
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&");
  return out;
}

/** Text at the start of a line that Markdown would read as a heading, list, quote or rule. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(#{1,6})(?=\s|$)/, "\\$1")
    .replace(/^([-+])(?=\s|$)/, "\\$1")
    .replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2")
    .replace(/^>/, "\\>")
    .replace(/^(=+|-+)(\s*)$/, (m) => "\\" + m);
}
