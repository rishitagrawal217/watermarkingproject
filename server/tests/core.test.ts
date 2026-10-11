import { beforeAll, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS } from "../src/core/attacks.js";
import { fernetDecrypt, fernetEncrypt } from "../src/core/fernet.js";
import * as H from "../src/core/hybrid.js";
import { Gray } from "../src/core/image.js";
import { msbChangeMap, nc, psnr, ssim, westfeld } from "../src/core/metrics.js";
import { Rng, permPrefix } from "../src/core/rng.js";
import { loadFolder, makeLogo, randomBytes } from "../src/core/dataset.js";

const KEY = "correct horse battery", ID = "img-001";
let imgs: { name: string; img: Gray }[];
const logo = makeLogo();
const payload = Buffer.from("secret: owner=Alice; 2026");

beforeAll(async () => {
  imgs = await loadFolder(join(dirname(fileURLToPath(import.meta.url)), "../../data/sipi"), 8);
});

describe("hybrid pipeline", () => {
  it("embed -> extract roundtrip is exact with no attack", () => {
    const prot = H.embedAll(imgs[1].img, logo, payload, KEY, ID);
    const r = H.extractAll(prot, 1024, KEY, ID);
    expect(Array.from(r.wm)).toEqual(Array.from(logo));
    expect(r.payload?.equals(payload)).toBe(true);
    expect(r.tamper.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("roundtrip is exact on every image (watermark, payload, zero false positives)", () => {
    for (const { name, img } of imgs) {
      const prot = H.embedAll(img, logo, randomBytes(500, 3), KEY, name);
      const r = H.extractAll(prot, 1024, KEY, name);
      expect(Array.from(r.wm), name).toEqual(Array.from(logo));
      expect(r.payload?.equals(randomBytes(500, 3)), name).toBe(true);
      expect(r.tamper.some((v) => v), name).toBe(false);
    }
  });

  it("wrong key -> payload null, tamper map flagged, watermark unrecoverable", () => {
    const prot = H.embedAll(imgs[0].img, logo, payload, KEY, ID);
    const r = H.extractAll(prot, 1024, "wrong key", ID);
    expect(r.payload).toBeNull();
    expect(r.tamper.reduce((a, b) => a + b, 0) / r.tamper.length).toBeGreaterThan(0.99);
    expect(Math.abs(nc(r.wm, logo))).toBeLessThan(0.2);
  });

  it("wrong image_id flags every block but the payload still decrypts", () => {
    const prot = H.embedAll(imgs[0].img, logo, payload, KEY, ID);
    const r = H.extractAll(prot, 1024, KEY, "other-id");
    expect(r.payload?.equals(payload)).toBe(true);
    expect(r.tamper.reduce((a, b) => a + b, 0) / r.tamper.length).toBeGreaterThan(0.99);
  });

  it("a tampered block (and only that block) is flagged", () => {
    const prot = H.embedAll(imgs[1].img, logo, payload, KEY, ID);
    const t = { ...prot, data: prot.data.slice() };
    const p = (8 * 10 + 3) * 512 + 8 * 20 + 5;
    t.data[p] = (t.data[p] + 64) & 255; // changes the MSBs
    const r = H.extractAll(t, 1024, KEY, ID);
    expect(r.tamper[10 * 64 + 20]).toBe(1);
    expect(r.tamper.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("an LSB flip in the payload area is not flagged by the tags", () => {
    const prot = H.embedAll(imgs[1].img, logo, payload, KEY, ID);
    const t = { ...prot, data: prot.data.slice() };
    t.data[(8 * 5 + 4) * 512 + 8 * 5 + 4] ^= 1;
    expect(H.verifyTags(t, KEY, ID).some((v) => v)).toBe(false);
  });

  it("corrupted stego data returns null, and a cover image never throws", () => {
    const prot = H.embedAll(imgs[1].img, logo, payload, KEY, ID);
    const bad = { ...prot, data: prot.data.slice() };
    const rng = new Rng(Buffer.alloc(16, 7)), cand = H.stegoCandidates(512, 512);
    for (const i of permPrefix(cand.length, 20000, rng)) bad.data[cand[i]] ^= 1;
    expect(H.extractStego(bad, KEY)).toBeNull();
    expect(H.extractStego(imgs[5].img, KEY)).toBeNull();
  });

  it("splicing from another image protected with the same key needs image_id in the HMAC", () => {
    for (const [bind, detected] of [[true, true], [false, false]] as const) {
      const a = H.embedAll(imgs[1].img, logo, "x", KEY, "A", { bindImageId: bind });
      const b = H.embedAll(imgs[5].img, logo, "x", KEY, "B", { bindImageId: bind });
      const t = { ...a, data: a.data.slice() };
      for (let y = 64; y < 128; y++) for (let x = 128; x < 192; x++) t.data[y * 512 + x] = b.data[y * 512 + x];
      const truth = msbChangeMap(a, t), flagged = H.verifyTags(t, KEY, "A", bind);
      let tp = 0, pos = 0;
      truth.forEach((v, i) => { if (v) { pos++; if (flagged[i]) tp++; } });
      expect(pos).toBeGreaterThan(0);
      expect(tp / pos).toBeCloseTo(detected ? 1 : 0, 1);
    }
  });

  it("capacity limit: max payload fits, one block more throws", () => {
    const n = H.maxPayloadBytes(512, 512), p = randomBytes(n, 1);
    const prot = H.embedAll(imgs[1].img, logo, p, KEY, ID);
    expect(H.extractStego(prot, KEY)?.equals(p)).toBe(true);
    expect(() => H.embedAll(imgs[1].img, logo, randomBytes(n + 64, 1), KEY, ID)).toThrow();
  });

  it("imperceptibility: PSNR ~ 42-43 dB for the full pipeline, SSIM > 0.95", () => {
    const prot = H.embedAll(imgs[2].img, logo, payload, KEY, ID);
    expect(psnr(imgs[2].img, prot)).toBeGreaterThan(40);
    expect(ssim(imgs[2].img, prot)).toBeGreaterThan(0.95);
  });

  it("watermark survives JPEG Q=50", async () => {
    const prot = H.embedAll(imgs[1].img, logo, payload, KEY, ID);
    const att = await ATTACKS["JPEG Q=50"](prot, Rng.fromLabel("t"));
    expect(nc(H.extractWatermark(att, 1024, KEY), logo)).toBeGreaterThan(0.95);
  });
});

describe("primitives", () => {
  it("Fernet is byte-compatible with Python's cryptography.Fernet", () => {
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    const tokenFromPython = Buffer.from(
      "80000000006acbbfbafaf188cbdc3394c63323a0293113c0096056b07f4c7c743b40691fd71d8e90f76b28e66bbd666c7c93d4f8a958c914d58de3e946c90bddbf3a6ac2be19f630dfc4fdd5071abdacdb3c9f20bcafe74c1a", "hex");
    expect(fernetDecrypt(key, tokenFromPython)?.toString("utf8")).toBe("héllo sigil — interop");
    expect(fernetDecrypt(key, fernetEncrypt(key, Buffer.from("round")))?.toString()).toBe("round");
  });
  it("Fernet rejects a wrong key and a flipped bit without throwing", () => {
    const key = Buffer.alloc(32, 1), t = fernetEncrypt(key, Buffer.from("abc"));
    expect(fernetDecrypt(Buffer.alloc(32, 2), t)).toBeNull();
    t[30] ^= 1;
    expect(fernetDecrypt(key, t)).toBeNull();
  });
  it("PRNG permutation prefix does not depend on the requested length", () => {
    const a = permPrefix(1000, 10, new Rng(Buffer.alloc(16, 5))), b = permPrefix(1000, 500, new Rng(Buffer.alloc(16, 5)));
    expect(Array.from(a)).toEqual(Array.from(b.slice(0, 10)));
  });
  it("NC: identical 1, random ~0; SSIM(identical) = 1", () => {
    const r = new Rng(Buffer.alloc(16, 9)), a = Uint8Array.from({ length: 4096 }, () => r.int(2)), b = Uint8Array.from({ length: 4096 }, () => r.int(2));
    expect(nc(a, a)).toBeCloseTo(1, 12);
    expect(Math.abs(nc(a, b))).toBeLessThan(0.08);
    expect(ssim(imgs[0].img, imgs[0].img)).toBeCloseTo(1, 10);
  });
  it("chi-square: natural cover p~0, fully randomised LSBs p~1 (positive control)", () => {
    const g = imgs[1].img, r = new Rng(Buffer.alloc(16, 3));
    const ctrl = { ...g, data: g.data.map((v) => (v & 0xfe) | r.int(2)) };
    expect(westfeld(g).p).toBeLessThan(0.01);
    expect(westfeld(ctrl).p).toBeGreaterThan(0.9);
  });
});
