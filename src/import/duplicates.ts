// import_paper's duplicate check: does the personal library already hold a paper with this identifier?
// Pure matching over candidate items (the Zotero lookup that produces candidates is in zoteroDuplicates.ts).
import type { Identifier } from "./identifier";

export type Candidate = {
  key: string;
  deleted: boolean;
  regular: boolean;
  dateAdded: string;
  fields: { DOI?: string; extra?: string; url?: string; archiveID?: string };
};

export type Duplicate = { itemKey: string; itemKeys: string[] };

/** Values of `Label: value` lines in Extra (Zotero's convention for fields an item type lacks). */
function extraLines(extra: string | undefined, label: string): string[] {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(\\S+)\\s*$`, "i");
  return (extra ?? "").split(/\r?\n/).flatMap((line) => re.exec(line)?.[1] ?? []);
}

// arXiv IDs as identifier.ts accepts them (new and old style), version suffix captured separately.
const ARXIV_ID = String.raw`(\d{4}\.\d{4,5}|[a-z]+(?:-[a-z]+)*(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?(?!\d)`;
const ARXIV_IN = [
  new RegExp(String.raw`\barxiv:\s*${ARXIV_ID}`, "gi"), // archiveID "arXiv:1706.03762", Extra "arXiv:1706.03762 [cs.CL]"
  new RegExp(String.raw`\barxiv\.org\/(?:abs|pdf)\/${ARXIV_ID}`, "gi"), // URL field
  new RegExp(String.raw`^\s*10\.48550\/arxiv\.${ARXIV_ID}\s*$`, "gim"), // arXiv's DataCite DOI
];

/** arXiv IDs (lowercase, no version) Zotero recorded for this item. */
function arxivIDs(f: Candidate["fields"]): string[] {
  const text = [f.archiveID, f.extra, f.url, f.DOI].filter(Boolean).join("\n");
  return ARXIV_IN.flatMap((re) => [...text.matchAll(re)].map((m) => m[1].toLowerCase()));
}

function matches(c: Candidate, id: Identifier): boolean {
  const want = id.value.toLowerCase();
  switch (id.type) {
    case "DOI":
      return [c.fields.DOI ?? "", ...extraLines(c.fields.extra, "DOI")].some((v) => v.trim().toLowerCase() === want);
    case "arXiv":
      return arxivIDs(c.fields).includes(want);
    case "PMID":
      return extraLines(c.fields.extra, "PMID").includes(want);
  }
}

/** The oldest matching item (and all matches), or null. */
export function findDuplicate(candidates: Candidate[], id: Identifier): Duplicate | null {
  const hits = candidates
    .filter((c) => c.regular && !c.deleted && matches(c, id))
    .sort((a, b) => (a.dateAdded < b.dateAdded ? -1 : a.dateAdded > b.dateAdded ? 1 : 0));
  if (!hits.length) return null;
  return { itemKey: hits[0].key, itemKeys: hits.map((c) => c.key) };
}
