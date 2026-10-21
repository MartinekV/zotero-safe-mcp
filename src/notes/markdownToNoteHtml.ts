// Markdown → the HTML Zotero 10's note editor stores (schema version 9). Pure: no Zotero globals;
// item and image lookups are injected. Format reference: exploration notes 05-note-html.md,
// round-trip checked against the real note editor in test/integration/note-html.itest.ts.
import { decodeHTML } from "entities";
import { Marked, type Token, type TokenizerExtension, type Tokens } from "marked";
import { ToolError } from "../registry/types";
import { mathExtensions, type MathToken } from "./markdownMath";

/** A cited library item, as the caller resolves it. */
export type CitedItem = {
  /** `Zotero.URI.getItemURI(item)` */
  uri: string;
  /** CSL-JSON, `Zotero.Utilities.Item.itemToCSLJSON(item)` */
  itemData: unknown;
  /** Plain text shown for the item, e.g. "Carroll, 1865" (what Zotero's formatCitation puts in a citation-item span). */
  label: string;
};

/** An image already stored as an embedded-image attachment of the note. */
export type NoteImage = { attachmentKey: string; width?: number; height?: number };

export type NoteLookups = {
  /** Resolves an item key; null (or undefined) for keys that are not citable items, which fails the conversion. */
  resolveCitation(itemKey: string): CitedItem | null | undefined | Promise<CitedItem | null | undefined>;
  /** Resolves an `image:<imageId>` reference; null (or undefined) fails the conversion. */
  resolveImage(imageId: string): NoteImage | null | undefined | Promise<NoteImage | null | undefined>;
};

type CitationToken = Tokens.Generic & { type: "citation"; keys: string[] | null };

const ITEM_KEY = /^[A-Z0-9]{8}$/;
const IMAGE_REF = /^image:([A-Za-z0-9_-]+)$/;

/** `[@KEY]` or `[@KEY1; @KEY2]`. Anything else starting with `[@` is tokenized too, so it can be rejected. */
const citationExtension: TokenizerExtension = {
  name: "citation",
  level: "inline",
  start(src: string) {
    const i = src.indexOf("[@");
    return i >= 0 ? i : undefined;
  },
  tokenizer(src: string): CitationToken | undefined {
    const m = /^\[@([^[\]\n]*)\](?!\()/.exec(src);
    if (!m) return undefined;
    const parts = ("@" + m[1]).split(";").map((p) => /^\s*@([A-Za-z0-9]+)\s*$/.exec(p)?.[1]);
    const keys = parts.every((k) => k && ITEM_KEY.test(k)) ? (parts as string[]) : null;
    return { type: "citation", raw: m[0], keys };
  },
};

const marked = new Marked({ gfm: true, extensions: [...mathExtensions, citationExtension] });

type Resolved = { citations: Map<string, CitedItem>; images: Map<string, NoteImage> };

/** Converts agent Markdown to note HTML. Throws ToolError for unknown citation keys or image ids. */
export async function markdownToNoteHtml(markdown: string, lookups: NoteLookups): Promise<string> {
  const tokens = marked.lexer(markdown.normalize("NFC"));
  const resolved = await resolveReferences(tokens, lookups);
  const body = blocks(tokens, resolved);

  // One wrapper entry per cited item, in order of first citation.
  const cited = new Map<string, CitedItem>();
  for (const item of resolved.citations.values()) cited.set(item.uri, item);
  const citationItems = [...cited.values()].map((c) => ({ uris: [c.uri], itemData: c.itemData }));
  const attrs = citationItems.length ? ` data-citation-items="${encodeAttr(citationItems)}"` : "";
  return `<div${attrs} data-schema-version="9">${body}</div>`;
}

async function resolveReferences(tokens: Token[], lookups: NoteLookups): Promise<Resolved> {
  const keys = new Set<string>();
  const imageIds = new Set<string>();
  marked.walkTokens(tokens, (token) => {
    if (token.type === "citation") {
      const t = token as CitationToken;
      if (!t.keys) {
        throw new ToolError(
          `Cannot read the citation ${t.raw}: write [@ITEMKEY] or [@ITEMKEY1; @ITEMKEY2] with 8-character Zotero item keys (no locators).`,
        );
      }
      t.keys.forEach((k) => keys.add(k));
    }
    if (token.type === "image") {
      const id = IMAGE_REF.exec((token as Tokens.Image).href)?.[1];
      if (id) imageIds.add(id);
    }
  });

  const resolved: Resolved = { citations: new Map(), images: new Map() };
  for (const key of keys) {
    const item = await lookups.resolveCitation(key);
    if (!item) throw new ToolError(`Cannot cite [@${key}]: no item with that key in the library.`);
    resolved.citations.set(key, item);
  }
  for (const id of imageIds) {
    const image = await lookups.resolveImage(id);
    if (!image) throw new ToolError(`Unknown image id "${id}": upload the image with POST /safe-mcp/image first.`);
    resolved.images.set(id, image);
  }
  return resolved;
}

function blocks(tokens: Token[], r: Resolved, separator = "\n"): string {
  return tokens
    .map((t) => block(t, r))
    .filter((s) => s !== "")
    .join(separator);
}

function block(token: Token, r: Resolved): string {
  const inPara = (tokens: Token[] | undefined) => inline(tokens, { ...r, inHeading: false });
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      return `<h${t.depth}>${inline(t.tokens, { ...r, inHeading: true })}</h${t.depth}>`;
    }
    case "paragraph":
      return `<p>${inPara((token as Tokens.Paragraph).tokens)}</p>`;
    case "text": {
      // A tight list item's content
      const t = token as Tokens.Text;
      return `<p>${t.tokens ? inPara(t.tokens) : escapeHtml(t.text)}</p>`;
    }
    case "list": {
      const t = token as Tokens.List;
      const tag = t.ordered ? "ol" : "ul";
      const start = t.ordered && t.start !== "" && t.start !== 1 ? ` start="${Number(t.start)}"` : "";
      return `<${tag}${start}>${t.items.map((item) => listItem(item, r)).join("")}</${tag}>`;
    }
    case "blockquote":
      return `<blockquote>${blocks((token as Tokens.Blockquote).tokens, r)}</blockquote>`;
    case "code":
      return `<pre>${escapeHtml((token as Tokens.Code).text)}</pre>`;
    case "table": {
      const t = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[], tag: string) =>
        `<tr>${cells.map((c) => `<${tag}><p>${inPara(c.tokens)}</p></${tag}>`).join("")}</tr>`;
      return `<table><tbody>${row(t.header, "th")}${t.rows.map((cells) => row(cells, "td")).join("")}</tbody></table>`;
    }
    case "mathBlock":
      return `<pre class="math">$$${escapeHtml((token as MathToken).text)}$$</pre>`;
    case "hr":
      return "<hr>";
    case "space":
      return "";
  }
  return textBlock(token.raw);
}

