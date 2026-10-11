import { AnimatePresence, motion } from "framer-motion";
import { Suspense, lazy, useEffect, useState } from "react";
import { Meta, api } from "./api";
import HowItWorks from "./components/HowItWorks";
import Studio from "./components/Studio";
import { Logo, cn } from "./components/ui";

const Results = lazy(() => import("./components/Results"));

const TABS = [["studio", "Studio"], ["results", "Benchmarks"], ["how", "How it works"]] as const;
type Tab = (typeof TABS)[number][0];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "studio");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.meta().then(setMeta).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { location.hash = tab; }, [tab]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/6 bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="#studio" onClick={() => setTab("studio")} className="flex items-center gap-2.5"><Logo className="size-8" /><span className="font-display text-xl font-semibold tracking-tight">Sigil</span></a>
          <nav className="flex rounded-full border border-white/10 bg-black/25 p-1 text-sm" aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={cn("relative rounded-full px-4 py-1.5 transition", tab === id ? "text-white" : "text-mute hover:text-ink")}>
                {tab === id && <motion.span layoutId="pill" className="absolute inset-0 rounded-full bg-white/12" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-24 pt-10 sm:px-6">
        <div className="mb-9 max-w-3xl">
          <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">Seal an image <span className="grad-text">three ways</span> at once.</h1>
          <p className="mt-4 text-base leading-relaxed text-mute sm:text-lg">An invisible copyright watermark, an encrypted secret message and a per-block tamper seal — woven into the same pixels, unlocked by one passphrase.</p>
        </div>
        {err && <p role="alert" className="rounded-2xl border border-bad/30 bg-bad/10 p-5 text-sm text-bad">Can’t reach the API ({err}). Start it with <code className="font-mono">npm run dev</code>.</p>}
        {!meta && !err && <div className="skeleton h-[480px] rounded-2xl" aria-busy />}
        {meta && (
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {tab === "studio" && <Studio meta={meta} />}
              {tab === "results" && <Suspense fallback={<div className="skeleton h-[520px] rounded-2xl" aria-busy />}><Results /></Suspense>}
              {tab === "how" && <HowItWorks />}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <footer className="border-t border-white/6 py-8 text-center text-xs text-mute">Sigil · Haar DWT · DCT-QIM · Fernet · HMAC-SHA256 · every number on the Benchmarks tab is measured by <code className="font-mono">npm run experiments</code></footer>
    </div>
  );
}
