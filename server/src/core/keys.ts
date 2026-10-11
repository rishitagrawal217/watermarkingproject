import { createHmac, pbkdf2Sync } from "node:crypto";

export const PBKDF2_ITERS = 100_000;
const SALT = Buffer.from("sigil-wm-steg-v1");

export interface Keys { fernet: Buffer; mac: Buffer; wmSeed: Buffer; stegoSeed: Buffer }
const cache = new Map<string, Keys>();

/** One PBKDF2-HMAC-SHA256 (100k iterations); independent sub-keys via HMAC domain separation. */
export function deriveKeys(passphrase: string): Keys {
  const hit = cache.get(passphrase);
  if (hit) return hit;
  const master = pbkdf2Sync(passphrase, SALT, PBKDF2_ITERS, 32, "sha256");
  const sub = (label: string) => createHmac("sha256", master).update(label).digest();
  const k: Keys = { fernet: master, mac: sub("tag-mac"), wmSeed: sub("wm-perm"), stegoSeed: sub("stego-perm") };
  if (cache.size > 64) cache.clear();
  cache.set(passphrase, k);
  return k;
}
export const clearKeyCache = () => cache.clear();
