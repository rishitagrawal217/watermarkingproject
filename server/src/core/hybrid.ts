/**
 * Three-layer hybrid pipeline (embedding order matters):
 *   1. robust watermark   - Haar DWT (LL) -> 8x8 DCT -> QIM on 3 mid-frequency coefficients
 *   2. steganography      - Fernet-encrypted payload in the LSBs of the 48 non-reserved pixels per block
 *   3. authentication     - 16-bit HMAC tag per block over the 7 MSBs, stored in LSBs of the block's rows 0-1
 * Tags are computed LAST over the 7 MSBs only, so the LSB writes can never invalidate them.
 */
import { createHmac } from "node:crypto";
import { addBasis, dct2 } from "./dct.js";
import { fernetDecrypt, fernetEncrypt, tokenLen } from "./fernet.js";
import { BLOCK, Gray, assertShape, cloneGray, clip8 } from "./image.js";
import { deriveKeys } from "./keys.js";
import { qimDecide, qimEmbed } from "./qim.js";
import { Rng, permPrefix } from "./rng.js";

export const DELTA = 60;
export const COEFS: ReadonlyArray<readonly [number, number]> = [[2, 3], [3, 2], [3, 3]];
export const LEN_BITS = 32;
export const TAG_BITS = 16;

export interface HybridOpts { delta?: number; bindImageId?: boolean }
export interface Extracted {
  wm: Uint8Array;
  payload: Buffer | null;
  tamper: Uint8Array; // (h/8)*(w/8), 1 = block flagged
  tamperW: number;
  tamperH: number;
}

// ------------------------------------------------------------------ layer 1: watermark

export const wmCapacity = (w: number, h: number) => (w / 16) * (h / 16);

/** LL band value (orthonormal Haar) of block (bi,bj) of the LL-domain 8x8 grid */
function readLL(img: Gray, bi: number, bj: number, out: Float64Array) {
  const { data, w } = img;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const y = 2 * (bi * 8 + r), x = 2 * (bj * 8 + c);
      out[r * 8 + c] = (data[y * w + x] + data[y * w + x + 1] + data[(y + 1) * w + x] + data[(y + 1) * w + x + 1]) / 2;
    }
}

export function embedWatermark(img: Gray, bits: ArrayLike<number>, key: string, delta = DELTA): Gray {
  assertShape(img);
  const n = wmCapacity(img.w, img.h);
  if (bits.length > n) throw new Error(`watermark too long: ${bits.length} > ${n}`);
  const bw = img.w / 16;
  const sel = permPrefix(n, bits.length, new Rng(deriveKeys(key).wmSeed));
  const pix = Float64Array.from(img.data);
  const ll = new Float64Array(64), co = new Float64Array(64), dll = new Float64Array(64);
  for (let i = 0; i < bits.length; i++) {
    const bi = Math.floor(sel[i] / bw), bj = sel[i] % bw;
    readLL(img, bi, bj, ll);
    dct2(ll, co);
    dll.fill(0);
    for (const [u, v] of COEFS) addBasis(dll, u, v, qimEmbed(co[u * 8 + v], bits[i], delta) - co[u * 8 + v]);
    // inverse Haar of a pure LL change: every pixel of each 2x2 cell moves by dLL/2
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const y = 2 * (bi * 8 + r), x = 2 * (bj * 8 + c), d = dll[r * 8 + c] / 2;
        pix[y * img.w + x] += d; pix[y * img.w + x + 1] += d;
        pix[(y + 1) * img.w + x] += d; pix[(y + 1) * img.w + x + 1] += d;
      }
  }
  const out = new Uint8Array(pix.length);
  for (let i = 0; i < pix.length; i++) out[i] = clip8(pix[i]);
  return { w: img.w, h: img.h, data: out };
}

export function extractWatermark(img: Gray, nbits: number, key: string, delta = DELTA): Uint8Array {
  assertShape(img);
  const bw = img.w / 16;
  const sel = permPrefix(wmCapacity(img.w, img.h), nbits, new Rng(deriveKeys(key).wmSeed));
  const ll = new Float64Array(64), co = new Float64Array(64), sub = new Float64Array(3);
  const bits = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) {
    readLL(img, Math.floor(sel[i] / bw), sel[i] % bw, ll);
    dct2(ll, co);
    COEFS.forEach(([u, v], k) => (sub[k] = co[u * 8 + v]));
    bits[i] = qimDecide(sub, delta);
  }
  return bits;
}

// ------------------------------------------------------------------ layer 2: steganography

const candCache = new Map<string, Uint32Array>();
/** flat indices of the 48 non-reserved pixels (rows 2..7) of every 8x8 block */
export function stegoCandidates(w: number, h: number): Uint32Array {
  const k = `${w}x${h}`;
  let c = candCache.get(k);
  if (!c) {
    c = new Uint32Array((w * h * 6) / 8);
    let j = 0;
    for (let y = 0; y < h; y++) if (y % BLOCK >= 2) for (let x = 0; x < w; x++) c[j++] = y * w + x;
    candCache.set(k, c);
  }
  return c;
}
export const stegoCapacityBits = (w: number, h: number) => stegoCandidates(w, h).length - LEN_BITS;
export function maxPayloadBytes(w: number, h: number): number {
  const capBytes = Math.floor(stegoCapacityBits(w, h) / 8);
  let n = 0;
  while (tokenLen(n + 1) <= capBytes) n++;
  return n;
}

