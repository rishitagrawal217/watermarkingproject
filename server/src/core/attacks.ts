import sharp from "sharp";
import { Gray, cloneGray, clip8, newGray, rint } from "./image.js";
import { Rng } from "./rng.js";

export type Attack = (img: Gray, rng: Rng) => Promise<Gray> | Gray;

const reflect101 = (i: number, n: number) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
const reflect = (i: number, n: number) => (i < 0 ? -i - 1 : i >= n ? 2 * n - 1 - i : i);

const jpeg = (quality: number): Attack => async (img) => {
  const buf = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 1 } })
    .jpeg({ quality, chromaSubsampling: "4:4:4" }).toBuffer();
  const { data, info } = await sharp(buf).toColourspace("b-w").raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1) throw new Error("expected 1-channel JPEG decode");
  return { w: img.w, h: img.h, data: new Uint8Array(data) };
};

const gaussianNoise = (sigma: number): Attack => (img, rng) => {
  const o = cloneGray(img);
  for (let i = 0; i < o.data.length; i++) o.data[i] = clip8(img.data[i] + sigma * rng.normal());
  return o;
};

const saltPepper: Attack = (img, rng) => {
  const o = cloneGray(img), amount = 0.02;
  for (let i = 0; i < o.data.length; i++) {
    const r = rng.float();
    if (r < amount / 2) o.data[i] = 0; else if (r < amount) o.data[i] = 255;
  }
  return o;
};

/** cv2.GaussianBlur(img,(5,5),0): fixed binomial kernel, reflect-101 border */
const blur5: Attack = (img) => {
  const k = [1, 4, 6, 4, 1], { w, h, data } = img;
  const tmp = new Float64Array(w * h), o = newGray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) s += k[t + 2] * data[y * w + reflect101(x + t, w)];
      tmp[y * w + x] = s / 16;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let t = -2; t <= 2; t++) s += k[t + 2] * tmp[reflect101(y + t, h) * w + x];
      o.data[y * w + x] = clip8(s / 16);
    }
  return o;
};

const median3: Attack = (img) => {
  const { w, h, data } = img, o = newGray(w, h), win = new Uint8Array(9);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) win[n++] = data[reflect101(y + dy, h) * w + reflect101(x + dx, w)];
      win.sort();
      o.data[y * w + x] = win[4];
    }
  return o;
};

const crop25: Attack = (img) => {
  const o = cloneGray(img);
  for (let y = img.h / 2; y < img.h; y++) o.data.fill(0, y * img.w + img.w / 2, (y + 1) * img.w);
  return o;
};

/** 0.5x (area average) then back to full size (bilinear) */
const rescaleHalf: Attack = (img) => {
  const { w, h, data } = img, sw = w / 2, sh = h / 2, small = new Float64Array(sw * sh);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      small[y * sw + x] = rint((data[2 * y * w + 2 * x] + data[2 * y * w + 2 * x + 1] + data[(2 * y + 1) * w + 2 * x] + data[(2 * y + 1) * w + 2 * x + 1]) / 4);
  const o = newGray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fy = (y + 0.5) / 2 - 0.5, fx = (x + 0.5) / 2 - 0.5;
      const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0;
      const at = (yy: number, xx: number) => small[Math.min(sh - 1, Math.max(0, yy)) * sw + Math.min(sw - 1, Math.max(0, xx))];
      o.data[y * w + x] = clip8((1 - ty) * ((1 - tx) * at(y0, x0) + tx * at(y0, x0 + 1)) + ty * ((1 - tx) * at(y0 + 1, x0) + tx * at(y0 + 1, x0 + 1)));
    }
  return o;
};

const brightness20: Attack = (img) => { const o = cloneGray(img); for (let i = 0; i < o.data.length; i++) o.data[i] = clip8(img.data[i] + 20); return o; };
const contrast09: Attack = (img) => { const o = cloneGray(img); for (let i = 0; i < o.data.length; i++) o.data[i] = clip8((img.data[i] - 128) * 0.9 + 128); return o; };

/** 1 degree about the centre, bilinear, reflected border; the receiver does NOT resynchronise */
const rotate1: Attack = (img) => {
  const { w, h, data } = img, a = (Math.PI / 180), al = Math.cos(a), be = Math.sin(a), cx = w / 2, cy = h / 2, o = newGray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = al * (x - cx) - be * (y - cy) + cx, sy = be * (x - cx) + al * (y - cy) + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
      const at = (yy: number, xx: number) => data[reflect(yy, h) * w + reflect(xx, w)];
      o.data[y * w + x] = clip8((1 - ty) * ((1 - tx) * at(y0, x0) + tx * at(y0, x0 + 1)) + ty * ((1 - tx) * at(y0 + 1, x0) + tx * at(y0 + 1, x0 + 1)));
    }
  return o;
};

export const ATTACKS: Record<string, Attack> = {
  "none": (img) => cloneGray(img),
  "JPEG Q=90": jpeg(90), "JPEG Q=70": jpeg(70), "JPEG Q=50": jpeg(50), "JPEG Q=30": jpeg(30),
  "Gauss σ=5": gaussianNoise(5), "Gauss σ=10": gaussianNoise(10),
  "Salt&pepper 2%": saltPepper, "Blur 5x5": blur5, "Median 3x3": median3,
  "Crop 25%": crop25, "Rescale 0.5x": rescaleHalf,
  "Brightness +20": brightness20, "Contrast x0.9": contrast09, "Rotation 1°": rotate1,
};
