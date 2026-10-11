/** E1-E6. Writes results/results.json and results/assets/*.png.  Run: npm run experiments */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { ATTACKS } from "./core/attacks.js";
import { calibrateDelta, dctEmbed, dwt2Embed } from "./core/baselines.js";
import { encodePng, loadFolder, makeLogo, randomBytes } from "./core/dataset.js";
import * as H from "./core/hybrid.js";
import { Gray } from "./core/image.js";
import { clearKeyCache, deriveKeys } from "./core/keys.js";
import { ber, mean, median, msbChangeMap, nc, prf, psnr, ssim, stat, westfeld } from "./core/metrics.js";
import { Rng } from "./core/rng.js";
import { TAMPERS } from "./core/tamper.js";
import { KEY, METHOD_NAMES, MethodName, buildMethods } from "./methods.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const SEED = 2026, PAYLOAD_BYTES = 1024;
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const FOLDER = resolve(arg("folder", join(ROOT, "data/sipi"))), N = +arg("n", "8"), PLACEMENTS = +arg("placements", "10");
const OUT = resolve(arg("out", join(ROOT, "results")));
const rngFor = (...p: (string | number)[]) => Rng.fromLabel(SEED, ...p);
const bitsToStr = (b: ArrayLike<number>) => Array.from(b as ArrayLike<number>, (v) => (v ? "1" : "0")).join("");
const sum = (a: Uint8Array) => a.reduce((x, y) => x + y, 0);
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function main() {
  mkdirSync(join(OUT, "assets"), { recursive: true });
  const data = await loadFolder(FOLDER, N);
  const names = data.map((d) => d.name), imgs = data.map((d) => d.img);
  const logo = makeLogo(), payload = randomBytes(PAYLOAD_BYTES, SEED);
  log(`dataset ${FOLDER}: ${names.join(", ")}`);

  // calibrate baselines to the hybrid WM layer's mean PSNR (delta = 60)
  const target = mean(imgs.map((im) => psnr(im, H.embedWatermark(im, logo, KEY))));
  const deltas = {
    DCT: calibrateDelta((im, d) => dctEmbed(im, logo, KEY, d), imgs, target),
    DWT2: calibrateDelta((im, d) => dwt2Embed(im, logo, KEY, d), imgs, target),
  };
  log(`target PSNR ${target.toFixed(2)} dB, calibrated delta ${JSON.stringify(deltas)}`);
  const methods = buildMethods(logo, deltas, payload);

  const results: Record<string, unknown> = {
    meta: {
      dataset: FOLDER.endsWith("sipi") ? "USC-SIPI Misc" : FOLDER, images: names, seed: SEED, payload_bytes_main: PAYLOAD_BYTES,
      hybrid_delta: H.DELTA, calibration_target_psnr: target, calibrated_delta: deltas, tamper_placements_per_image: PLACEMENTS,
      node: process.version, machine: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? ""}`, generated: new Date().toISOString(),
    },
  };

  // ---- capacity
  const { w, h } = imgs[0], px = w * h;
  results.capacity = {
    pixels: px, watermark_bits: H.wmCapacity(w, h), watermark_bpp: H.wmCapacity(w, h) / px,
    stego_raw_bits: H.stegoCapacityBits(w, h), stego_raw_bpp: H.stegoCapacityBits(w, h) / px,
    stego_max_payload_bytes: H.maxPayloadBytes(w, h), stego_max_payload_bpp: (8 * H.maxPayloadBytes(w, h)) / px,
    tag_bits: (16 * px) / 64, tag_bpp: 16 / 64,
  };

  // ---- E1
  log("E1 imperceptibility");
  const prot = {} as Record<MethodName, Gray[]>, e1: Record<string, unknown> = {};
  for (const m of METHOD_NAMES) {
    prot[m] = imgs.map((im, i) => methods[m].embed(im, i));
    const ps = imgs.map((im, i) => psnr(im, prot[m][i])), ss = imgs.map((im, i) => ssim(im, prot[m][i]));
    e1[m] = { psnr: stat(ps), ssim: stat(ss), psnr_per_image: ps };
  }
  results.E1_imperceptibility = e1;

  // ---- E2
  log("E2 robustness");
  const e2: Record<string, Record<string, unknown>> = {}, logos: Record<string, Record<string, string>> = {};
  for (const m of METHOD_NAMES) {
    e2[m] = {}; logos[m] = {};
    for (const [a, fn] of Object.entries(ATTACKS)) {
      const ncs: number[] = [], bers: number[] = [];
      for (let i = 0; i < imgs.length; i++) {
        const att = await fn(prot[m][i], rngFor("e2", m, a, i)), bits = methods[m].extract(att, i);
        ncs.push(nc(bits, logo)); bers.push(ber(bits, logo));
        if (i === 0) logos[m][a] = bitsToStr(bits);
      }
      e2[m][a] = { nc: stat(ncs), ber: stat(bers), nc_per_image: ncs };
    }
  }
  const layers: Record<string, unknown> = {};
  for (const [a, fn] of Object.entries(ATTACKS)) {
    const ok: number[] = [], fl: number[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const att = await fn(prot["Hybrid-full"][i], rngFor("e2", "Hybrid-full", a, i)), r = H.extractAll(att, 1024, KEY, `img${i}`);
      ok.push(r.payload && r.payload.equals(payload) ? 1 : 0); fl.push(sum(r.tamper) / r.tamper.length);
    }
    layers[a] = { payload_recovered_rate: mean(ok), tamper_flag_fraction: stat(fl) };
  }
  results.E2_robustness = { watermark: e2, hybrid_other_layers: layers, logos_image0: logos };

  // ---- E3
  log("E3 tamper localisation");
  const tp = imgs.map((im, i) => H.embedAll(im, logo, randomBytes(256, 1), KEY, `img${i}`));
  const tpNoId = imgs.map((im, i) => H.embedAll(im, logo, randomBytes(256, 1), KEY, `img${i}`, { bindImageId: false }));
  const nImg = imgs.length;
  type Ex = { img: Gray; flagged: Uint8Array; truth: Uint8Array };
  const runTamper = (name: string, set: Gray[], bind: boolean) => {
    const P: number[] = [], R: number[] = [], F: number[] = [];
    let TP = 0, FP = 0, FN = 0, skipped = 0, ex: Ex | null = null;
    for (let i = 0; i < nImg; i++)
      for (let k = 0; k < PLACEMENTS; k++) {
        const t = TAMPERS[name](set[i], rngFor("e3", name, i, k), set[(i + 1) % nImg]), truth = msbChangeMap(set[i], t);
        if (!sum(truth)) { skipped++; continue; }
        const flagged = H.verifyTags(t, KEY, `img${i}`, bind), r = prf(flagged, truth);
        P.push(r.precision); R.push(r.recall); F.push(r.f1); TP += r.tp; FP += r.fp; FN += r.fn;
        if (!ex && i === 0) ex = { img: t, flagged, truth };
      }
    return { out: { precision: stat(P), recall: stat(R), f1: stat(F), trials: P.length, skipped_no_msb_change: skipped,
      pooled: { tp: TP, fp: FP, fn: FN, precision: TP / Math.max(TP + FP, 1), recall: TP / Math.max(TP + FN, 1) } }, ex };
  };
  const e3: Record<string, unknown> = {}, examples: Record<string, unknown> = {};
  for (const name of Object.keys(TAMPERS)) {
    const { out, ex } = runTamper(name, tp, true);
    e3[name] = out;
    if (ex) {
      const slug = name.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
      writeFileSync(join(OUT, "assets", `tamper_${slug}.png`), await encodePng(ex.img));
      examples[name] = { asset: `tamper_${slug}.png`, flagged: bitsToStr(ex.flagged), truth: bitsToStr(ex.truth) };
    }
  }
  const ablation: Record<string, unknown> = {};
  for (const name of ["splice (aligned)", "splice (offset)"])
    ablation[name] = { without_image_id: runTamper(name, tpNoId, false).out, with_image_id: (e3 as Record<string, unknown>)[name] };
  const fa = tp.map((p, i) => { const f = H.verifyTags(p, KEY, `img${i}`); return sum(f) / f.length; });
  results.E3_tamper = {
    per_type: e3, ablation_image_id: ablation, examples_image0: examples,
    false_alarm_rate_untouched: { mean_flagged_block_fraction: mean(fa), images: nImg, blocks_per_image: px / 64 },
    tag_collision_probability_per_tampered_block: 2 ** -16,
  };

  // ---- E4
  log("E4 payload sweep");
  const sizes = [0, 128, 256, 512, 1024, 2048, 4096, 8192, 12288, 16384, 20480, H.maxPayloadBytes(w, h)];
  const rows = sizes.map((n) => {
    const ps: number[] = [], ss: number[] = [], ok: number[] = [];
    imgs.forEach((im, i) => {
      const pl = n ? randomBytes(n, i) : null, p = H.embedAll(im, logo, pl, KEY, `img${i}`);
      ps.push(psnr(im, p)); ss.push(ssim(im, p));
      if (pl) ok.push(H.extractStego(p, KEY)?.equals(pl) ? 1 : 0);
    });
    return { payload_bytes: n, bpp: (8 * n) / px, psnr: stat(ps), ssim: stat(ss), exact_recovery_rate: ok.length ? mean(ok) : null };
  });
  results.E4_payload_sweep = { max_payload_bytes: H.maxPayloadBytes(w, h), rows };

  // ---- E5
  log("E5 steganalysis + wrong key");
  const chi: Record<string, unknown> = {};
  const addChi = (name: string, arr: Gray[]) => {
    const v = arr.map(westfeld), p = v.map((x) => x.p);
    chi[name] = { p_mean: mean(p), p_median: median(p), p_per_image: p, chi2_mean: mean(v.map((x) => x.chi2)) };
  };
  addChi("cover (unmodified)", imgs);
  addChi("Hybrid-WM only", imgs.map((im) => H.embedWatermark(im, logo, KEY)));
  addChi("tags only (no payload)", imgs.map((im, i) => H.embedAll(im, logo, null, KEY, `img${i}`)));
  addChi("Hybrid-full (1 KB payload)", prot["Hybrid-full"]);
  const mx = H.maxPayloadBytes(w, h);
  addChi(`Hybrid-full (max payload ${mx} B)`, imgs.map((im, i) => H.embedAll(im, logo, randomBytes(mx, i), KEY, `img${i}`)));
  const crng = rngFor("control");
  addChi("positive control: all LSBs random", imgs.map((im) => ({ ...im, data: im.data.map((v) => (v & 0xfe) | crng.int(2)) })));
  const wk: Record<string, number[]> = { payload_none: [], tamper_flag_fraction: [], wm_nc: [], wm_nc_correct_key: [], id_only_payload_ok: [], id_only_flag_fraction: [], corrupt_payload_none: [] };
  const cand = H.stegoCandidates(w, h);
  prot["Hybrid-full"].forEach((p, i) => {
    const r = H.extractAll(p, 1024, "totally-wrong-key", `img${i}`);
    wk.payload_none.push(r.payload === null ? 1 : 0); wk.tamper_flag_fraction.push(sum(r.tamper) / r.tamper.length); wk.wm_nc.push(nc(r.wm, logo));
    wk.wm_nc_correct_key.push(nc(H.extractWatermark(p, 1024, KEY), logo));
    const r2 = H.extractAll(p, 1024, KEY, "wrong-image-id");
    wk.id_only_payload_ok.push(r2.payload ? 1 : 0); wk.id_only_flag_fraction.push(sum(r2.tamper) / r2.tamper.length);
    const bad: Gray = { ...p, data: p.data.slice() }, rr = rngFor("corrupt", i);
    for (let k = 0; k < 20000; k++) bad.data[cand[rr.int(cand.length)]] ^= 1;
    wk.corrupt_payload_none.push(H.extractStego(bad, KEY) === null ? 1 : 0);
  });
  results.E5_steganalysis_wrongkey = { chi_square: chi, wrong_key: Object.fromEntries(Object.entries(wk).map(([k, v]) => [k, stat(v)])) };

  // ---- E6
  log("E6 runtime / memory");
  const e6: Record<string, unknown> = {};
  clearKeyCache();
  let t0 = performance.now(); deriveKeys(KEY); e6.pbkdf2_100k_seconds = (performance.now() - t0) / 1000;
  mkdirSync(join(OUT, "tmp"), { recursive: true });
  writeFileSync(join(OUT, "tmp", "cover.png"), await encodePng(imgs[0]));
  const tsx = ["--import", "tsx"];
  const probe = (m: string, phase: string, file: string) => {
    const r = spawnSync(process.execPath, [...tsx, join(HERE, "memprobe.ts"), m, phase, file], { env: { ...process.env, DELTAS: JSON.stringify(deltas) }, encoding: "utf8" });
    try { return JSON.parse(r.stdout.trim().split("\n").pop()!).peakGrowthMiB as number; } catch { return null; }
  };
  for (const m of METHOD_NAMES) {
    const et: number[] = [], xt: number[] = [];
    for (let rep = 0; rep < 3; rep++)
      imgs.forEach((im, i) => {
        let a = performance.now(); const p = methods[m].embed(im, i); et.push((performance.now() - a) / 1000);
        a = performance.now(); methods[m].extract(p, i); xt.push((performance.now() - a) / 1000);
      });
    writeFileSync(join(OUT, "tmp", `prot_${m}.png`), await encodePng(methods[m].embed(imgs[0], 0)));
    e6[m] = { embed_s: stat(et), extract_s: stat(xt),
      embed_peak_MiB: probe(m, "embed", join(OUT, "tmp", "cover.png")), extract_peak_MiB: probe(m, "extract", join(OUT, "tmp", `prot_${m}.png`)) };
  }
  results.E6_runtime = e6;

  // ---- assets for the dashboard (image 0)
  const diff: Gray = { ...imgs[0], data: imgs[0].data.map((v, i) => Math.min(255, Math.abs(v - prot["Hybrid-full"][0].data[i]) * 25)) };
  writeFileSync(join(OUT, "assets", "original.png"), await encodePng(imgs[0]));
  writeFileSync(join(OUT, "assets", "protected.png"), await encodePng(prot["Hybrid-full"][0]));
  writeFileSync(join(OUT, "assets", "diff25.png"), await encodePng(diff));
  (results.meta as Record<string, unknown>).logo = bitsToStr(logo);

  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v), 2));
  rmSync(join(OUT, "tmp"), { recursive: true, force: true });
  log(`saved ${join(OUT, "results.json")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
