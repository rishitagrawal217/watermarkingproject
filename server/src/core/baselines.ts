/** Baselines (same 1024-bit logo): pure LSB, pure 8x8 block-DCT QIM, pure 2-level Haar DWT QIM (16 coefs/bit). */
import { addBasis, dct2 } from "./dct.js";
import { COEFS } from "./hybrid.js";
import { BLOCK, Gray, clip8, cloneGray } from "./image.js";
import { psnr, mean } from "./metrics.js";
import { qimDecide, qimEmbed } from "./qim.js";
import { Rng, permPrefix } from "./rng.js";

const rngFor = (key: string, label: string) => Rng.fromLabel(key, label);
const finish = (img: Gray, pix: Float64Array): Gray => {
  const o = new Uint8Array(pix.length);
  for (let i = 0; i < pix.length; i++) o[i] = clip8(pix[i]);
  return { w: img.w, h: img.h, data: o };
};

// ---- LSB
export function lsbEmbed(img: Gray, bits: ArrayLike<number>, key: string): Gray {
  const pos = permPrefix(img.data.length, bits.length, rngFor(key, "lsb")), o = cloneGray(img);
  for (let i = 0; i < bits.length; i++) o.data[pos[i]] = (o.data[pos[i]] & 0xfe) | bits[i];
  return o;
}
export function lsbExtract(img: Gray, nbits: number, key: string): Uint8Array {
  const pos = permPrefix(img.data.length, nbits, rngFor(key, "lsb"));
  return Uint8Array.from(pos, (p) => img.data[p] & 1);
}

// ---- pure block DCT (1 bit per spatial 8x8 block, same 3 coefficients)
function readBlock(img: Gray, by: number, bx: number, out: Float64Array) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) out[r * 8 + c] = img.data[(by * 8 + r) * img.w + bx * 8 + c];
}
export function dctEmbed(img: Gray, bits: ArrayLike<number>, key: string, delta = 60): Gray {
  const bw = img.w / 8, sel = permPrefix(bw * (img.h / 8), bits.length, rngFor(key, "dct"));
  const pix = Float64Array.from(img.data), blk = new Float64Array(64), co = new Float64Array(64), d = new Float64Array(64);
  for (let i = 0; i < bits.length; i++) {
    const by = Math.floor(sel[i] / bw), bx = sel[i] % bw;
    readBlock(img, by, bx, blk); dct2(blk, co); d.fill(0);
    for (const [u, v] of COEFS) addBasis(d, u, v, qimEmbed(co[u * 8 + v], bits[i], delta) - co[u * 8 + v]);
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) pix[(by * 8 + r) * img.w + bx * 8 + c] += d[r * 8 + c];
  }
  return finish(img, pix);
}
export function dctExtract(img: Gray, nbits: number, key: string, delta = 60): Uint8Array {
  const bw = img.w / 8, sel = permPrefix(bw * (img.h / 8), nbits, rngFor(key, "dct"));
  const blk = new Float64Array(64), co = new Float64Array(64), sub = new Float64Array(3), bits = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) {
    readBlock(img, Math.floor(sel[i] / bw), sel[i] % bw, blk); dct2(blk, co);
    COEFS.forEach(([u, v], k) => (sub[k] = co[u * 8 + v]));
    bits[i] = qimDecide(sub, delta);
  }
  return bits;
}

// ---- pure 2-level DWT: LL2 = (sum of a 4x4 pixel cell) / 4; a change dc moves each of the 16 pixels by dc/4
const SPREAD = 16;
const ll2 = (img: Gray, idx: number) => {
  const cw = img.w / 4, y = Math.floor(idx / cw) * 4, x = (idx % cw) * 4;
  let s = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) s += img.data[(y + r) * img.w + x + c];
  return s / 4;
};
export function dwt2Embed(img: Gray, bits: ArrayLike<number>, key: string, delta = 27): Gray {
  const n = (img.w / 4) * (img.h / 4), idx = permPrefix(n, bits.length * SPREAD, rngFor(key, "dwt2")), pix = Float64Array.from(img.data), cw = img.w / 4;
  for (let i = 0; i < bits.length; i++)
    for (let k = 0; k < SPREAD; k++) {
      const id = idx[i * SPREAD + k], c = ll2(img, id), d = (qimEmbed(c, bits[i], delta) - c) / 4;
      const y = Math.floor(id / cw) * 4, x = (id % cw) * 4;
      for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) pix[(y + r) * img.w + x + q] += d;
    }
  return finish(img, pix);
}
export function dwt2Extract(img: Gray, nbits: number, key: string, delta = 27): Uint8Array {
  const n = (img.w / 4) * (img.h / 4), idx = permPrefix(n, nbits * SPREAD, rngFor(key, "dwt2")), group = new Float64Array(SPREAD), bits = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) {
    for (let k = 0; k < SPREAD; k++) group[k] = ll2(img, idx[i * SPREAD + k]);
    bits[i] = qimDecide(group, delta);
  }
  return bits;
}

/** bisection: mean PSNR decreases monotonically with delta */
export function calibrateDelta(embed: (img: Gray, delta: number) => Gray, imgs: Gray[], target: number, lo = 5, hi = 150, iters = 14): number {
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (mean(imgs.map((im) => psnr(im, embed(im, mid)))) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
export { BLOCK };
