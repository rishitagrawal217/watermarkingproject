import { readdirSync } from "node:fs";
import { extname, join, basename } from "node:path";
import sharp from "sharp";
import { Gray } from "./image.js";
import { Rng } from "./rng.js";

const EXT = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"]);

/** any image buffer -> 8-bit grayscale, centre-cropped to a square and resized */
export async function toGray(input: Buffer | string, size = 512): Promise<Gray> {
  const { data, info } = await sharp(input)
    .flatten({ background: "#ffffff" })
    .resize(size, size, { fit: "cover", position: "centre", kernel: "cubic" })
    .toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error("grayscale conversion failed");
  return { w: size, h: size, data: new Uint8Array(data) };
}

/** decode without resizing (used when verifying an already-protected image) */
export async function decodeGray(input: Buffer): Promise<Gray> {
  const { data, info } = await sharp(input).flatten({ background: "#ffffff" }).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error("expected grayscale");
  return { w: info.width, h: info.height, data: new Uint8Array(data) };
}

export const encodePng = (g: Gray): Promise<Buffer> =>
  sharp(g.data, { raw: { width: g.w, height: g.h, channels: 1 } }).png({ compressionLevel: 6 }).toBuffer();

export function listFolder(folder: string): string[] {
  return readdirSync(folder).filter((f) => EXT.has(extname(f).toLowerCase())).sort().map((f) => join(folder, f));
}

export async function loadFolder(folder: string, n = 8, size = 512): Promise<{ name: string; img: Gray }[]> {
  const files = listFolder(folder).slice(0, n);
  if (!files.length) throw new Error(`no images found in ${folder}`);
  return Promise.all(files.map(async (f) => ({ name: basename(f, extname(f)), img: await toGray(f, size) })));
}

/** deterministic 32x32 binary logo (1 = ink): ring + "W" + bar, rasterised at 8x then thresholded */
export function makeLogo(size = 32): Uint8Array {
  const S = 8, logo = new Uint8Array(size * size);
  const segs: [number, number, number, number][] = [[7, 9, 11.5, 22], [11.5, 22, 16, 13], [16, 13, 20.5, 22], [20.5, 22, 25, 9]];
  const segDist = (px: number, py: number, [x1, y1, x2, y2]: [number, number, number, number]) => {
    const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let on = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const px = x + (sx + 0.5) / S, py = y + (sy + 0.5) / S, r = Math.hypot(px - 16, py - 16);
        if ((r <= 15 && r >= 12) || segs.some((s) => segDist(px, py, s) <= 1) || (px >= 9 && px <= 23 && py >= 24 && py <= 26)) on++;
      }
      logo[y * size + x] = on / (S * S) >= 0.5 ? 1 : 0;
    }
  return logo;
}

export function randomBytes(n: number, seed: number): Buffer {
  const rng = Rng.fromLabel("payload", seed), b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = rng.int(256);
  return b;
}
