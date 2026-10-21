// Hand-built image bytes for tests (headers only, except PNG_1x1 which is a complete image).

/** A complete 1x1 PNG (a widely used minimal PNG). */
export const PNG_1x1 = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];

/** PNG signature + IHDR chunk (CRC zeroed) + `extra` padding bytes. */
export function png(width: number, height: number, extra = 0): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32(13), 0x49, 0x48, 0x44, 0x52, ...u32(width), ...u32(height), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ...new Array(extra).fill(0),
  ]);
}

/** SOI, APP0 (JFIF), optional APP1 Exif with an Orientation tag, then SOF (baseline or progressive). */
export function jpeg(width: number, height: number, opts: { orientation?: number; progressive?: boolean; littleEndian?: boolean } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, ...u16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  let app1: number[] = [];
  if (opts.orientation !== undefined) {
    const le = !!opts.littleEndian;
    const w16 = (n: number) => (le ? u16(n).reverse() : u16(n));
    const w32 = (n: number) => (le ? u32(n).reverse() : u32(n));
    const tiff = [
      ...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8),
      ...w16(1), // one IFD0 entry
      ...w16(0x0112), ...w16(3), ...w32(1), ...w16(opts.orientation), 0, 0,
      ...w32(0),
    ];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    app1 = [0xff, 0xe1, ...u16(body.length + 2), ...body];
  }
  const sof = [0xff, opts.progressive ? 0xc2 : 0xc0, ...u16(17), 8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...app1, ...sof, 0xff, 0xd9]);
}