function listItem(item: Tokens.ListItem, r: Resolved): string {
  let html = blocks(item.tokens, r, "");
  if (item.task) {
    const box = escapeHtml(item.checked ? "[x] " : "[ ] ");
    html = html.startsWith("<p>") ? `<p>${box}${html.slice(3)}` : `<p>${box.trimEnd()}</p>${html}`;
  }
  return `<li>${html}</li>`;
}

/** Anything without a note-editor equivalent: its Markdown source as a paragraph of text, line breaks kept. */
function textBlock(raw: string): string {
  const text = raw.replace(/^\n+|\s+$/g, "");
  return text ? `<p>${text.split("\n").map(escapeHtml).join("<br>")}</p>` : "";
}

/** Headings allow citations but not inline math or images (note-editor schema); those stay as text there. */
type InlineContext = Resolved & { inHeading: boolean };

function inline(tokens: Token[] | undefined, ctx: InlineContext): string {
  return (tokens ?? []).map((t) => inlineToken(t, ctx)).join("");
}

function inlineToken(token: Token, ctx: InlineContext): string {
  switch (token.type) {
    case "mathInline": {
      const tex = (token as MathToken).text;
      return ctx.inHeading ? escapeHtml(token.raw) : `<span class="math">$${escapeHtml(tex)}$</span>`;
    }
    case "citation":
      return citation((token as CitationToken).keys!, ctx);
    case "text": {
      const t = token as Tokens.Text;
      // marked leaves character references (&amp;, &copy;) in text; read them, then escape for HTML.
      return t.tokens ? inline(t.tokens, ctx) : escapeHtml(decodeHTML(t.text));
    }
    case "escape":
      return escapeHtml((token as Tokens.Escape).text);
    case "strong":
      return `<strong>${inline((token as Tokens.Strong).tokens, ctx)}</strong>`;
    case "em":
      return `<em>${inline((token as Tokens.Em).tokens, ctx)}</em>`;
    case "del":
      return `<span style="text-decoration: line-through">${inline((token as Tokens.Del).tokens, ctx)}</span>`;
    case "image": {
      const t = token as Tokens.Image;
      const id = IMAGE_REF.exec(t.href)?.[1];
      if (!id || ctx.inHeading) return escapeHtml(t.raw);
      const img = ctx.images.get(id)!;
      const size = (img.width ? ` width="${Math.round(img.width)}"` : "") + (img.height ? ` height="${Math.round(img.height)}"` : "");
      return `<img alt="${escapeHtml(t.text)}" data-attachment-key="${escapeHtml(img.attachmentKey)}"${size}>`;
    }
    case "br":
      return "<br>";
    case "codespan":
      return `<code>${escapeHtml((token as Tokens.Codespan).text)}</code>`;
    case "link": {
      const t = token as Tokens.Link;
      if (!isAllowedLink(t.href)) return escapeHtml(t.raw);
      return `<a href="${escapeHtml(t.href)}">${inline(t.tokens, ctx)}</a>`;
    }
  }
  return escapeHtml(token.raw);
}

/** Same shape as Zotero's own citations (EditorInstanceUtilities.formatCitation for the visible text). */
function citation(keys: string[], ctx: InlineContext): string {
  const items = keys.map((k) => ctx.citations.get(k)!);
  const data = { citationItems: items.map((i) => ({ uris: [i.uri] })), properties: {} };
  const text = items.map((i) => `<span class="citation-item">${escapeHtml(i.label)}</span>`).join("; ");
  return `<span class="citation" data-citation="${encodeAttr(data)}">(${text})</span>`;
}

/** Only these schemes may appear in hrefs; anything else (including relative URLs) stays text. */
function isAllowedLink(href: string): boolean {
  return /^(https?|mailto|zotero):/i.test(href);
}

function encodeAttr(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
