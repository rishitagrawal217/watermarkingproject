import { createHash } from "node:crypto";

/** xoshiro128** seeded from >=16 bytes. Deterministic, key-seedable, fast. */
export class Rng {
  private s = new Uint32Array(4);
  private spare: number | null = null;

  constructor(seed: Uint8Array) {
    if (seed.length < 16) throw new Error("seed must be at least 16 bytes");
    const dv = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
    for (let i = 0; i < 4; i++) this.s[i] = dv.getUint32(i * 4);
    if (!(this.s[0] | this.s[1] | this.s[2] | this.s[3])) this.s[0] = 1;
    for (let i = 0; i < 16; i++) this.u32();
  }

  static fromLabel(...parts: (string | number)[]): Rng {
    return new Rng(createHash("sha256").update(parts.join("|")).digest());
  }

  u32(): number {
    const s = this.s;
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }

  /** unbiased integer in [0, n) */
  int(n: number): number {
    const limit = 4294967296 - (4294967296 % n);
    let r: number;
    do r = this.u32(); while (r >= limit);
    return r % n;
  }

  /** inclusive-low, exclusive-high */
  range(lo: number, hi: number): number { return lo + this.int(hi - lo); }
  float(): number { return this.u32() / 4294967296; }

  normal(): number {
    if (this.spare !== null) { const v = this.spare; this.spare = null; return v; }
    let u = 0;
    while (u === 0) u = this.float();
    const v = this.float();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }
}

/** First k elements of a uniformly random permutation of 0..n-1 (partial Fisher-Yates).
 *  The prefix does not depend on k, so a reader can request a longer prefix later. */
export function permPrefix(n: number, k: number, rng: Rng): Uint32Array {
  const a = new Uint32Array(n);
  for (let i = 0; i < n; i++) a[i] = i;
  for (let i = 0; i < k; i++) {
    const j = i + rng.int(n - i);
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a.slice(0, k);
}
