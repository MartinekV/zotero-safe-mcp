// Images uploaded with POST /safe-mcp/image, held in memory until a note uses them (each id once),
// they expire, or the plugin shuts down. Bounded per image, in total and in count, so an agent
// can't exhaust Zotero's memory by uploading and never using. Pure (clock and ids injectable).
import { ImageContentType, sniffImage } from "./imageFormat";

export type StoredImage = {
  imageId: string;
  contentType: ImageContentType;
  width: number;
  height: number;
  bytes: Uint8Array;
  /** ms since epoch (per the store's clock). */
  expiresAt: number;
};

export type UploadRefusal = {
  ok: false;
  reason: "too-large" | "not-an-image" | "full";
  error: string;
  /** For "full": seconds until the oldest upload expires. */
  retryAfterSeconds?: number;
};

export type UploadLimits = {
  /** Largest single image, in bytes. */
  maxImageBytes: number;
  /** Largest total of all unused uploads, in bytes. */
  maxTotalBytes: number;
  /** Most unused uploads held at once. */
  maxCount: number;
  /** How long an unused upload is kept. */
  ttlMs: number;
};

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxCount: 20,
  ttlMs: 60 * 60 * 1000,
};

export type ImageUploads = {
  /** Checks an upload of `bytes` (its Content-Length) would fit, before the body is read. */
  admit(bytes: number): { ok: true } | UploadRefusal;
  add(bytes: Uint8Array): { ok: true; image: StoredImage } | UploadRefusal;
  get(imageId: string): StoredImage | undefined;
  /** Removes these uploads: they were used. */
  take(imageIds: Iterable<string>): void;
  clear(): void;
  stats(): { count: number; bytes: number };
  readonly limits: UploadLimits;
};

const MB = 1024 * 1024;
const mb = (n: number) => `${Math.round((n / MB) * 10) / 10} MB`;

export function randomImageId(): string {
  const raw = new Uint8Array(12);
  crypto.getRandomValues(raw);
  return "img-" + btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_");
}

export function createImageUploads(
  opts: Partial<UploadLimits> & { now?: () => number; newId?: () => string } = {},
): ImageUploads {
  const limits: UploadLimits = {
    maxImageBytes: opts.maxImageBytes ?? DEFAULT_UPLOAD_LIMITS.maxImageBytes,
    maxTotalBytes: opts.maxTotalBytes ?? DEFAULT_UPLOAD_LIMITS.maxTotalBytes,
    maxCount: opts.maxCount ?? DEFAULT_UPLOAD_LIMITS.maxCount,
    ttlMs: opts.ttlMs ?? DEFAULT_UPLOAD_LIMITS.ttlMs,
  };
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? randomImageId;
  const images = new Map<string, StoredImage>(); // insertion order = oldest first

  function expire() {
    const t = now();
    for (const [id, image] of images) if (image.expiresAt <= t) images.delete(id);
  }

  function total(): number {
    let n = 0;
    for (const image of images.values()) n += image.bytes.length;
    return n;
  }

  function admit(bytes: number): { ok: true } | UploadRefusal {
    if (bytes > limits.maxImageBytes) {
      return { ok: false, reason: "too-large", error: `Image is larger than ${mb(limits.maxImageBytes)}` };
    }
    expire();
    const used = total();
    if (images.size >= limits.maxCount || used + bytes > limits.maxTotalBytes) {
      const oldest = images.values().next().value as StoredImage | undefined;
      const retryAfterSeconds = oldest ? Math.max(1, Math.ceil((oldest.expiresAt - now()) / 1000)) : undefined;
      return {
        ok: false,
        reason: "full",
        error:
          `Too many unused uploads (${images.size} images, ${mb(used)}; at most ${limits.maxCount} images and ` +
          `${mb(limits.maxTotalBytes)}). Use the uploaded imageIds in a note first; unused uploads expire after ` +
          `${Math.round(limits.ttlMs / 60000)} minutes.`,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      };
    }
    return { ok: true };
  }

  return {
    limits,
    admit,
    add(bytes) {
      const room = admit(bytes.length);
      if (!room.ok) return room;
      const info = sniffImage(bytes);
      if (!info) return { ok: false, reason: "not-an-image", error: "Not a PNG or JPEG image (checked by its bytes)" };
      let imageId = newId();
      while (images.has(imageId)) imageId = newId();
      const image: StoredImage = { imageId, ...info, bytes, expiresAt: now() + limits.ttlMs };
      images.set(imageId, image);
      return { ok: true, image };
    },
    get(imageId) {
      expire();
      return images.get(imageId);
    },
    take(imageIds) {
      for (const id of imageIds) images.delete(id);
    },
    clear() {
      images.clear();
    },
    stats() {
      expire();
      return { count: images.size, bytes: total() };
    },
  };
}
