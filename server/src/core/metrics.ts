import { BLOCK, Gray } from "./image.js";

export function psnr(a: Gray, b: Gray): number {
  let s = 0;
  for (let i = 0; i < a.data.length; i++) { const d = a.data[i] - b.data[i]; s += d * d; }
  const mse = s / a.data.length;
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
}

/** SSIM with the scikit-image defaults: 7x7 uniform window, sample covariance, valid region only. */
export function ssim(a: Gray, b: Gray): number {
  const { w, h } = a, win = 7, np = win * win, covNorm = np / (np - 1);
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const integral = (f: (i: number) => number) => {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += f(y * w + x); I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    return I;
  };
  const Ia = integral((i) => a.data[i]), Ib = integral((i) => b.data[i]);
  const Iaa = integral((i) => a.data[i] * a.data[i]), Ibb = integral((i) => b.data[i] * b.data[i]);
  const Iab = integral((i) => a.data[i] * b.data[i]);
  const box = (I: Float64Array, y: number, x: number) =>
    (I[(y + win) * (w + 1) + x + win] - I[y * (w + 1) + x + win] - I[(y + win) * (w + 1) + x] + I[y * (w + 1) + x]) / np;
  let sum = 0, n = 0;
  for (let y = 0; y <= h - win; y++)
    for (let x = 0; x <= w - win; x++) {
      const ux = box(Ia, y, x), uy = box(Ib, y, x);
      const vx = covNorm * (box(Iaa, y, x) - ux * ux), vy = covNorm * (box(Ibb, y, x) - uy * uy);
      const vxy = covNorm * (box(Iab, y, x) - ux * uy);
      sum += ((2 * ux * uy + C1) * (2 * vxy + C2)) / ((ux * ux + uy * uy + C1) * (vx + vy + C2));
      n++;
    }
  return sum / n;
}

/** Normalised correlation on +/-1 bits: identical -> 1, random -> ~0 */
export function nc(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < a.length; i++) { const x = 2 * a[i] - 1, y = 2 * b[i] - 1; xy += x * y; xx += x * x; yy += y * y; }
  return xy / Math.sqrt(xx * yy);
}
export function ber(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let e = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) e++;
  return e / a.length;
}

export interface PRF { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number }
/** Conventions: precision = 0 when nothing is flagged; recall = 1 when there is nothing to find. */
export function prf(pred: Uint8Array, truth: Uint8Array): PRF {
  let tp = 0, fp = 0, fn = 0;
  for (let i = 0; i < pred.length; i++) {
    if (pred[i] && truth[i]) tp++; else if (pred[i]) fp++; else if (truth[i]) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 1;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, tp, fp, fn };
}

/** Ground truth: 8x8 blocks in which at least one 7-MSB value differs. */
export function msbChangeMap(a: Gray, b: Gray): Uint8Array {
  const bw = a.w / BLOCK, bh = a.h / BLOCK, out = new Uint8Array(bw * bh);
  for (let y = 0; y < a.h; y++)
    for (let x = 0; x < a.w; x++)
      if (a.data[y * a.w + x] >> 1 !== b.data[y * a.w + x] >> 1) out[Math.floor(y / BLOCK) * bw + Math.floor(x / BLOCK)] = 1;
  return out;
}

// ---- Westfeld-Pfitzmann chi-square ------------------------------------------------------

function lgamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
/** regularised upper incomplete gamma Q(a, x) */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-14) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, hh = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    hh *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * hh;
}

/** p near 1 => value pairs (2k,2k+1) are equalised => LSB embedding suspected */
export function westfeld(img: Gray): { chi2: number; dof: number; p: number } {
  const h = new Float64Array(256);
  for (let i = 0; i < img.data.length; i++) h[img.data[i]]++;
  let chi2 = 0, used = 0;
  for (let k = 0; k < 128; k++) {
    const e = (h[2 * k] + h[2 * k + 1]) / 2;
    if (e >= 5) { chi2 += (h[2 * k] - e) ** 2 / e; used++; }
  }
  const dof = used - 1;
  return { chi2, dof, p: gammaQ(dof / 2, chi2 / 2) };
}

export function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
export function std(xs: number[]) { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); }
export function median(xs: number[]) { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
export const stat = (xs: number[]) => ({ mean: mean(xs), std: std(xs) });
