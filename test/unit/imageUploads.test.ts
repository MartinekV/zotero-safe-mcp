import { describe, it, expect } from "vitest";
import { createImageUploads } from "../../src/images/uploads";
import { jpeg, PNG_1x1, png } from "./imageFixtures";

const limits = { maxImageBytes: 1000, maxTotalBytes: 2500, maxCount: 3, ttlMs: 60_000 };

function uploads(overrides: Partial<typeof limits> = {}) {
  let t = 0;
  const store = createImageUploads({ ...limits, ...overrides, now: () => t });
  return { store, advance: (ms: number) => (t += ms) };
}

describe("image uploads", () => {
  it("stores a PNG and finds it again by its id, with type and size", () => {
    const { store } = uploads();
    const r = store.add(PNG_1x1);
    if (!r.ok) throw new Error(r.error);
    expect(r.image.imageId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(r.image.imageId).not.toMatch(/^[A-Z0-9]{8}$/); // never looks like an attachment key
    expect(store.get(r.image.imageId)).toMatchObject({ contentType: "image/png", width: 1, height: 1, bytes: PNG_1x1 });
  });

  it("gives every upload a different id", () => {
    const { store } = uploads();
    const ids = [1, 2, 3].map(() => (store.add(png(2, 2)) as any).image.imageId);
    expect(new Set(ids).size).toBe(3);
  });

  it("refuses bytes that are not a PNG or JPEG", () => {
    const { store } = uploads();
    const r = store.add(new TextEncoder().encode("GIF89a......"));
    expect(r).toMatchObject({ ok: false, reason: "not-an-image" });
    expect(store.stats().count).toBe(0);
  });

  it("refuses an image over the size limit, both when announced and when stored", () => {
    const { store } = uploads();
    expect(store.admit(1001)).toMatchObject({ ok: false, reason: "too-large" });
    expect(store.admit(1000)).toEqual({ ok: true });
    expect(store.add(png(5, 5, 1001))).toMatchObject({ ok: false, reason: "too-large" });
  });

  it("refuses uploads once the count or total size cap is reached, before reading the body", () => {
    const { store } = uploads();
    for (let i = 0; i < 3; i++) expect(store.add(png(1, 1)).ok).toBe(true);
    expect(store.admit(10)).toMatchObject({ ok: false, reason: "full" });
    expect(store.add(png(1, 1))).toMatchObject({ ok: false, reason: "full" });

    const big = uploads().store;
    expect(big.add(png(1, 1, 900)).ok).toBe(true);
    expect(big.add(png(1, 1, 900)).ok).toBe(true);
    expect(big.admit(900)).toMatchObject({ ok: false, reason: "full" }); // 3 × ~933 > 2500
    expect(big.admit(400)).toEqual({ ok: true });
  });

  it("forgets uploads after the time limit, which frees room again", () => {
    const { store, advance } = uploads();
    const ids = [1, 2, 3].map(() => (store.add(png(1, 1)) as any).image.imageId);
    advance(59_999);
    expect(store.get(ids[0])).toBeDefined();
    expect(store.add(png(1, 1))).toMatchObject({ ok: false, reason: "full", retryAfterSeconds: 1 });
    advance(1);
    expect(store.get(ids[0])).toBeUndefined();
    expect(store.add(jpeg(3, 4)).ok).toBe(true);
  });

  it("an id can be used once: take() removes it and frees its room", () => {
    const { store } = uploads();
    const a = (store.add(png(1, 1)) as any).image.imageId;
    const b = (store.add(png(1, 1)) as any).image.imageId;
    store.take([a]);
    expect(store.get(a)).toBeUndefined();
    expect(store.get(b)).toBeDefined();
    expect(store.stats().count).toBe(1);
  });

  it("clear() discards everything (plugin shutdown)", () => {
    const { store } = uploads();
    const a = (store.add(png(1, 1)) as any).image.imageId;
    store.clear();
    expect(store.get(a)).toBeUndefined();
    expect(store.stats()).toEqual({ count: 0, bytes: 0 });
  });
});
