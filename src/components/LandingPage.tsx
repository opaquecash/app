/**
 * Marketing landing page. Design language: terse copy, ink/teal theme, ambient
 * micro-animations that *demonstrate* the protocol instead of describing it —
 * the hero is a live on-device scanner feed, each capability tile carries a
 * small kinetic proof of its mechanic. Motion respects prefers-reduced-motion
 * (MotionConfig + CSS media queries on the looping utilities).
 */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig, type Variants } from "framer-motion";
import { Footer } from "./Footer";

type LandingPageProps = {
  onEnterVault: () => void;
};

/* ── shared reveal variants ── */

const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 0.61, 0.36, 1] } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.section
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ── hero: the on-device scanner, shown rather than told ── */

const FEED_ROWS = [
  { tag: "0x4e", key: "0x82c4…91f1", match: false },
  { tag: "0xa7", key: "0x09de…44b0", match: false },
  { tag: "0x13", key: "0xfa11…c2e8", match: false },
  { tag: "0xd1", key: "0x5fa2…0d9c", match: true },
  { tag: "0x88", key: "0x61b7…ee03", match: false },
  { tag: "0x2f", key: "0xc380…7a55", match: false },
  { tag: "0x9c", key: "0x1e4f…b6d2", match: false },
  { tag: "0x60", key: "0xad77…3f19", match: false },
  { tag: "0xe5", key: "0x9302…58c4", match: false },
  { tag: "0x3b", key: "0x7c61…a0ff", match: false },
] as const;

function FeedRow({ row }: { row: (typeof FEED_ROWS)[number] }) {
  return (
    <div
      className={`flex items-center justify-between gap-4 px-4 py-2 font-mono text-[11px] sm:text-xs ${
        row.match ? "text-glow" : "text-mist/50"
      }`}
    >
      <span className="flex items-center gap-3 min-w-0">
        <span
          className={`h-1 w-1 rounded-full shrink-0 ${row.match ? "bg-glow scanner-pulse" : "bg-ink-600"}`}
          aria-hidden
        />
        <span className="truncate">announce {row.key}</span>
      </span>
      <span className="flex items-center gap-3 shrink-0">
        <span>tag {row.tag}</span>
        <span className={row.match ? "text-glow" : "text-ink-600"}>
          {row.match ? "yours" : "—"}
        </span>
      </span>
    </div>
  );
}