export function embedStego(img: Gray, payload: Uint8Array | string, key: string): Gray {
  assertShape(img);
  const pt = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const token = fernetEncrypt(deriveKeys(key).fernet, pt);
  if (token.length * 8 > stegoCapacityBits(img.w, img.h))
    throw new Error(`payload too large (max ${maxPayloadBytes(img.w, img.h)} bytes)`);
  const framed = Buffer.concat([Buffer.alloc(4), token]);
  framed.writeUInt32BE(token.length, 0);
  const cand = stegoCandidates(img.w, img.h);
  const pos = permPrefix(cand.length, framed.length * 8, new Rng(deriveKeys(key).stegoSeed));
  const out = cloneGray(img);
  for (let i = 0; i < pos.length; i++) {
    const bit = (framed[i >> 3] >> (7 - (i & 7))) & 1;
    const p = cand[pos[i]];
    out.data[p] = (out.data[p] & 0xfe) | bit;
  }
  return out;
}

/** Decrypted payload, or null for wrong key / corrupted / absent data. Never throws. */
export function extractStego(img: Gray, key: string): Buffer | null {
  try {
    assertShape(img);
    const cand = stegoCandidates(img.w, img.h);
    const seed = deriveKeys(key).stegoSeed;
    const readBits = (k: number) => {
      const pos = permPrefix(cand.length, k, new Rng(seed));
      const bytes = Buffer.alloc(Math.ceil(k / 8));
      for (let i = 0; i < k; i++) bytes[i >> 3] |= (img.data[cand[pos[i]]] & 1) << (7 - (i & 7));
      return bytes;
    };
    const n = readBits(LEN_BITS).readUInt32BE(0);
    if (n === 0 || LEN_BITS + 8 * n > cand.length) return null;
    return fernetDecrypt(deriveKeys(key).fernet, readBits(LEN_BITS + 8 * n).subarray(4));
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ layer 3: fragile tags

export function computeTags(img: Gray, key: string, imageId: string, bind = true): Uint16Array {
  const { w, h, data } = img;
  const bw = w / BLOCK, bh = h / BLOCK;
  const mac = deriveKeys(key).mac;
  const id = Buffer.from(imageId, "utf8");
  const prefix = bind ? Buffer.concat([Buffer.from([id.length >> 8, id.length & 255]), id]) : Buffer.alloc(0);
  const tags = new Uint16Array(bw * bh);
  const msg = Buffer.alloc(prefix.length + 4 + 64);
  prefix.copy(msg, 0);
  for (let b = 0; b < bw * bh; b++) {
    msg.writeUInt32BE(b, prefix.length);
    const by = Math.floor(b / bw), bx = b % bw;
    let o = prefix.length + 4;
    for (let r = 0; r < BLOCK; r++) {
      const base = (by * BLOCK + r) * w + bx * BLOCK;
      for (let c = 0; c < BLOCK; c++) msg[o++] = data[base + c] >> 1;
    }
    const d = createHmac("sha256", mac).update(msg).digest();
    tags[b] = (d[0] << 8) | d[1];
  }
  return tags;
}

export function embedTags(img: Gray, key: string, imageId: string, bind = true): Gray {
  const out = cloneGray(img);
  const bw = img.w / BLOCK;
  const tags = computeTags(img, key, imageId, bind);
  for (let b = 0; b < tags.length; b++) {
    const by = Math.floor(b / bw), bx = b % bw;
    for (let i = 0; i < TAG_BITS; i++) {
      const bit = (tags[b] >> (15 - i)) & 1;
      const p = (by * BLOCK + (i >> 3)) * img.w + bx * BLOCK + (i & 7); // rows 0-1 of the block
      out.data[p] = (out.data[p] & 0xfe) | bit;
    }
  }
  return out;
}

/** 1 where the stored tag does not match the recomputed one */
export function verifyTags(img: Gray, key: string, imageId: string, bind = true): Uint8Array {
  const bw = img.w / BLOCK;
  const tags = computeTags(img, key, imageId, bind);
  const flags = new Uint8Array(tags.length);
  for (let b = 0; b < tags.length; b++) {
    const by = Math.floor(b / bw), bx = b % bw;
    let stored = 0;
    for (let i = 0; i < TAG_BITS; i++)
      stored = (stored << 1) | (img.data[(by * BLOCK + (i >> 3)) * img.w + bx * BLOCK + (i & 7)] & 1);
    flags[b] = stored !== tags[b] ? 1 : 0;
  }
  return flags;
}

// ------------------------------------------------------------------ public API

/** watermark -> steganography -> tags.  `payload = null` skips layer 2. */
export function embedAll(
  img: Gray, wmBits: ArrayLike<number>, payload: Uint8Array | string | null, key: string, imageId: string, o: HybridOpts = {},
): Gray {
  let out = embedWatermark(img, wmBits, key, o.delta ?? DELTA);
  if (payload !== null) out = embedStego(out, payload, key);
  return embedTags(out, key, imageId, o.bindImageId ?? true);
}

export function extractAll(img: Gray, nbits: number, key: string, imageId: string, o: HybridOpts = {}): Extracted {
  return {
    wm: extractWatermark(img, nbits, key, o.delta ?? DELTA),
    payload: extractStego(img, key),
    tamper: verifyTags(img, key, imageId, o.bindImageId ?? true),
    tamperW: img.w / BLOCK,
    tamperH: img.h / BLOCK,
  };
}
