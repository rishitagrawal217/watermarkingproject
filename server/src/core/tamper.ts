import { BLOCK, Gray, cloneGray, clip8 } from "./image.js";
import { Rng } from "./rng.js";

/** `other` is a different protected image (used by the splice attacks) */
export type Tamper = (img: Gray, rng: Rng, other?: Gray) => Gray;

const pos = (rng: Rng, w: number, h: number, size: number, aligned = false): [number, number] =>
  aligned
    ? [rng.int(Math.floor((h - size) / BLOCK) + 1) * BLOCK, rng.int(Math.floor((w - size) / BLOCK) + 1) * BLOCK]
    : [rng.int(h - size + 1), rng.int(w - size + 1)];

function paste(dst: Gray, src: Gray, dy: number, dx: number, sy: number, sx: number, size: number) {
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) dst.data[(dy + r) * dst.w + dx + c] = src.data[(sy + r) * src.w + sx + c];
}

const copyMove = (size: number): Tamper => (img, rng) => {
  const o = cloneGray(img);
  let sy, sx, dy, dx;
  do { [sy, sx] = pos(rng, img.w, img.h, size); [dy, dx] = pos(rng, img.w, img.h, size); }
  while (Math.abs(sy - dy) < size && Math.abs(sx - dx) < size);
  paste(o, img, dy, dx, sy, sx, size);
  return o;
};

/** same-position, block-aligned region of another image protected with the same key */
const spliceAligned: Tamper = (img, rng, other) => {
  if (!other) throw new Error("splice needs another image");
  const o = cloneGray(img), [y, x] = pos(rng, img.w, img.h, 64, true);
  paste(o, other, y, x, y, x, 64);
  return o;
};
const spliceOffset: Tamper = (img, rng, other) => {
  if (!other) throw new Error("splice needs another image");
  const o = cloneGray(img), [y, x] = pos(rng, img.w, img.h, 64), [sy, sx] = pos(rng, img.w, img.h, 64);
  paste(o, other, y, x, sy, sx, 64);
  return o;
};

const FONT: Record<string, string[]> = {
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};

/** stamps the word FORGED (5x7 bitmap font, 7x scale) at a random position */
const textOverlay: Tamper = (img, rng) => {
  const o = cloneGray(img), S = 7, text = "FORGED", width = text.length * 5 * S + (text.length - 1) * S;
  const x0 = rng.range(10, img.w - width - 10), y0 = rng.range(10, img.h - 7 * S - 10), color = rng.int(2) ? 255 : 0;
  [...text].forEach((ch, i) =>
    FONT[ch].forEach((row, gy) => [...row].forEach((v, gx) => {
      if (v !== "1") return;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++)
        o.data[(y0 + gy * S + dy) * img.w + x0 + i * 6 * S + gx * S + dx] = color;
    })));
  return o;
};

const brushStrokes: Tamper = (img, rng) => {
  const o = cloneGray(img), R = 4;
  const disk = (cx: number, cy: number, v: number) => {
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx, y = cy + dy;
      if (dx * dx + dy * dy <= R * R && x >= 0 && y >= 0 && x < img.w && y < img.h) o.data[y * img.w + x] = v;
    }
  };
  for (let s = 0; s < 4; s++) {
    const v = rng.int(256), n = rng.range(3, 6);
    let px = rng.range(20, img.w - 20), py = rng.range(20, img.h - 20);
    for (let k = 1; k < n; k++) {
      const nx = Math.min(img.w - 1, Math.max(0, px + rng.range(-60, 61))), ny = Math.min(img.h - 1, Math.max(0, py + rng.range(-60, 61)));
      const steps = Math.max(Math.abs(nx - px), Math.abs(ny - py));
      for (let t = 0; t <= steps; t++) disk(Math.round(px + ((nx - px) * t) / steps), Math.round(py + ((ny - py) * t) / steps), v);
      px = nx; py = ny;
    }
  }
  return o;
};

const subtleShift: Tamper = (img, rng) => {
  const o = cloneGray(img), [y, x] = pos(rng, img.w, img.h, 32);
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) { const i = (y + r) * img.w + x + c; o.data[i] = clip8(o.data[i] + 6); }
  return o;
};

export const TAMPERS: Record<string, Tamper> = {
  "copy-move 64px": copyMove(64),
  "copy-move 128px": copyMove(128),
  "splice (aligned)": spliceAligned,
  "splice (offset)": spliceOffset,
  "text overlay": textOverlay,
  "brush strokes": brushStrokes,
  "+6 shift 32x32": subtleShift,
};