function ScannerCard() {
  return (
    <motion.div
      variants={rise}
      className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-ink-700 bg-ink-900/40 backdrop-blur-sm shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
    >
      <div className="flex items-center justify-between border-b border-ink-700/70 px-4 py-2.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
          <span className="h-2.5 w-2.5 rounded-full bg-ink-600" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-mist/60">
          scanner · on-device · wasm
        </span>
      </div>
      <div
        className="relative h-52 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 14%, black 86%, transparent)",
        }}
      >
        <div className="feed-scroll">
          {[...FEED_ROWS, ...FEED_ROWS].map((row, i) => (
            <FeedRow key={i} row={row} />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-ink-700/70 px-4 py-2.5 font-mono text-[10px] text-mist/60">
        <span>view-tag filter · nothing leaves the browser</span>
        <span className="text-glow/80">1 output unlocked</span>
      </div>
    </motion.div>
  );
}

/* ── capability tile visuals ── */

const STEALTH_ADDRESSES = ["0x3f81…c4a2", "0x91d0…7bcc", "0x08ee…12f4", "0xd64a…90e1"];

function CyclingAddress() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STEALTH_ADDRESSES.length), 2000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-3 font-mono text-xs">
      <span className="text-mist/60">pay →</span>
      <span className="relative inline-flex h-7 min-w-[8.5rem] items-center overflow-hidden rounded-lg border border-glow/20 bg-glow-muted/15 px-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={i}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="text-glow"
          >
            {STEALTH_ADDRESSES[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

function ChainPulse() {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-mist/70">eth</span>
      <div className="relative h-px flex-1 bg-ink-600">
        <motion.span
          className="absolute -top-[2.5px] h-1.5 w-1.5 rounded-full bg-glow shadow-[0_0_8px_rgba(94,234,212,0.8)]"
          animate={{ left: ["0%", "96%", "0%"] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      </div>
      <span className="font-mono text-[10px] uppercase tracking-wider text-mist/70">sol</span>
    </div>
  );
}

function PoolRipple() {
  return (
    <div className="relative flex h-10 items-center justify-center" aria-hidden>
      <span className="absolute h-8 w-8 rounded-full border border-glow/30 pool-ripple" />
      <span
        className="absolute h-8 w-8 rounded-full border border-glow/20 pool-ripple"
        style={{ animationDelay: "1.6s" }}
      />
      <span className="h-1.5 w-1.5 rounded-full bg-glow/80" />
    </div>
  );
}

function QuorumDots() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-glow key-breathe" />
        <span className="h-2 w-2 rounded-full bg-glow key-breathe" style={{ animationDelay: "0.8s" }} />
        <span className="h-2 w-2 rounded-full border border-ink-600" />
      </div>
      <span className="font-mono text-[10px] text-mist/70">2-of-3 quorum</span>
    </div>
  );
}

/* ── capability data ── */

type Tile = {
  title: string;
  body: string;
  visual?: React.ReactNode;
  mono?: string;
  wide?: boolean;
};

const TILES: Tile[] = [
  {
    title: "Stealth payments",
    body: "Every payment lands on a fresh address only you can spend.",
    visual: <CyclingAddress />,
    wide: true,
  },
  {
    title: "Cross-chain",
    body: "One meta-address. Wormhole carries announcements between chains.",
    visual: <ChainPulse />,
  },
  {
    title: "Names",
    body: "A human name that resolves to stealth keys on both chains.",
    mono: "0xadi.opqtest.eth",
  },
  {
    title: "ZK reputation",
    body: "Prove the trait, never the wallet. Groth16, verified on-chain.",
    mono: "proof ✓ · identity ∅",
  },
  {
    title: "Privacy pool",
    body: "Pooled amounts, association-set compliance.",
    visual: <PoolRipple />,
  },
  {
    title: "Gas-private relay",
    body: "Staked relayers submit for you. Your gas wallet stays out of it.",
    mono: "stake → bid → submit",
  },
  {
    title: "Conditional disclosure",
    body: "Reveal to a threshold quorum — only when you choose.",
    visual: <QuorumDots />,
    wide: true,
  },
];

/* ── flow ── */

const STEPS = [
  { n: "01", title: "Sign", body: "One signature derives your stealth keys." },
  { n: "02", title: "Register", body: "Put your meta-address on-chain." },
  { n: "03", title: "Receive", body: "Senders derive. You scan and sweep." },
  { n: "04", title: "Prove", body: "Optional ZK proofs, scoped per action." },
] as const;

/* ── page ── */

export function LandingPage({ onEnterVault }: LandingPageProps) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-dvh flex flex-col bg-ink-950 bg-grid-fade bg-size-grid text-white overflow-x-hidden">
        {/* ── Hero ── */}
        <Section className="relative flex flex-col items-center px-5 sm:px-8 pt-20 sm:pt-28 md:pt-32 pb-20 md:pb-28">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(94,234,212,0.07) 0%, rgba(94,234,212,0.02) 40%, transparent 70%)",
            }}
          />

          <motion.span
            variants={rise}
            className="relative inline-flex items-center gap-2 rounded-full border border-glow/25 bg-glow-muted/10 px-3.5 py-1 font-mono text-[11px] tracking-wide text-glow mb-8"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-glow scanner-pulse" aria-hidden />
            ethereum · solana · wormhole
          </motion.span>

          <motion.h1
            variants={rise}
            className="relative text-center font-display text-[2.9rem] sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.02]"
          >
            Get paid.
            <br />
            <span className="text-mist">Leave no trail.</span>
          </motion.h1>

          <motion.p
            variants={rise}
            className="relative mt-6 max-w-xl text-center text-base sm:text-lg text-mist leading-relaxed"
          >
            Opaque is a stealth-address protocol for Ethereum and Solana.
            <br className="hidden sm:block" /> Keys never leave your device.
          </motion.p>

          <motion.div variants={rise} className="relative mt-9 mb-14 flex items-center gap-3">
            <button
              type="button"
              onClick={onEnterVault}
              className="group inline-flex items-center gap-2.5 rounded-xl bg-glow px-7 py-3.5 text-sm font-semibold text-ink-950 transition-all hover:opacity-90 hover:shadow-[0_0_32px_rgba(94,234,212,0.25)] hover:scale-[1.02] active:scale-[0.98]"
            >
              Open wallet
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </button>
            <a
              href="https://docs.opaque.cash"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-xl border border-ink-600 px-7 py-3.5 text-sm font-medium text-mist transition-all hover:border-neutral-500 hover:text-white"
            >
              Docs
            </a>
          </motion.div>

          <ScannerCard />
        </Section>

        {/* ── Capabilities ── */}
        <Section className="mx-auto w-full max-w-5xl px-5 sm:px-8 pb-24 md:pb-32">
          <motion.p
            variants={rise}
            className="mb-8 font-mono text-[11px] uppercase tracking-[0.25em] text-glow"
          >
            The protocol
          </motion.p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TILES.map((t) => (
              <motion.div
                key={t.title}
                variants={rise}
                className={`group flex flex-col justify-between gap-6 rounded-2xl border border-ink-700 bg-ink-900/25 p-6 transition-colors duration-300 hover:border-glow/30 ${
                  t.wide ? "sm:col-span-2 lg:col-span-2" : ""
                }`}
              >
                <div>
                  <h3 className="font-display text-base font-bold text-white">{t.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-mist">{t.body}</p>
                </div>
                {t.visual ?? (
                  <span className="font-mono text-xs text-glow/70">{t.mono}</span>
                )}
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ── Flow ── */}
        <Section className="mx-auto w-full max-w-5xl px-5 sm:px-8 pb-24 md:pb-32">
          <motion.p
            variants={rise}
            className="mb-10 font-mono text-[11px] uppercase tracking-[0.25em] text-glow"
          >
            Four moves
          </motion.p>
          <div className="relative">
            <motion.div
              className="absolute left-0 right-0 top-[15px] hidden h-px origin-left bg-gradient-to-r from-glow/40 via-glow/15 to-transparent sm:block"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 1.1, ease: [0.22, 0.61, 0.36, 1] }}
              aria-hidden
            />
            <div className="grid gap-8 sm:grid-cols-4">
              {STEPS.map((s) => (
                <motion.div key={s.n} variants={rise} className="relative">
                  <span className="relative z-10 mb-4 flex h-8 w-8 items-center justify-center rounded-full border border-glow/30 bg-ink-950 font-mono text-[11px] font-bold text-glow">
                    {s.n}
                  </span>
                  <h3 className="font-display text-sm font-bold text-white">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-mist">{s.body}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </Section>

        {/* ── Honesty ── */}
        <Section className="mx-auto w-full max-w-5xl px-5 sm:px-8 pb-24 md:pb-32">
          <motion.div
            variants={rise}
            className="grid gap-px overflow-hidden rounded-2xl border border-ink-700 bg-ink-700/60 md:grid-cols-2"
          >
            <div className="bg-ink-950/90 p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-glow">Private</p>
              <ul className="mt-4 space-y-2 text-sm text-mist leading-relaxed">
                <li>Receives unlinkable to your public wallet.</li>
                <li>Proofs reveal eligibility, not identity.</li>
                <li>Keys and scanning stay on-device.</li>
              </ul>
            </div>
            <div className="bg-ink-950/90 p-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-flare">Not magic</p>
              <ul className="mt-4 space-y-2 text-sm text-mist leading-relaxed">
                <li>Timing and amounts still leak patterns.</li>
                <li>Local keys mean local recovery duties.</li>
                <li>Experimental — testnet first, small amounts.</li>
              </ul>
            </div>
          </motion.div>
        </Section>

        {/* ── Final CTA ── */}
        <Section className="relative mx-auto w-full max-w-5xl px-5 sm:px-8 pb-28 md:pb-36 text-center">
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-72"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 60% 70% at 50% 100%, rgba(94,234,212,0.07) 0%, transparent 70%)",
            }}
          />
          <motion.h2
            variants={rise}
            className="relative font-display text-4xl sm:text-5xl font-extrabold tracking-tight"
          >
            Disappear into
            <br />
            <span className="text-glow">the crowd.</span>
          </motion.h2>
          <motion.div variants={rise} className="relative mt-8">
            <button
              type="button"
              onClick={onEnterVault}
              className="group inline-flex items-center gap-2.5 rounded-xl bg-glow px-8 py-4 text-sm font-semibold text-ink-950 transition-all hover:opacity-90 hover:shadow-[0_0_40px_rgba(94,234,212,0.3)] hover:scale-[1.02] active:scale-[0.98]"
            >
              Open wallet
              <span className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                →
              </span>
            </button>
          </motion.div>
        </Section>

        {/* ── Footer ── */}
        <div className="mt-auto shrink-0 w-full pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Footer />
        </div>
      </div>
    </MotionConfig>
  );
}
