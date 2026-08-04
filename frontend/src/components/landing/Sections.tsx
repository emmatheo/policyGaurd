import Link from "next/link";

import {
  ArrowIcon,
  BlockedIcon,
  ChainIcon,
  KeyInEnclaveIcon,
  LimitIcon,
  SignedIcon,
  WalletIcon,
} from "./icons";

/* ------------------------------------------------------------------ */
/* 1. What PolicyGuard is                                              */
/* ------------------------------------------------------------------ */

const PILLARS = [
  {
    Icon: KeyInEnclaveIcon,
    title: "There is no key to steal",
    body: "The XRPL signing key is generated inside a secure enclave and has no export path. Not a key in a vault — no key that exists anywhere you could copy it from.",
  },
  {
    Icon: LimitIcon,
    title: "A rule holds the account",
    body: "You set a daily spending limit. The enclave checks every payment against it before signing, so a compromised app still cannot drain the account.",
  },
  {
    Icon: ChainIcon,
    title: "The rule is public",
    body: "The limit and every request are recorded on Flare. Anyone can audit what the account is allowed to do, and the enclave can never exceed the published rule.",
  },
];

export function WhatItIs() {
  return (
    <section id="what" className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="What PolicyGuard is"
          title="A spending account that cannot be drained"
          body="Losing a seed phrase loses the funds. Leaking one gives them away. PolicyGuard removes the seed entirely and replaces it with a rule you control."
        />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PILLARS.map(({ Icon, title, body }) => (
            <article
              key={title}
              className="rounded-2xl border border-mint-200 bg-mint-50 p-6 transition hover:border-signal-400/50"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-forest-950 text-signal-400">
                <Icon size={21} />
              </span>
              <h3 className="mt-4 text-[17px] font-semibold text-forest-950">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-ink-700">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 2. How it works                                                     */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    Icon: WalletIcon,
    title: "You request a payment",
    body: "Sign one transaction on Flare naming the destination and amount.",
  },
  {
    Icon: ChainIcon,
    title: "Flare dispatches it",
    body: "The contract emits an instruction. Independent data providers agree it is genuine and co-sign it.",
  },
  {
    Icon: LimitIcon,
    title: "The enclave decides",
    body: "It adds up what this account has spent in the last 24 hours and compares it to your limit.",
  },
  {
    Icon: SignedIcon,
    title: "It signs, or it refuses",
    body: "Within the limit, you get a signed XRPL payment. Over it, you get a reason and no signature.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="how"
      className="bg-gradient-to-b from-mint-50 to-mint-100 py-20 sm:py-24"
    >
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps, no trust in the middle"
          body="Nothing between you and the enclave can change the answer. The rule is on-chain, the decision is in hardware."
        />

        <ol className="mt-14 grid gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ Icon, title, body }, index) => (
            <li key={title} className="relative flex flex-col items-center text-center">
              {/* The connector, drawn only between steps on the widest layout. */}
              {index < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-[52px] left-[calc(50%+58px)] hidden w-[calc(100%-116px)] items-center lg:flex"
                >
                  <span className="h-px flex-1 bg-forest-950/15" />
                  <ArrowIcon size={13} className="-ml-1 text-forest-950/30" />
                </span>
              )}

              <span className="hex flex h-[104px] w-[92px] items-center justify-center bg-white shadow-[0_8px_24px_-12px_rgba(5,23,12,0.25)]">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-signal-500 text-forest-950">
                  <Icon size={22} />
                </span>
              </span>

              <span className="mt-4 font-mono text-[12px] text-ink-400">
                Step {index + 1}
              </span>
              <h3 className="mt-1 text-[16px] font-semibold text-forest-950">{title}</h3>
              <p className="mt-1.5 max-w-[230px] text-[14px] leading-relaxed text-ink-700">
                {body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Create wallet / set policy / send payment                        */
/* ------------------------------------------------------------------ */

const FLOW = [
  {
    label: "Create wallet",
    title: "A wallet with no seed phrase",
    body: "The enclave generates the keypair and hands back only the XRPL address. There is nothing to write down, because there is nothing to lose.",
    Icon: WalletIcon,
  },
  {
    label: "Set policy",
    title: "One number, published on Flare",
    body: "Choose a daily limit. It is recorded on-chain so it can be audited, and the enclave applies whichever is stricter — the published rule or its own copy.",
    Icon: LimitIcon,
  },
  {
    label: "Send payment",
    title: "Signed only if the rule allows",
    body: "Under the limit, a real XRPL payment comes back signed and ready to submit. Over it, you get a plain explanation and no signature at all.",
    Icon: SignedIcon,
  },
];

export function ProductFlow() {
  return (
    <section id="flow" className="bg-forest-950 py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <SectionHeading
          dark
          eyebrow="Create wallet / set policy / send payment"
          title="Three actions. That is the whole product."
          body="No dashboards to learn and no configuration to get wrong. Each step is one transaction and one clear result."
        />

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {FLOW.map(({ label, title, body, Icon }, index) => (
            <article
              key={label}
              className="flex flex-col rounded-2xl border border-white/10 bg-forest-900 p-6 transition hover:border-signal-400/40"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal-500 text-forest-950">
                  <Icon size={21} />
                </span>
                <span className="font-mono text-[12px] text-white/25">
                  0{index + 1}
                </span>
              </div>
              <p className="mt-4 text-[12px] font-medium tracking-[0.08em] text-signal-400 uppercase">
                {label}
              </p>
              <h3 className="mt-1.5 text-[17px] font-semibold text-white">{title}</h3>
              <p className="mt-2 text-[14.5px] leading-relaxed text-white/55">{body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 flex justify-center">
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-3.5 text-[15px] font-medium text-forest-950 transition hover:bg-signal-400"
          >
            Try it on Coston2
            <ArrowIcon />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Live status and results                                          */
/* ------------------------------------------------------------------ */

export function LiveStatus() {
  return (
    <section id="status" className="bg-white py-20 sm:py-24">
      <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="Live status and results"
          title="Every decision leaves evidence"
          body="Each action links to its Flare transaction and the instruction the registry dispatched. You never have to take the app's word for anything."
        />

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ResultExample
            approved
            amount="4 XRP"
            reason="within daily limit: 6 XRP of 10 XRP remaining after this payment"
          />
          <ResultExample
            approved={false}
            amount="25 XRP"
            reason="daily limit exceeded: requested 25 XRP, but only 6 XRP of the 10 XRP limit remains (4 XRP already spent in the last 24 hours)"
          />
        </div>

        <p className="mt-8 text-center text-[13.5px] text-ink-500">
          Results are read from the enclave through Flare&apos;s TEE proxy and decoded in
          your browser. The examples above are the real message formats.
        </p>
      </div>
    </section>
  );
}

function ResultExample({
  approved,
  amount,
  reason,
}: {
  approved: boolean;
  amount: string;
  reason: string;
}) {
  return (
    <article
      className={`rounded-2xl border p-6 ${
        approved
          ? "border-signal-500/30 bg-signal-500/[0.07]"
          : "border-block-500/30 bg-block-500/[0.07]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-medium ${
            approved
              ? "bg-signal-500 text-forest-950"
              : "bg-block-500 text-forest-950"
          }`}
        >
          {approved ? <SignedIcon size={14} /> : <BlockedIcon size={14} />}
          {approved ? "Signed by the enclave" : "Blocked by policy"}
        </span>
        <span className="font-mono text-[13px] text-ink-500">Send {amount}</span>
      </div>

      <p className="mt-4 text-[14.5px] leading-relaxed text-forest-950">{reason}</p>

      <dl className="mt-5 grid grid-cols-3 gap-2">
        {[
          ["Limit", "10 XRP"],
          ["Spent", approved ? "0 XRP" : "4 XRP"],
          ["Remaining", approved ? "10 XRP" : "6 XRP"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white px-3 py-2.5 text-center">
            <dt className="text-[11px] tracking-wide text-ink-400 uppercase">{label}</dt>
            <dd className="mt-0.5 font-mono text-[14px] text-forest-950">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 font-mono text-[12px] text-ink-400">
        {approved
          ? "tx_blob returned · ready to submit to XRPL"
          : "no signature produced"}
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* shared                                                              */
/* ------------------------------------------------------------------ */

function SectionHeading({
  eyebrow,
  title,
  body,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  dark?: boolean;
}) {
  return (
    <div className="max-w-[640px]">
      <p
        className={`text-[12px] font-medium tracking-[0.1em] uppercase ${
          dark ? "text-signal-400" : "text-signal-600"
        }`}
      >
        {eyebrow}
      </p>
      <h2
        className={`mt-3 text-[30px] leading-[1.15] font-bold tracking-tight sm:text-[38px] ${
          dark ? "text-white" : "text-forest-950"
        }`}
      >
        {title}
      </h2>
      <p
        className={`mt-4 text-[16px] leading-relaxed ${
          dark ? "text-white/55" : "text-ink-700"
        }`}
      >
        {body}
      </p>
    </div>
  );
}
