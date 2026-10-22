import { describe, expect, it } from "vitest";
import { type Candidate, findDuplicate } from "../../src/import/duplicates";

const paper = (key: string, fields: Candidate["fields"], more: Partial<Candidate> = {}): Candidate => ({
  key, deleted: false, regular: true, dateAdded: "2024-01-01 00:00:00", fields, ...more,
});

describe("findDuplicate: DOI", () => {
  it("matches the DOI field case-insensitively", () => {
    expect(findDuplicate([paper("AAAAAAAA", { DOI: "10.1038/NATURE12373" })], { type: "DOI", value: "10.1038/nature12373" }))
      .toEqual({ itemKey: "AAAAAAAA", itemKeys: ["AAAAAAAA"] });
  });

  it("matches a DOI: line in Extra (item types without a DOI field), not a longer or different DOI", () => {
    const id = { type: "DOI", value: "10.1093/nar/gks1195" } as const;
    expect(findDuplicate([paper("AAAAAAAA", { extra: "Some note\ndoi:  10.1093/NAR/gks1195\nPMID: 1" })], id)?.itemKey).toBe("AAAAAAAA");
    expect(findDuplicate([
      paper("BBBBBBBB", { DOI: "10.1093/nar/gks11950" }),
      paper("CCCCCCCC", { extra: "DOI: 10.1093/nar/gks1196" }),
      paper("DDDDDDDD", { extra: "Mentions DOI: 10.1093/nar/gks1195 mid-line" }),
    ], id)).toBeNull();
  });
});

describe("findDuplicate: which items count", () => {
  const id = { type: "DOI", value: "10.1038/nature12373" } as const;
  const f = { DOI: "10.1038/nature12373" };

  it("ignores trashed items and non-regular items (notes, attachments)", () => {
    expect(findDuplicate([
      paper("AAAAAAAA", f, { deleted: true }),
      paper("BBBBBBBB", { extra: "DOI: 10.1038/nature12373" }, { regular: false }),
    ], id)).toBeNull();
  });

  it("with several copies returns the oldest as itemKey and all of them, oldest first", () => {
    expect(findDuplicate([
      paper("NEWERAAA", f, { dateAdded: "2025-03-01 10:00:00" }),
      paper("TRASHEDA", f, { dateAdded: "2020-01-01 10:00:00", deleted: true }),
      paper("OLDESTAA", f, { dateAdded: "2023-06-01 10:00:00" }),
    ], id)).toEqual({ itemKey: "OLDESTAA", itemKeys: ["OLDESTAA", "NEWERAAA"] });
  });
});

describe("findDuplicate: arXiv", () => {
  const id = { type: "arXiv", value: "1706.03762" } as const;
  const key = (fields: Candidate["fields"]) => findDuplicate([paper("AAAAAAAA", fields)], id)?.itemKey ?? null;

  it("matches wherever Zotero stores the ID, ignoring the version", () => {
    expect(key({ archiveID: "arXiv:1706.03762" })).toBe("AAAAAAAA");
    expect(key({ extra: "arXiv:1706.03762v5 [cs.CL]" })).toBe("AAAAAAAA");
    expect(key({ extra: "arXiv: 1706.03762" })).toBe("AAAAAAAA");
    expect(key({ url: "http://arxiv.org/abs/1706.03762v2" })).toBe("AAAAAAAA");
    expect(key({ url: "https://arxiv.org/pdf/1706.03762v7.pdf" })).toBe("AAAAAAAA");
    expect(key({ DOI: "10.48550/ARXIV.1706.03762" })).toBe("AAAAAAAA");
    expect(key({ DOI: "10.48550/arXiv.1706.03762", extra: "Other: x", url: "https://example.org" })).toBe("AAAAAAAA");
  });

  it("does not match a different or longer ID, or the bare number in unrelated text", () => {
    expect(key({ archiveID: "arXiv:1706.03763" })).toBeNull();
    expect(key({ url: "https://arxiv.org/abs/1706.037621" })).toBeNull();
    expect(key({ extra: "Pages 1706.03762" })).toBeNull();
    expect(key({ url: "https://example.org/1706.03762" })).toBeNull();
  });

  it("matches old-style IDs case-insensitively", () => {
    const old = { type: "arXiv", value: "math.GT/0309136" } as const;
    expect(findDuplicate([paper("AAAAAAAA", { archiveID: "arXiv:math.gt/0309136v1" })], old)?.itemKey).toBe("AAAAAAAA");
    expect(findDuplicate([paper("AAAAAAAA", { url: "https://arxiv.org/abs/hep-th/9901001" })], { type: "arXiv", value: "hep-th/9901001" })?.itemKey).toBe("AAAAAAAA");
  });
});

describe("findDuplicate: PMID", () => {
  const id = { type: "PMID", value: "23193287" } as const;
  const key = (fields: Candidate["fields"]) => findDuplicate([paper("AAAAAAAA", fields)], id)?.itemKey ?? null;

  it("matches a PMID: line in Extra", () => {
    expect(key({ extra: "PMID: 23193287\nPMCID: PMC3531190" })).toBe("AAAAAAAA");
    expect(key({ extra: "pmid:23193287" })).toBe("AAAAAAAA");
  });

  it("does not match another PMID, a PMCID, or the number elsewhere", () => {
    expect(key({ extra: "PMID: 231932870" })).toBeNull();
    expect(key({ extra: "PMCID: 23193287" })).toBeNull();
    expect(key({ DOI: "10.1/23193287", url: "https://example.org/23193287" })).toBeNull();
  });
});
