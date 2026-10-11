import { motion } from "framer-motion";
import { ReactNode, useEffect, useRef } from "react";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, title, kicker, right }: { children: ReactNode; className?: string; title?: string; kicker?: string; right?: ReactNode }) {
  return (
    <section className={cn("glass rounded-2xl p-5 sm:p-6", className)}>
      {(title || kicker) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {kicker && <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">{kicker}</p>}
            {title && <h3 className="font-display text-lg font-semibold tracking-tight">{title}</h3>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "good" | "warn" | "bad" | "violet" }) {
  const t = { default: "border-white/10 text-mute", good: "border-good/30 text-good bg-good/10", warn: "border-warn/30 text-warn bg-warn/10", bad: "border-bad/30 text-bad bg-bad/10", violet: "border-violet/40 text-violet bg-violet/10" }[tone];
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]", t)}>{children}</span>;
}

export function Stat({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">{label}</p>
      <p className="mt-1.5 font-display text-3xl font-semibold tracking-tight">{value}<span className="ml-1 text-base font-medium text-mute">{unit}</span></p>
      {sub && <p className="mt-1 text-xs text-mute">{sub}</p>}
    </div>
  );
}

/** Draws a bit string (row-major, size x size) onto a crisp canvas */
export function BitGrid({ bits, size, fg = "#e8ebf4", bg = "#0a0d16", className, label }: { bits: string; size: number; fg?: string; bg?: string; className?: string; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fg;
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  }, [bits, size, fg, bg]);
  return <canvas ref={ref} width={size} height={size} role="img" aria-label={label} className={cn("pixelated aspect-square w-full rounded-lg", className)} />;
}

/** Image with a translucent overlay of flagged 8x8 blocks */
export function TamperImage({ src, bits, w, h, alt, className }: { src: string; bits: string; w: number; h: number; alt: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,77,110,0.55)";
    for (let i = 0; i < bits.length; i++) if (bits[i] === "1") ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
  }, [bits, w, h]);
  return (
    <div className={cn("relative aspect-square overflow-hidden rounded-lg bg-black", className)}>
      <img src={src} alt={alt} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <canvas ref={ref} width={w} height={h} className="pixelated absolute inset-0 h-full w-full" aria-hidden />
    </div>
  );
}

export function Gauge({ value, label, size = 112 }: { value: number; label: string; size?: number }) {
  const v = Math.max(0, Math.min(1, value)), r = (size - 14) / 2, C = 2 * Math.PI * r;
  const color = v > 0.9 ? "#34d399" : v > 0.6 ? "#fbbf24" : "#fb7185";
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${value.toFixed(3)}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="8" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={C}
          initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - v) }} transition={{ type: "spring", stiffness: 60, damping: 18 }} />
      </svg>
      <div className="absolute text-center">
        <p className="font-display text-2xl font-semibold leading-none">{value.toFixed(2)}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-mute">{label}</p>
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-white/25 border-t-white", className)} aria-hidden />;
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset=".55" stopColor="#7c5cff" /><stop offset="1" stopColor="#ff4d8d" /></linearGradient></defs>
      <path d="M16 3.5l10 4.4v8c0 5.8-4.1 9.6-10 12.2C10.1 25.5 6 21.7 6 15.9v-8z" fill="none" stroke="url(#lg)" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="16" cy="15" r="3" fill="url(#lg)" />
    </svg>
  );
}
