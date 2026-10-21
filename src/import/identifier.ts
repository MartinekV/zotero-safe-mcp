// Strict parsing of import_paper's `identifier` (SPEC Hard rule 4: DOI, arXiv ID or PMID only; no
// file paths, no URLs). Zotero's own Zotero.Utilities.extractIdentifiers is deliberately not used:
// it accepts URLs (doi.org links), ISBNs and ADS bibcodes, and prefers ISBN over PMID for 10 digits.
// Pure; no Zotero needed.

export type IdentifierType = "DOI" | "arXiv" | "PMID";
export type Identifier = { type: IdentifierType; value: string };
export type ParseResult = { ok: true; identifier: Identifier } | { ok: false; error: string };

const DOI = /^10\.\d{4,9}\/\S+$/;
// New style 1706.03762 (4-5 digits after the dot), old style hep-th/9901001 or math.GT/0309136; optional vN.
const ARXIV = /^(\d{4}\.\d{4,5}|[a-z]+(?:-[a-z]+)*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/;
const PMID = /^\d{1,9}$/;

const WHAT = "Give exactly one DOI (10.xxxx/…), arXiv ID (1706.03762) or PMID (23193287)";

export function parseIdentifier(input: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  const s = input.trim();
  if (!s) return fail(`identifier is empty. ${WHAT}.`);

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(www\.|(dx\.)?doi\.org\/|arxiv\.org\/)/i.test(s)) {
    const doi = /10\.\d{4,9}\/\S+$/.exec(s)?.[0];
    return fail(`URLs are not accepted (imports are by identifier only).${doi ? ` Pass the bare DOI instead: ${doi}` : ""} ${WHAT}.`);
  }
  if (/^(\/|~|\.{1,2}[\\/]|[a-z]:[\\/])/i.test(s) || s.includes("\\")) {
    return fail(`File paths are not accepted (imports are by identifier only). ${WHAT}.`);
  }

  const prefixed = /^(doi|arxiv|pmid)\s*:\s*/i.exec(s);
  const body = prefixed ? s.slice(prefixed[0].length) : s;
  if (/\s/.test(body)) return fail(`Only one identifier per call. ${WHAT}.`);
  const prefix = prefixed?.[1].toLowerCase();

  if ((!prefix || prefix === "doi") && DOI.test(body)) return { ok: true, identifier: { type: "DOI", value: body } };
  const arxiv = ARXIV.exec(body);
  if ((!prefix || prefix === "arxiv") && arxiv) return { ok: true, identifier: { type: "arXiv", value: arxiv[1] } };
  if ((!prefix || prefix === "pmid") && PMID.test(body)) return { ok: true, identifier: { type: "PMID", value: body } };
  return fail(`${JSON.stringify(s)} is not a DOI, arXiv ID or PMID. ${WHAT}.`);
}
