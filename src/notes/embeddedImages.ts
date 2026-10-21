// Embedded images in note HTML (`<img data-attachment-key=…>`, exploration notes 05-note-html.md). Pure.
import { DomUtils, parseDocument } from "htmlparser2";

export type ImageRef = { width?: number; height?: number };

/** Attachment keys of the note's embedded images, in order, with the size the HTML gives them. */
export function embeddedImages(html: string): Map<string, ImageRef> {
  const out = new Map<string, ImageRef>();
  const doc = parseDocument(html);
  for (const el of DomUtils.getElementsByTagName("img", doc.children)) {
    const key = el.attribs["data-attachment-key"];
    if (!key || out.has(key)) continue;
    const ref: ImageRef = {};
    const width = dimension(el.attribs.width);
    const height = dimension(el.attribs.height);
    if (width !== undefined) ref.width = width;
    if (height !== undefined) ref.height = height;
    out.set(key, ref);
  }
  return out;
}

/** Replaces attachment keys in `data-attachment-key` attributes. */
export function replaceImageKeys(html: string, keys: ReadonlyMap<string, string>): string {
  if (!keys.size) return html;
  return html.replace(/(data-attachment-key=)(["']?)([A-Za-z0-9]+)\2/g, (all, attr, q, key) =>
    keys.has(key) ? `${attr}${q}${keys.get(key)}${q}` : all,
  );
}

function dimension(v: string | undefined): number | undefined {
  if (v === undefined || !/^\s*\d+(\.\d+)?\s*$/.test(v)) return undefined;
  return Math.round(Number(v));
}
