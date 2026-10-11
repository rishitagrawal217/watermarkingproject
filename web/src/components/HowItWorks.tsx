import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Card, cn } from "./ui";

type Node = { t: string; s: string; tone: string };
const EMBED: Node[] = [
  { t: "Cover image", s: "8-bit gray · key · image ID", tone: "from-slate-500/40 to-slate-600/20" },
  { t: "① Robust watermark", s: "Haar DWT → 8×8 DCT → QIM Δ=60, 32×32 logo", tone: "from-cyan/40 to-cyan/10" },
  { t: "② Steganography", s: "Fernet-encrypted payload → keyed LSBs", tone: "from-violet/45 to-violet/10" },
  { t: "③ Fragile tags", s: "HMAC(key|id|block|7 MSBs) → 16 bits per block", tone: "from-pink/40 to-pink/10" },
  { t: "Protected PNG", s: "looks identical (~42.6 dB)", tone: "from-good/35 to-good/10" },
];
const VERIFY: Node[] = [
  { t: "Received image", s: "+ key + image ID", tone: "from-slate-500/40 to-slate-600/20" },
  { t: "Tag check", s: "recompute HMAC over 7 MSBs, compare", tone: "from-pink/40 to-pink/10" },
  { t: "Stego extraction", s: "keyed LSB read → decrypt, or None", tone: "from-violet/45 to-violet/10" },
  { t: "Watermark extraction", s: "blind QIM, min summed lattice distance", tone: "from-cyan/40 to-cyan/10" },
  { t: "Verdict", s: "tamper map · payload · logo + NC", tone: "from-good/35 to-good/10" },
];

function Row({ label, nodes }: { label: string; nodes: Node[] }) {
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-mute">{label}</p>
      <ol className="grid items-stretch gap-3 md:grid-cols-5">
        {nodes.map((n, i) => (
          <motion.li key={n.t} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.09 }} className="relative">
            <div className={cn("h-full rounded-2xl border border-white/10 bg-gradient-to-br p-4", n.tone)}>
              <p className="font-display text-[15px] font-semibold">{n.t}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink/70">{n.s}</p>
            </div>
            {i < nodes.length - 1 && <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 text-mute md:block">→</span>}
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

const Why = ({ n, t, children }: { n: string; t: string; children: ReactNode }) => (
  <div className="glass rounded-2xl p-5"><p className="font-mono text-xs text-violet">{n}</p><h4 className="mt-1 font-display text-base font-semibold">{t}</h4><p className="mt-2 text-sm leading-relaxed text-mute">{children}</p></div>
);

export default function HowItWorks() {
  return (
    <div className="flex flex-col gap-6">
      <Card kicker="Architecture" title="Three layers, one passphrase, strict order">
        <div className="space-y-8"><Row label="Embedding" nodes={EMBED} /><Row label="Verification" nodes={VERIFY} /></div>
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Why n="LAYER 1" t="Robust watermark (copyright)">The logo goes into three mid-frequency DCT coefficients of the Haar low-pass band, one bit per 8×8 block in a key-shuffled order, using quantisation index modulation with step 60. Extraction is blind: for every bit it picks the lattice that is closer. It survives JPEG, noise and contrast changes.</Why>
        <Why n="LAYER 2" t="Steganography (secret payload)">Your text is encrypted with Fernet (AES-128-CBC + HMAC) under a PBKDF2-HMAC-SHA256 key (100k iterations), then its raw token bits are written into LSBs at key-scattered positions, only in the 48 pixels per block the tags don’t use. Wrong key or corruption yields a clean <code className="font-mono text-ink">None</code>.</Why>
        <Why n="LAYER 3" t="Fragile tags (tamper detection)">Each block gets a 16-bit HMAC of its position, the image ID and its 7 most significant bits, stored in its first two rows’ LSBs. Change any block and its tag fails — pinpointing the edit to an 8×8 cell.</Why>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Why n="WHY THIS ORDER" t="Tags last, over the 7 MSBs only">Layers 1 and 2 change pixel values, so tags must be computed on the final pixels. Because they only cover the 7 MSBs, the LSB writes of the other layers can never invalidate them — and the tag bits themselves live in LSBs that nothing else touches.</Why>
        <Why n="WHY image_id" t="Stops cross-image splicing">Without the image ID in the HMAC, a block cut from another image signed with the same key carries a perfectly valid tag. Binding the ID makes every tag image-specific (the Results tab measures it: recall 0% → 100%).</Why>
      </div>
    </div>
  );
}
