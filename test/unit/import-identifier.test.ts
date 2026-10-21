import { describe, expect, it } from "vitest";
import { parseIdentifier } from "../../src/import/identifier";

const ok = (s: string) => {
  const r = parseIdentifier(s);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(s)} to parse, got: ${r.error}`);
  return r.identifier;
};
const err = (s: string) => {
  const r = parseIdentifier(s);
  if (r.ok) throw new Error(`expected ${JSON.stringify(s)} to be rejected, got ${JSON.stringify(r.identifier)}`);
  return r.error;
};

describe("parseIdentifier", () => {
  it("accepts a bare DOI, with or without a doi: prefix, trimming whitespace", () => {
    expect(ok("10.1038/nature12373")).toEqual({ type: "DOI", value: "10.1038/nature12373" });
    expect(ok("  doi:10.1038/nature12373 ")).toEqual({ type: "DOI", value: "10.1038/nature12373" });
    expect(ok("DOI: 10.1093/nar/gks1195")).toEqual({ type: "DOI", value: "10.1093/nar/gks1195" });
    expect(ok("10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0")).toEqual({
      type: "DOI",
      value: "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0",
    });
  });

  it("accepts new- and old-style arXiv IDs, with optional arXiv: prefix; drops the version like Zotero does", () => {
    expect(ok("1706.03762")).toEqual({ type: "arXiv", value: "1706.03762" });
    expect(ok("arXiv:1706.03762v5")).toEqual({ type: "arXiv", value: "1706.03762" });
    expect(ok("arxiv:2310.12345")).toEqual({ type: "arXiv", value: "2310.12345" });
    expect(ok("hep-th/9901001")).toEqual({ type: "arXiv", value: "hep-th/9901001" });
    expect(ok("math.GT/0309136v2")).toEqual({ type: "arXiv", value: "math.GT/0309136" });
  });

  it("accepts a PMID (digits only, optional PMID: prefix)", () => {
    expect(ok("23193287")).toEqual({ type: "PMID", value: "23193287" });
    expect(ok("PMID: 23193287")).toEqual({ type: "PMID", value: "23193287" });
    expect(ok("pmid:1")).toEqual({ type: "PMID", value: "1" });
  });

  it("rejects empty input", () => {
    expect(err("")).toMatch(/empty/i);
    expect(err("   ")).toMatch(/empty/i);
  });

  it("rejects URLs, including doi.org and arxiv.org links, pointing at the bare identifier", () => {
    expect(err("https://doi.org/10.1038/nature12373")).toMatch(/URL.*10\.1038\/nature12373/);
    expect(err("doi.org/10.1038/nature12373")).toMatch(/URL/);
    expect(err("http://arxiv.org/abs/1706.03762")).toMatch(/URL/);
    expect(err("www.example.com/paper")).toMatch(/URL/);
    expect(err("ftp://x/y")).toMatch(/URL/);
  });

  it("rejects file paths", () => {
    for (const p of ["/home/me/paper.pdf", "~/paper.pdf", "./paper.pdf", "../a.pdf", "file:///tmp/a.pdf", "C:\\papers\\a.pdf", "paper.pdf"]) {
      expect(err(p), p).toMatch(/path|URL|not a DOI/i);
    }
    expect(err("/home/me/paper.pdf")).toMatch(/path/i);
    expect(err("C:\\papers\\a.pdf")).toMatch(/path/i);
  });

  it("rejects more than one identifier", () => {
    expect(err("10.1038/nature12373 10.1093/nar/gks1195")).toMatch(/one identifier/i);
    expect(err("1706.03762, 23193287")).toMatch(/one identifier/i);
    expect(err("23193287\n23193288")).toMatch(/one identifier/i);
  });

  it("rejects ISBNs, titles and other strings that are none of the three", () => {
    expect(err("978-0-306-40615-7")).toMatch(/DOI, arXiv ID or PMID/);
    expect(err("Attention is all you need")).toMatch(/one identifier|DOI, arXiv ID or PMID/);
    expect(err("10.1038")).toMatch(/DOI, arXiv ID or PMID/);
    expect(err("1234567890")).toMatch(/DOI, arXiv ID or PMID/); // too long for a PMID; not an ISBN lookup either
  });
});
