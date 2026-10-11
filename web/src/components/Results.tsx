import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Results as R, api } from "../api";
import { Card, Pill, Stat, TamperImage, cn } from "./ui";

const METHODS = ["LSB", "DCT", "DWT2", "Hybrid-WM", "Hybrid-full"] as const;
const LABEL: Record<string, string> = { LSB: "LSB", DCT: "Block DCT", DWT2: "2-lvl DWT", "Hybrid-WM": "Hybrid · WM layer", "Hybrid-full": "Hybrid · full" };
const ncColor = (v: number) => { const t = Math.max(0, Math.min(1, v)); return `hsl(${Math.round(t * 168)} ${60 + 15 * t}% ${34 + 10 * t}%)`; };
const fmt = (x: number, d = 2) => x.toFixed(d);

type E6Row = { embed_s: { mean: number }; extract_s: { mean: number }; embed_peak_MiB: number | null; extract_peak_MiB: number | null };

export default function Results() {
  const [d, setD] = useState<R | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.results().then(setD).catch((e) => setErr(e.message)); }, []);
  const analysis = useMemo(() => {
    if (!d) return null;
    const w = d.E2_robustness.watermark, attacks = Object.keys(w["Hybrid-full"]);
    const rows = attacks.map((a) => {
      const h = w["Hybrid-full"][a].nc.mean;
      const [bestName, best] = (["LSB", "DCT", "DWT2"] as const).map((m) => [m, w[m][a].nc.mean] as const).sort((x, y) => y[1] - x[1])[0];
      return { a, h, bestName, best, gap: best - h };
    });
    return { attacks, loses: rows.filter((r) => r.gap > 0.02), fails: rows.filter((r) => r.h < 0.5 && r.a !== "none"), rows };
  }, [d]);

  if (err) return <Card><p className="text-sm text-bad">{err}</p><p className="mt-2 font-mono text-xs text-mute">npm run experiments</p></Card>;
  if (!d || !analysis) return <div className="grid gap-6"><div className="skeleton h-28 rounded-2xl" /><div className="skeleton h-[520px] rounded-2xl" /></div>;

  const w = d.E2_robustness.watermark, e3 = d.E3_tamper, minF1 = Math.min(...Object.values(e3.per_type).map((t) => t.f1.mean));
  const full = d.E1_imperceptibility["Hybrid-full"], lay = d.E2_robustness.hybrid_other_layers, wk = d.E5_steganalysis_wrongkey.wrong_key;
  const sweep = d.E4_payload_sweep.rows.map((r) => ({ bpp: +r.bpp.toFixed(3), PSNR: +r.psnr.mean.toFixed(2), SSIM: +r.ssim.mean.toFixed(4) }));
  const e6 = d.E6_runtime as unknown as Record<string, E6Row>;
  const chi = Object.entries(d.E5_steganalysis_wrongkey.chi_square);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="violet">{d.meta.dataset}</Pill><Pill>{d.meta.images.length} images · 512×512 gray</Pill>
        <Pill>{d.meta.tamper_placements_per_image} random placements / image</Pill><Pill>Node {d.meta.node}</Pill>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Full-pipeline PSNR" value={fmt(full.psnr.mean)} unit="dB" sub={`SSIM ${fmt(full.ssim.mean, 4)} · invisible`} />
        <Stat label="Worst tamper F1" value={fmt(minF1, 4)} unit="" sub={`across ${Object.keys(e3.per_type).length} forgery types`} />
        <Stat label="False alarms" value={`${(e3.false_alarm_rate_untouched.mean_flagged_block_fraction * 100).toFixed(2)}`} unit="%" sub={`${e3.false_alarm_rate_untouched.images} untouched images`} />
        <Stat label="Max hidden payload" value={d.E4_payload_sweep.max_payload_bytes.toLocaleString()} unit="B" sub={`${fmt(d.capacity.stego_max_payload_bpp, 3)} bpp, recovered exactly`} />
      </div>

      {/* ---------------- heatmap */}
      <Card kicker="E2 · Robustness" title="Logo survival: normalised correlation per attack × method" right={<Legend2 />}>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[680px] table-fixed border-separate border-spacing-1 text-sm">
            <thead><tr><th className="w-36 text-left font-normal" />
              {METHODS.map((m) => <th key={m} className={cn("px-2 pb-1 text-center font-mono text-[11px] font-medium uppercase tracking-wide", m.startsWith("Hybrid") ? "text-violet" : "text-mute")}>{LABEL[m]}</th>)}</tr></thead>
            <tbody>
              {analysis.attacks.map((a) => {
                const best = Math.max(...METHODS.map((m) => w[m][a].nc.mean));
                return (
                  <tr key={a}><th scope="row" className="pr-3 text-left text-[13px] font-normal text-mute">{a === "none" ? "No attack" : a}</th>
                    {METHODS.map((m, i) => {
                      const v = w[m][a].nc.mean;
                      return (
                        <td key={m} title={`${LABEL[m]} · ${a}\nNC ${fmt(v, 3)} · BER ${fmt(w[m][a].ber.mean, 3)}`}>
                          <motion.div initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.03 }}
                            className={cn("grid h-9 place-items-center rounded-md font-mono text-xs text-white", v >= best - 1e-9 && v > 0.5 && "ring-2 ring-white/70")} style={{ background: ncColor(v) }}>
                            {fmt(v)}
                          </motion.div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-mute">White ring = best method for that row. Baseline Δ was calibrated so DCT ({fmt(d.meta.calibrated_delta.DCT, 1)}) and DWT ({fmt(d.meta.calibrated_delta.DWT2, 1)}) match the hybrid’s {fmt(d.meta.calibration_target_psnr)} dB.</p>
      </Card>

      {/* ---------------- honesty */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card kicker="Honest comparison" title="Where the hybrid is NOT the best">
          <ul className="space-y-2.5 text-sm">
            {analysis.loses.map((r) => (
              <li key={r.a} className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-black/20 px-3.5 py-2.5">
                <span>{r.a}</span><span className="font-mono text-xs text-mute"><span className="text-bad">{fmt(r.h)}</span> vs <span className="text-good">{fmt(r.best)}</span> · {LABEL[r.bestName]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-mute">The 16×-redundant 2-level DWT scheme averages away impulse noise, blur and cropping. The hybrid spends its single-coefficient-triplet-per-bit budget on being invisible and fast, and its value is combining three layers — not winning every watermark benchmark.</p>
        </Card>
        <Card kicker="Failure modes" title="What breaks, and by design what must">
          <ul className="space-y-2.5 text-sm">
            {analysis.fails.map((r) => <li key={r.a} className="flex justify-between gap-3 rounded-lg border border-bad/20 bg-bad/6 px-3.5 py-2.5"><span>{r.a}</span><span className="font-mono text-xs text-bad">NC {fmt(r.h)}</span></li>)}
            <li className="flex justify-between gap-3 rounded-lg border border-warn/20 bg-warn/6 px-3.5 py-2.5"><span>Crop 25% (blank)</span><span className="font-mono text-xs text-warn">NC {fmt(w["Hybrid-full"]["Crop 25%"].nc.mean)} · no error correction</span></li>
            <li className="flex justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5"><span>Payload after JPEG Q=90</span><span className="font-mono text-xs text-mute">{(lay["JPEG Q=90"].payload_recovered_rate * 100).toFixed(0)}% recovered · {(lay["JPEG Q=90"].tamper_flag_fraction.mean * 100).toFixed(0)}% blocks flagged</span></li>
            <li className="flex justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5"><span>Payload after brightness +20</span><span className="font-mono text-xs text-mute">{(lay["Brightness +20"].payload_recovered_rate * 100).toFixed(0)}% recovered (clipping)</span></li>
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-mute">LSB payload and tags are fragile on purpose: any lossy processing must flip them so edits are detectable.</p>
        </Card>
      </div>

      {/* ---------------- tamper */}
      <Card kicker="E3 · Authentication" title="Tamper localisation (block-level)" right={<Pill tone="good">false alarms {(e3.false_alarm_rate_untouched.mean_flagged_block_fraction * 100).toFixed(2)}%</Pill>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(e3.per_type).map(([name, t]) => {
            const ex = e3.examples_image0[name];
            return (
              <figure key={name} className="rounded-xl border border-white/8 bg-black/20 p-3">
                {ex && <TamperImage src={`/api/assets/${ex.asset}`} bits={ex.flagged} w={64} h={64} alt={`${name} localisation`} />}
                <figcaption className="mt-2.5">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="font-mono text-[11px] text-mute">P {fmt(t.precision.mean, 4)} · R {fmt(t.recall.mean, 4)} · F1 {fmt(t.f1.mean, 4)}</p>
                  <p className="font-mono text-[11px] text-mute/70">{t.trials} trials · FP {t.pooled.fp} · FN {t.pooled.fn}</p>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <div className="mt-5 grid gap-4 rounded-xl border border-white/8 bg-black/20 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm font-medium">Why <code className="font-mono text-violet">image_id</code> must be inside the HMAC</p>
            <p className="mt-1 text-xs leading-relaxed text-mute">Splicing an aligned block from another image signed with the same key carries a valid tag — unless the image ID is part of what is signed.</p>
          </div>
          <div className="grid min-w-[260px] gap-2">
            {(["without_image_id", "with_image_id"] as const).map((k) => {
              const v = e3.ablation_image_id["splice (aligned)"][k].recall.mean;
              return (
                <div key={k}><div className="mb-1 flex justify-between font-mono text-[11px] text-mute"><span>{k === "with_image_id" ? "with image_id" : "without image_id"}</span><span>recall {(v * 100).toFixed(0)}%</span></div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/8"><motion.div className={cn("h-full rounded-full", k === "with_image_id" ? "bg-good" : "bg-bad")} initial={{ width: 0 }} whileInView={{ width: `${Math.max(v * 100, 1.5)}%` }} viewport={{ once: true }} transition={{ duration: 0.9 }} /></div></div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ---------------- payload + steganalysis */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card kicker="E4 · Capacity" title="Image quality vs hidden payload">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={sweep} margin={{ left: -10, right: 4, top: 6 }}>
                <CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} />
                <XAxis dataKey="bpp" tick={{ fill: "#8b93a7", fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: "payload density (bits / pixel)", position: "insideBottom", offset: -2, fill: "#8b93a7", fontSize: 11 }} />
                <YAxis yAxisId="l" domain={["dataMin - 0.1", "dataMax + 0.1"]} tick={{ fill: "#22d3ee", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(1)} />
                <YAxis yAxisId="r" orientation="right" domain={["dataMin - 0.0005", "dataMax + 0.0005"]} tick={{ fill: "#ff4d8d", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(3)} />
                <Tooltip contentStyle={{ background: "#0d111b", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="l" dataKey="PSNR" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line yAxisId="r" dataKey="SSIM" stroke="#ff4d8d" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-mute">Payloads 128 B → {d.E4_payload_sweep.max_payload_bytes.toLocaleString()} B all recovered exactly in every image; the total cost is {fmt(d.E4_payload_sweep.rows[0].psnr.mean - d.E4_payload_sweep.rows.at(-1)!.psnr.mean)} dB.</p>
        </Card>
        <Card kicker="E5 · Steganalysis" title="Westfeld chi-square (mean p-value)">
          <div className="space-y-3">
            {chi.map(([name, v]) => (
              <div key={name}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="text-mute">{name}</span><span className="font-mono">{v.p_mean.toFixed(3)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-white/8"><motion.div className={cn("h-full rounded-full", name.startsWith("positive") ? "bg-violet" : v.p_mean > 0.9 ? "bg-bad" : "bg-cyan")} initial={{ width: 0 }} whileInView={{ width: `${Math.max(v.p_mean * 100, 0.8)}%` }} viewport={{ once: true }} transition={{ duration: 0.8 }} /></div></div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-mute">p ≈ 1 means LSB pairs look equalised (embedding suspected). The positive control confirms the test works; <b className="text-ink">at full capacity the hybrid is detectable</b>. At 1 KB the whole-image test is inconclusive — natural covers already give p ≈ 0, so that is not proof of invisibility.</p>
        </Card>
      </div>

      {/* ---------------- wrong key + runtime */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card kicker="E5 · Keys" title="Wrong-key behaviour">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[["Payload returned None", `${(wk.payload_none.mean * 100).toFixed(0)}%`], ["Blocks flagged", `${(wk.tamper_flag_fraction.mean * 100).toFixed(3)}%`], ["Watermark NC (wrong key)", fmt(wk.wm_nc.mean, 3)], ["Watermark NC (right key)", fmt(wk.wm_nc_correct_key.mean, 3)], ["Wrong image_id: payload ok", `${(wk.id_only_payload_ok.mean * 100).toFixed(0)}%`], ["Corrupted LSBs → None", `${(wk.corrupt_payload_none.mean * 100).toFixed(0)}%`]].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/8 bg-black/20 px-3.5 py-3"><dt className="text-xs text-mute">{k}</dt><dd className="mt-1 font-display text-xl font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-mute">A wrong key only <em>permutes</em> the watermark bits, so its NC is a small non-zero number set by the logo’s bit density — not a leak of the logo.</p>
        </Card>
        <Card kicker="E6 · Performance" title="Runtime & memory (512×512)">
          <div className="scroll-thin overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left font-mono text-[11px] uppercase tracking-wide text-mute"><th className="pb-2 font-medium">Method</th><th className="pb-2 text-right font-medium">Embed</th><th className="pb-2 text-right font-medium">Extract</th><th className="pb-2 text-right font-medium">Peak RSS ↑</th></tr></thead>
            <tbody>{METHODS.map((m) => { const r = e6[m]; return (
              <tr key={m} className="border-t border-white/6"><td className={cn("py-2", m.startsWith("Hybrid") && "text-violet")}>{LABEL[m]}</td>
                <td className="py-2 text-right font-mono text-xs">{(r.embed_s.mean * 1000).toFixed(1)} ms</td><td className="py-2 text-right font-mono text-xs">{(r.extract_s.mean * 1000).toFixed(1)} ms</td>
                <td className="py-2 text-right font-mono text-xs text-mute">{r.embed_peak_MiB?.toFixed(1) ?? "–"} / {r.extract_peak_MiB?.toFixed(1) ?? "–"} MiB</td></tr>); })}</tbody>
          </table></div>
          <p className="mt-3 text-xs text-mute">PBKDF2 (100k iterations): {(d.E6_runtime.pbkdf2_100k_seconds * 1000).toFixed(1)} ms, cached per passphrase. Memory = growth of the process’s peak RSS during one call, measured in a fresh child process (coarse, in MiB).</p>
        </Card>
      </div>
    </div>
  );
}

function Legend2() {
  return (
    <div className="hidden items-center gap-2 font-mono text-[10px] text-mute sm:flex">
      <span>0</span><span className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map(ncColor).join(",")})` }} /><span>1</span>
    </div>
  );
}
