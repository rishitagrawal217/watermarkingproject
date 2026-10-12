/** Sigil API. Stateless: the browser holds the images, the server does the crypto + signal processing. */
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTACKS } from "./core/attacks.js";
import { decodeGray, encodePng, listFolder, makeLogo, toGray } from "./core/dataset.js";
import * as H from "./core/hybrid.js";
import { Gray } from "./core/image.js";
import { ber, nc, psnr, ssim } from "./core/metrics.js";
import { Rng } from "./core/rng.js";
import { TAMPERS } from "./core/tamper.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLES = join(ROOT, "data/sipi"), RESULTS = join(ROOT, "results"), DIST = join(ROOT, "web/dist");
const PORT = +(process.env.PORT ?? 8787);
const LOGO = makeLogo();
const bitsToStr = (b: ArrayLike<number>) => Array.from(b, (v) => (v ? "1" : "0")).join("");
const dataUrl = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;
const stripUrl = (s: string) => Buffer.from(s.replace(/^data:[^,]*,/, ""), "base64");

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const need = (cond: unknown, status: number, msg: string) => { if (!cond) throw new HttpError(status, msg); };

const sampleFiles = () => (existsSync(SAMPLES) ? listFolder(SAMPLES) : []);
const sampleName = (f: string) => basename(f, extname(f));
const findSample = (name: string) => sampleFiles().find((f) => sampleName(f) === name);

async function loadCover(body: { image?: string; sample?: string }): Promise<Gray> {
  if (body.sample) {
    const f = findSample(body.sample);
    need(f, 404, `unknown sample "${body.sample}"`);
    return toGray(f!);
  }
  need(body.image, 400, "provide `image` (data URL) or `sample`");
  try { return await toGray(stripUrl(body.image!)); } catch { throw new HttpError(400, "could not decode the image"); }
}

function checkCreds(key: unknown, imageId: unknown) {
  need(typeof key === "string" && key.length >= 1 && key.length <= 256, 400, "key must be 1-256 characters");
  need(typeof imageId === "string" && imageId.length >= 1 && imageId.length <= 200, 400, "imageId must be 1-200 characters");
}

const app = Fastify({ logger: { level: "warn" }, bodyLimit: 40 * 1024 * 1024 });
await app.register(cors, { origin: true });

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
  const status = err instanceof HttpError ? err.status : err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.status(status).send({ error: status >= 500 ? "internal error" : err.message });
});

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/meta", async () => ({
  logo: bitsToStr(LOGO), logoSize: 32,
  attacks: Object.keys(ATTACKS).filter((a) => a !== "none"),
  tampers: Object.keys(TAMPERS),
  maxPayloadBytes: H.maxPayloadBytes(512, 512),
  samples: sampleFiles().map(sampleName),
  hasResults: existsSync(join(RESULTS, "results.json")),
}));

app.get<{ Params: { name: string } }>("/api/samples/:name", async (req, reply) => {
  const f = findSample(req.params.name.replace(/\.png$/, ""));
  need(f, 404, "unknown sample");
  return reply.type("image/png").header("cache-control", "public, max-age=86400").send(await encodePng(await toGray(f!)));
});

app.post<{ Body: { image?: string; sample?: string; key: string; imageId: string; payload?: string } }>("/api/protect", async (req) => {
  const { key, imageId, payload = "" } = req.body ?? ({} as never);
  checkCreds(key, imageId);
  need(typeof payload === "string", 400, "payload must be text");
  const max = H.maxPayloadBytes(512, 512), size = Buffer.byteLength(payload, "utf8");
  need(size <= max, 413, `payload is ${size} bytes; the maximum for a 512x512 image is ${max}`);
  const cover = await loadCover(req.body);
  const t0 = performance.now();
  const prot = H.embedAll(cover, LOGO, payload.length ? payload : null, key, imageId);
  const ms = performance.now() - t0;
  const diff: Gray = { ...cover, data: cover.data.map((v, i) => Math.min(255, Math.abs(v - prot.data[i]) * 25)) };
  const [o, p, d] = await Promise.all([encodePng(cover), encodePng(prot), encodePng(diff)]);
  return {
    original: dataUrl(o), protected: dataUrl(p), diff: dataUrl(d),
    psnr: psnr(cover, prot), ssim: ssim(cover, prot), payloadBytes: size, embedMs: ms,
  };
});

type AnalyzeBody = { image: string; key: string; imageId: string; attack?: string; seed?: number; spliceDonor?: string };
app.post<{ Body: AnalyzeBody }>("/api/analyze", async (req) => {
  const { image, key, imageId, attack = "none", seed = 0, spliceDonor } = req.body ?? ({} as AnalyzeBody);
  checkCreds(key, imageId);
  need(typeof image === "string", 400, "`image` is required");
  const isAttack = attack in ATTACKS, isTamper = attack in TAMPERS;
  need(isAttack || isTamper, 400, `unknown attack "${attack}"`);
  let img: Gray;
  try { img = await decodeGray(stripUrl(image)); } catch { throw new HttpError(400, "could not decode the image"); }
  need(img.w === 512 && img.h === 512, 400, `the image must be exactly 512x512 (got ${img.w}x${img.h}); use PNG, not a resized copy`);

  const rng = Rng.fromLabel("analyze", seed, attack);
  let attacked: Gray;
  if (isTamper) {
    // splice donor: another sample protected with the same key but a different image_id
    const name = spliceDonor ?? sampleFiles().map(sampleName).find((n) => n !== "");
    const f = name ? findSample(name) : undefined;
    need(f, 400, "no splice donor available");
    const donor = H.embedAll(await toGray(f!), LOGO, "donor", key, "splice-donor");
    attacked = TAMPERS[attack](img, rng, donor);
  } else {
    attacked = await ATTACKS[attack](img, rng);
  }
  const t0 = performance.now();
  const r = H.extractAll(attacked, 1024, key, imageId);
  const ms = performance.now() - t0;
  const flagged = r.tamper.reduce((a, b) => a + b, 0);
  let payloadText: string | null = null, payloadIsText = true;
  if (r.payload) {
    payloadText = r.payload.toString("utf8");
    payloadIsText = !payloadText.includes("�");
    if (!payloadIsText) payloadText = r.payload.toString("hex");
  }
  return {
    attacked: dataUrl(await encodePng(attacked)),
    logo: bitsToStr(r.wm), nc: nc(r.wm, LOGO), ber: ber(r.wm, LOGO),
    payload: payloadText, payloadIsText, payloadBytes: r.payload?.length ?? 0,
    tamper: { w: r.tamperW, h: r.tamperH, bits: bitsToStr(r.tamper) },
    flaggedBlocks: flagged, flaggedFraction: flagged / r.tamper.length,
    psnrVsInput: psnr(img, attacked), extractMs: ms,
  };
});

app.get("/api/results", async (_req, reply) => {
  const f = join(RESULTS, "results.json");
  if (!existsSync(f)) return reply.status(404).send({ error: "results.json not found; run `npm run experiments`" });
  return reply.type("application/json").send(readFileSync(f));
});
if (existsSync(join(RESULTS, "assets")))
  await app.register(fastifyStatic, { root: join(RESULTS, "assets"), prefix: "/api/assets/", decorateReply: false });

if (existsSync(DIST)) {
  await app.register(fastifyStatic, { root: DIST, prefix: "/", wildcard: false });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith("/api/") ? reply.status(404).send({ error: "not found" }) : reply.sendFile("index.html", DIST));
}

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`Sigil API on http://127.0.0.1:${PORT}`);
