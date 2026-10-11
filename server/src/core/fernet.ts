import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Fernet (AES-128-CBC + HMAC-SHA256), byte-compatible with Python's `cryptography.fernet`,
 *  operating on the RAW token (not its base64 text). `key` is 32 raw bytes. */
export const FERNET_OVERHEAD = 1 + 8 + 16 + 32;

export function fernetEncrypt(key: Buffer, plaintext: Uint8Array, now = Math.floor(Date.now() / 1000)): Buffer {
  const iv = randomBytes(16);
  const c = createCipheriv("aes-128-cbc", key.subarray(16, 32), iv);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const head = Buffer.alloc(9);
  head[0] = 0x80;
  head.writeBigUInt64BE(BigInt(now), 1);
  const body = Buffer.concat([head, iv, ct]);
  const mac = createHmac("sha256", key.subarray(0, 16)).update(body).digest();
  return Buffer.concat([body, mac]);
}

/** Returns the plaintext, or null for ANY failure (bad key, corruption, truncation). Never throws. */
export function fernetDecrypt(key: Buffer, token: Uint8Array): Buffer | null {
  try {
    const t = Buffer.from(token.buffer, token.byteOffset, token.byteLength);
    if (t.length < FERNET_OVERHEAD + 16 || (t.length - FERNET_OVERHEAD) % 16 !== 0 || t[0] !== 0x80) return null;
    const body = t.subarray(0, t.length - 32);
    const mac = createHmac("sha256", key.subarray(0, 16)).update(body).digest();
    if (!timingSafeEqual(mac, t.subarray(t.length - 32))) return null;
    const d = createDecipheriv("aes-128-cbc", key.subarray(16, 32), t.subarray(9, 25));
    return Buffer.concat([d.update(t.subarray(25, t.length - 32)), d.final()]);
  } catch {
    return null;
  }
}

/** Raw token length for an n-byte plaintext */
export const tokenLen = (n: number) => FERNET_OVERHEAD + 16 * (Math.floor(n / 16) + 1);
