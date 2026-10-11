import { dctEmbed, dctExtract, dwt2Embed, dwt2Extract, lsbEmbed, lsbExtract } from "./core/baselines.js";
import * as H from "./core/hybrid.js";
import { Gray } from "./core/image.js";

export const KEY = "benchmark-passphrase";
export const METHOD_NAMES = ["LSB", "DCT", "DWT2", "Hybrid-WM", "Hybrid-full"] as const;
export type MethodName = (typeof METHOD_NAMES)[number];
export interface Method { embed(img: Gray, i: number): Gray; extract(img: Gray, i: number): Uint8Array }

/** `i` is the image index; the hybrid uses it for its image_id */
export function buildMethods(logo: Uint8Array, deltas: { DCT: number; DWT2: number }, payload: Buffer): Record<MethodName, Method> {
  return {
    "LSB": { embed: (im) => lsbEmbed(im, logo, KEY), extract: (im) => lsbExtract(im, logo.length, KEY) },
    "DCT": { embed: (im) => dctEmbed(im, logo, KEY, deltas.DCT), extract: (im) => dctExtract(im, logo.length, KEY, deltas.DCT) },
    "DWT2": { embed: (im) => dwt2Embed(im, logo, KEY, deltas.DWT2), extract: (im) => dwt2Extract(im, logo.length, KEY, deltas.DWT2) },
    "Hybrid-WM": { embed: (im) => H.embedWatermark(im, logo, KEY), extract: (im) => H.extractWatermark(im, logo.length, KEY) },
    "Hybrid-full": {
      embed: (im, i) => H.embedAll(im, logo, payload, KEY, `img${i}`),
      extract: (im, i) => H.extractAll(im, logo.length, KEY, `img${i}`).wm,
    },
  };
}
