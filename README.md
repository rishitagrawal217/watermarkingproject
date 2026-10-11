# Sigil — hybrid watermarking + steganography + tamper authentication

TypeScript rebuild of the Python project: **Fastify** backend (Node 22, `sharp` for image I/O and JPEG) and a **React 18 + Vite + Tailwind v4 + Framer Motion** frontend. No Python.

Three key-based layers on an 8-bit grayscale 512×512 image, embedded in this order:

1. **Robust watermark** — Haar DWT (LL) → 8×8 DCT → QIM (Δ=60) on coefficients (2,3),(3,2),(3,3); 32×32 logo, 1 bit/block in key-shuffled order; blind extraction.
2. **Steganography** — Fernet (AES-128-CBC + HMAC) under a PBKDF2-HMAC-SHA256 (100k) key; 32-bit length + raw token bits in the LSBs of the 48 non-reserved pixels per block, key-scattered. Wrong key / corruption → `null`.
3. **Fragile tags** — 16-bit `HMAC-SHA256(key | image_id | block_index | 7 MSBs)` per block, stored in the LSBs of the block's first two rows, computed last. `image_id` is inside the HMAC.

## Run
```bash
npm install
npm test                 # 16 unit tests (vitest)
npm run experiments      # E1–E6 -> results/results.json (+ results/assets), ~35 s
npm run dev              # API :8787 + Vite :5173  ->  http://localhost:5173
npm start                # production: builds the UI, serves UI + API on http://127.0.0.1:8787
```
`npm run experiments -- --folder PATH --n 8 --placements 10` accepts any folder of images (converted to gray, centre-cropped, resized to 512²). The default folder is `data/sipi` (8 USC-SIPI Misc 512×512 images).

## Layout
| Path | Content |
|---|---|
| `server/src/core/hybrid.ts` | the three layers, `embedAll` / `extractAll` |
| `server/src/core/{baselines,attacks,tamper,metrics,dataset}.ts` | baselines (LSB, block-DCT, 2-level DWT), 14 attacks, 7 forgeries, PSNR/SSIM/NC/BER/P-R-F1/chi-square, loader |
| `server/src/core/{fernet,keys,rng,dct,qim}.ts` | primitives (Fernet is byte-compatible with Python's `cryptography`; tested against a Python-generated token) |
| `server/src/experiments.ts` | E1 imperceptibility · E2 robustness · E3 tamper localisation (+ image_id ablation) · E4 payload sweep · E5 chi-square & wrong key · E6 runtime/memory |
| `server/src/server.ts` | `GET /api/{meta,samples/:n,results,assets/*}`, `POST /api/{protect,analyze}` |
| `web/src` | Studio (seal → attack lab → verify), Benchmarks dashboard, How it works |
| `server/tests/core.test.ts` | roundtrip exact, wrong key, tampered block flagged, zero false positives, image_id splice, capacity, Fernet interop, … |

## API
```
POST /api/protect  { sample | image(dataURL), key, imageId, payload }
  -> { original, protected, diff, psnr, ssim, payloadBytes, embedMs }
POST /api/analyze  { image(dataURL, 512×512), key, imageId, attack, seed }
  -> { attacked, logo, nc, ber, payload|null, tamper:{w,h,bits}, flaggedFraction, ... }
```
`attack` is any of the processing attacks or forgeries listed by `GET /api/meta`. The server is stateless; the browser holds the images.

## Notes
- Save protected images as **PNG**. The LSB payload and the tags are fragile by design: any lossy processing destroys them (the watermark is what survives).
- Keys, permutations and the PRNG are specific to this implementation (xoshiro128\*\* seeded from HMAC sub-keys), so images sealed by the old Python version do not verify here.
- The Benchmarks tab renders `results/results.json` as-is; nothing is typed in by hand.
- Memory in E6 is the growth of peak RSS in a fresh child process during one call (coarse).
