// Recognises PNG and JPEG uploads by their bytes (never by the Content-Type the client sent) and
// reads their displayed size: note HTML needs width/height, or Zotero's note editor measures the
// image on first open and saves the note in its own formatting (ticket 03's comments). Pure.

export type ImageContentType = "image/png" | "image/jpeg";
export type ImageInfo = { contentType: ImageContentType; width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's type and size, or null if the bytes are not a PNG or JPEG we can read the size of. */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return png(bytes);
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return jpeg(bytes);
  return null;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

function png(bytes: Uint8Array): ImageInfo | null {
  // The first chunk must be IHDR: length(4) "IHDR" width(4) height(4).
  if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return sized("image/png", v.getUint32(16), v.getUint32(20));
}

/** SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpeg(bytes: Uint8Array): ImageInfo | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let orientation = 1;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any SOF
    const len = v.getUint16(i + 2);
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const seg = bytes.subarray(i + 4, i + 2 + len);
    if (marker === 0xe1) orientation = exifOrientation(seg) ?? orientation;
    if (isStartOfFrame(marker)) {
      if (seg.length < 5) return null;
      const height = v.getUint16(i + 5);
      const width = v.getUint16(i + 7);
      // Orientations 5–8 rotate by 90°: browsers (and so the note editor) show it with sides swapped.
      return orientation >= 5 && orientation <= 8 ? sized("image/jpeg", height, width) : sized("image/jpeg", width, height);
    }
    i += 2 + len;
  }
  return null;
}

/** The Orientation tag (0x0112) of an APP1 "Exif" segment's IFD0, if present. */
function exifOrientation(seg: Uint8Array): number | undefined {
  if (seg.length < 14 || String.fromCharCode(...seg.subarray(0, 6)) !== "Exif\0\0") return undefined;
  const tiff = new DataView(seg.buffer, seg.byteOffset + 6, seg.byteLength - 6);
  const order = tiff.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) return undefined;
  const le = order === 0x4949;
  const ifd = tiff.getUint32(4, le);
  if (ifd + 2 > tiff.byteLength) return undefined;
  const count = tiff.getUint16(ifd, le);
  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    if (entry + 12 > tiff.byteLength) return undefined;
    if (tiff.getUint16(entry, le) === 0x0112) return tiff.getUint16(entry + 8, le);
  }
  return undefined;
}

function sized(contentType: ImageContentType, width: number, height: number): ImageInfo | null {
  return width > 0 && height > 0 ? { contentType, width, height } : null;
}
