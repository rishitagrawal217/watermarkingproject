import { AnimatePresence, motion } from "framer-motion";
import { Download, Eye, EyeOff, FileUp, KeyRound, Lock, LockOpen, RefreshCw, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnalyzeRes, Meta, ProtectRes, api } from "../api";
import { BitGrid, Card, Gauge, Pill, Spinner, TamperImage, cn } from "./ui";

/** Each image needs its own ID: the ID is what makes a tag image-specific, so two images sealed with the same key AND ID can be spliced undetected. */
const newImageId = () => `img-${Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); });

function CompareSlider({ a, b, labelA, labelB }: { a: string; b: string; labelA: string; labelB: string }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const move = useCallback((clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }, []);
  return (
    <div ref={box} className="relative aspect-square w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-xl bg-black"
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); move(e.clientX); }}
      onPointerMove={(e) => { if (e.buttons) move(e.clientX); }}>
      <img src={b} alt={labelB} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <img src={a} alt={labelA} className="absolute inset-0 h-full w-full object-cover" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
      <div className="pointer-events-none absolute inset-y-0 w-px bg-white/80 shadow-[0_0_12px_rgba(255,255,255,.7)]" style={{ left: `${pos}%` }}>
        <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-black/70 px-2 py-1 text-[10px] text-white backdrop-blur">⇆</div>
      </div>
      <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">{labelA}</span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider backdrop-blur">{labelB}</span>
    </div>
  );
}

type Verdict = { tone: "good" | "warn" | "bad"; icon: typeof ShieldCheck; title: string; body: string };
function verdictOf(r: AnalyzeRes, attack: string): Verdict {
  const f = r.flaggedFraction;
  if (f === 0 && r.payload !== null) return { tone: "good", icon: ShieldCheck, title: "Authentic", body: "Every 8×8 block verifies, the payload decrypted and the watermark is intact." };
  if (f === 0) return { tone: "warn", icon: ShieldQuestion, title: "Blocks intact, payload unreadable", body: "All tags verify but the hidden payload could not be decrypted (no payload embedded, or a different key)." };
  if (f > 0.95 && r.nc < 0.3 && r.payload === null) return { tone: "bad", icon: ShieldAlert, title: "Wrong key or unrelated image", body: "Nothing verifies and the watermark is unrecoverable. With a wrong key, tags, payload and watermark order are all unreadable." };
  if (f > 0.95) return { tone: "warn", icon: ShieldQuestion, title: "Globally altered — fragile layers destroyed", body: `“${attack}” changes pixels everywhere, so the fragile tags and LSB payload are gone by design. ${r.nc > 0.8 ? "The robust watermark still proves ownership." : "The watermark is also badly damaged."}` };
  return { tone: "bad", icon: ShieldAlert, title: `Tampering localised in ${r.flaggedBlocks} block${r.flaggedBlocks === 1 ? "" : "s"}`, body: `${(f * 100).toFixed(2)}% of the image fails verification; red cells mark exactly where it was edited.` };
}
const toneCls = { good: "border-good/30 bg-good/10 text-good", warn: "border-warn/30 bg-warn/10 text-warn", bad: "border-bad/30 bg-bad/10 text-bad" };

export default function Studio({ meta }: { meta: Meta }) {
  const [sample, setSample] = useState<string | null>(meta.samples[1] ?? meta.samples[0] ?? null);
  const [upload, setUpload] = useState<string | null>(null);
  const [key, setKey] = useState("my secret passphrase");
  const [showKey, setShowKey] = useState(false);
  const [imageId, setImageId] = useState(newImageId);
  const [payload, setPayload] = useState("© Alice Studio · licence #4711 · issued 2026-10");
  const [sealing, setSealing] = useState(false);
  const [sealErr, setSealErr] = useState<string | null>(null);
  const [sealed, setSealed] = useState<ProtectRes | null>(null);
  const [view, setView] = useState<"compare" | "diff" | "protected">("compare");

  const [attack, setAttack] = useState("none");
  const [seed, setSeed] = useState(0);
  const [verifyKey, setVerifyKey] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [res, setRes] = useState<AnalyzeRes | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [anErr, setAnErr] = useState<string | null>(null);

  const bytes = new TextEncoder().encode(payload).length;
  const over = bytes > meta.maxPayloadBytes;

  async function seal() {
    setSealing(true); setSealErr(null);
    try {
      const r = await api.protect({ sample: upload ? undefined : sample ?? undefined, image: upload ?? undefined, key, imageId, payload });
      setSealed(r); setOverride(null); setAttack("none"); setSeed(0); setVerifyKey(null); setView("compare");
    } catch (e) { setSealErr((e as Error).message); } finally { setSealing(false); }
  }

  const source = override ?? sealed?.protected ?? null;
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    setAnalyzing(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.analyze({ image: source, key: verifyKey ?? key, imageId, attack, seed });
        if (!cancelled) { setRes(r); setAnErr(null); }
      } catch (e) { if (!cancelled) { setAnErr((e as Error).message); setRes(null); } }
      finally { if (!cancelled) setAnalyzing(false); }
    }, 220);
    return () => { cancelled = true; clearTimeout(t); };
  }, [source, verifyKey, key, imageId, attack, seed]);

  const processing = meta.attacks;
  const verdict = res ? verdictOf(res, attack) : null;
  const VIcon = verdict?.icon;

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      {/* ------------------------------------------------ configure */}
      <aside className="flex flex-col gap-5 lg:sticky lg:top-24 lg:self-start">
        <Card kicker="Step 1" title="Choose an image">
          <div className="grid grid-cols-4 gap-2">
            {meta.samples.map((s) => (
              <button key={s} onClick={() => { setSample(s); setUpload(null); }} aria-label={`sample ${s}`} aria-pressed={!upload && sample === s}
                className={cn("relative aspect-square overflow-hidden rounded-lg border transition", !upload && sample === s ? "border-violet ring-2 ring-violet/60" : "border-white/10 opacity-70 hover:opacity-100")}>
                <img src={`/api/samples/${s}.png`} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
          <label className={cn("mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm transition", upload ? "border-violet/60 bg-violet/10 text-ink" : "border-white/15 text-mute hover:border-white/30 hover:text-ink")}>
            <Upload className="size-4" />{upload ? "Custom image loaded — click to replace" : "…or upload your own (any size, cropped to 512²)"}
            <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setUpload(await fileToDataUrl(f)); }} />
          </label>
        </Card>

        <Card kicker="Step 2" title="Secrets">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs text-mute"><KeyRound className="size-3.5" />Passphrase (derives every key)</span>
              <div className="relative">
                <input value={key} onChange={(e) => setKey(e.target.value)} type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 pr-10 font-mono text-sm" />
                <button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-mute hover:text-ink" aria-label={showKey ? "hide passphrase" : "show passphrase"}>
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs text-mute">Image ID (bound into every tag)</span>
              <div className="relative">
                <input value={imageId} onChange={(e) => setImageId(e.target.value)} spellCheck={false} className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 pr-10 font-mono text-sm" />
                <button type="button" onClick={() => setImageId(newImageId())} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-mute hover:text-ink" aria-label="generate a new image ID" title="Generate a new unique ID"><RefreshCw className="size-4" /></button>
              </div>
              <span className="mt-1.5 block text-[11px] leading-snug text-mute/80">Use a different ID for every image — two images sealed with the same key and ID can be spliced together without detection.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 flex items-center justify-between text-xs text-mute"><span>Hidden payload (encrypted)</span>
                <span className={cn("font-mono", over && "text-bad")}>{bytes.toLocaleString()} / {meta.maxPayloadBytes.toLocaleString()} B</span></span>
              <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={3} spellCheck={false} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-sm" />
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8"><div className={cn("h-full rounded-full transition-all", over ? "bg-bad" : "grad-bg")} style={{ width: `${Math.min(100, (bytes / meta.maxPayloadBytes) * 100)}%` }} /></div>
            </label>
          </div>
          <button onClick={seal} disabled={sealing || over || !key || !imageId || (!sample && !upload)}
            className="grad-bg mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 font-display text-[15px] font-semibold text-white shadow-[0_8px_30px_-8px_rgba(124,92,255,.8)] transition hover:brightness-110 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-50">
            {sealing ? <Spinner /> : <Sparkles className="size-4" />}{sealing ? "Sealing…" : sealed ? "Re-seal image" : "Seal image"}
          </button>
          {sealErr && <p role="alert" className="mt-3 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{sealErr}</p>}
        </Card>
      </aside>

      {/* ------------------------------------------------ stage */}
      <div className="flex min-w-0 flex-col gap-6">
        {!sealed ? (
          <Card className="grid min-h-[420px] place-items-center text-center">
            <div className="max-w-md">
              <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl grad-bg shadow-[0_10px_40px_-10px_rgba(124,92,255,.9)]"><Lock className="size-7 text-white" /></div>
              <h2 className="font-display text-2xl font-semibold tracking-tight">Seal an image, then try to break it</h2>
              <p className="mt-2 text-sm leading-relaxed text-mute">Sealing hides a copyright logo, an encrypted message and 4096 tamper tags inside the pixels — invisibly. Then attack it with JPEG, noise, blur or a forgery and watch each layer react.</p>
            </div>
          </Card>
        ) : (
          <>
            <Card kicker="Sealed" title="Protected image"
              right={<div className="flex flex-wrap justify-end gap-2"><Pill tone="good">{sealed.psnr.toFixed(2)} dB PSNR</Pill><Pill>SSIM {sealed.ssim.toFixed(4)}</Pill><Pill>{sealed.embedMs.toFixed(0)} ms</Pill></div>}>
              <div className="mb-3 inline-flex rounded-lg border border-white/10 bg-black/20 p-1 text-xs">
                {([["compare", "Compare"], ["diff", "Difference ×25"], ["protected", "Protected"]] as const).map(([v, l]) => (
                  <button key={v} onClick={() => setView(v)} className={cn("rounded-md px-3 py-1.5 transition", view === v ? "bg-white/12 text-ink" : "text-mute hover:text-ink")}>{l}</button>
                ))}
              </div>
              <div className="mx-auto max-w-[560px]">
                {view === "compare" && <CompareSlider a={sealed.original} b={sealed.protected} labelA="original" labelB="protected" />}
                {view === "diff" && <img src={sealed.diff} alt="difference ×25" className="aspect-square w-full rounded-xl" />}
                {view === "protected" && <img src={sealed.protected} alt="protected image" className="aspect-square w-full rounded-xl" />}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-md text-xs leading-relaxed text-mute">Drag the slider — you can’t see the difference. Save as <b className="text-ink">PNG</b>: any lossy re-save (even JPEG 90) destroys the tags and payload, by design.</p>
                <a href={sealed.protected} download={`${imageId || "protected"}.png`} className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/6 px-4 py-2.5 text-sm font-medium transition hover:bg-white/10"><Download className="size-4" />Download PNG</a>
              </div>
            </Card>

            <Card kicker="Step 3" title="Attack lab" right={override && <Pill tone="violet">verifying uploaded file</Pill>}>
              <div className="space-y-4">
                <ChipGroup title="Processing (the watermark should survive these)" items={["none", ...processing]} value={attack} onPick={setAttack} />
                <ChipGroup title="Tampering (the tags should localise these)" items={meta.tampers} value={attack} onPick={setAttack} />
                <div className="flex flex-wrap items-end gap-3 border-t border-white/8 pt-4">
                  <button onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-3.5 py-2.5 text-sm text-mute transition hover:bg-white/6 hover:text-ink"><RefreshCw className="size-4" />Re-roll randomness <span className="font-mono text-xs opacity-60">#{seed}</span></button>
                  <label className="min-w-[220px] flex-1">
                    <span className="mb-1.5 flex items-center gap-1.5 text-xs text-mute"><LockOpen className="size-3.5" />Key used to verify <span className="opacity-60">(try a wrong one)</span></span>
                    <input value={verifyKey ?? key} onChange={(e) => setVerifyKey(e.target.value)} spellCheck={false} className="w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 font-mono text-sm" />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/12 px-3.5 py-2.5 text-sm text-mute transition hover:bg-white/6 hover:text-ink">
                    <FileUp className="size-4" />Verify a file…
                    <input type="file" accept="image/png" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setOverride(await fileToDataUrl(f)); setAttack("none"); } e.target.value = ""; }} />
                  </label>
                  {override && <button onClick={() => setOverride(null)} className="text-sm text-violet underline-offset-4 hover:underline">use sealed image again</button>}
                </div>
              </div>
            </Card>

            <AnimatePresence mode="wait">
              {anErr ? (
                <motion.p key="err" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-2xl border border-bad/30 bg-bad/10 px-5 py-4 text-sm text-bad">{anErr}</motion.p>
              ) : res && verdict && VIcon ? (
                <motion.div key="res" initial={{ opacity: 0, y: 12 }} animate={{ opacity: analyzing ? 0.55 : 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="flex flex-col gap-6">
                  <div className={cn("flex items-start gap-4 rounded-2xl border p-5", toneCls[verdict.tone])}>
                    <VIcon className="mt-0.5 size-7 shrink-0" />
                    <div><h3 className="font-display text-lg font-semibold">{verdict.title}</h3><p className="mt-1 text-sm leading-relaxed text-ink/80">{verdict.body}</p></div>
                  </div>
                  <div className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
                    <Card kicker="Layer 1 · robust" title="Watermark">
                      <div className="grid grid-cols-2 gap-3">
                        <figure><BitGrid bits={meta.logo} size={meta.logoSize} label="embedded logo" fg="#9aa4bd" /><figcaption className="mt-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-mute">embedded</figcaption></figure>
                        <figure><BitGrid bits={res.logo} size={meta.logoSize} label="extracted logo" fg="#22d3ee" /><figcaption className="mt-1.5 text-center font-mono text-[10px] uppercase tracking-wider text-mute">extracted</figcaption></figure>
                      </div>
                      <div className="mt-4 flex items-center gap-4"><Gauge value={res.nc} label="NC" size={96} />
                        <p className="text-xs leading-relaxed text-mute">Normalised correlation of the recovered logo. 1.0 is perfect, ≈0 is random.</p></div>
                      <p className="mt-3 text-xs text-mute">BER {(res.ber * 100).toFixed(1)}% · blind extraction, no original needed</p>
                    </Card>
                    <Card kicker="Layer 3 · fragile" title="Tamper map" right={<Pill tone={res.flaggedBlocks === 0 ? "good" : "bad"}>{res.flaggedBlocks} / {res.tamper.bits.length}</Pill>}>
                      <TamperImage src={res.attacked} bits={res.tamper.bits} w={res.tamper.w} h={res.tamper.h} alt="attacked image with flagged blocks in red" />
                      <p className="mt-3 text-xs text-mute">{(res.flaggedFraction * 100).toFixed(2)}% of 8×8 blocks flagged · {res.extractMs.toFixed(0)} ms</p>
                    </Card>
                    <Card className="md:col-span-2 2xl:col-span-1" kicker="Layer 2 · encrypted" title="Hidden payload" right={<Pill tone={res.payload !== null ? "good" : "bad"}>{res.payload !== null ? "decrypted" : "None"}</Pill>}>
                      <div className={cn("grid min-h-[180px] place-items-center rounded-xl border p-4 text-center", res.payload !== null ? "border-good/25 bg-good/6" : "border-white/10 bg-black/25")}>
                        {res.payload !== null ? (
                          <div><LockOpen className="mx-auto mb-3 size-6 text-good" /><p className="break-words font-mono text-sm leading-relaxed">{res.payload}</p>
                            <p className="mt-3 text-[11px] text-mute">{res.payloadBytes} bytes{res.payloadIsText ? "" : " (binary, shown as hex)"}</p></div>
                        ) : (
                          <div><Lock className="mx-auto mb-3 size-6 text-mute" /><p className="text-sm text-mute">Nothing recoverable</p><p className="mt-1 text-[11px] text-mute/70">Wrong key, corrupted LSBs, or a lossy edit</p></div>
                        )}
                      </div>
                    </Card>
                  </div>
                </motion.div>
              ) : (
                <div key="sk" className="skeleton h-72 rounded-2xl" aria-busy />
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}

function ChipGroup({ title, items, value, onPick }: { title: string; items: string[]; value: string; onPick: (s: string) => void }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">{title}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((a) => (
          <button key={a} onClick={() => onPick(a)} aria-pressed={value === a}
            className={cn("rounded-full border px-3.5 py-1.5 text-[13px] transition", value === a ? "grad-bg border-transparent font-medium text-white shadow-[0_6px_20px_-8px_rgba(124,92,255,.9)]" : "border-white/12 text-mute hover:border-white/30 hover:text-ink")}>
            {a === "none" ? "No attack" : a}
          </button>
        ))}
      </div>
    </div>
  );
}
