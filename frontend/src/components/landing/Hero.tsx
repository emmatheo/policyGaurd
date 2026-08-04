import Link from "next/link";

import { ArrowIcon } from "./icons";

/**
 * The hero.
 *
 * One claim, stated plainly, and a picture of the thing actually happening. The
 * five-second read is: this account has no key, and a rule decides what it signs.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-sky-300 via-sky-100 to-white">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-14 lg:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-forest-950/8 px-3 py-1.5 text-[12px] font-medium text-forest-900">
            <span className="h-1.5 w-1.5 rounded-full bg-signal-500 animate-live" />
            Live on Flare Coston2
          </span>

          <h1 className="mt-5 text-[38px] leading-[1.08] font-bold tracking-tight text-forest-950 sm:text-[52px] lg:text-[58px]">
            An XRPL account
            <br />
            with no private key.
          </h1>

          <p className="mt-5 max-w-[500px] text-[16px] leading-relaxed text-ink-700 sm:text-[17px]">
            The signing key is generated inside a secure enclave and never leaves it.
            You set one rule — a daily spending limit — and the enclave refuses to sign
            anything that breaks it.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-full bg-forest-950 px-6 py-3.5 text-[15px] font-medium text-white transition hover:bg-forest-800"
            >
              Open the app
              <ArrowIcon />
            </Link>
            <Link
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-forest-950/15 bg-white/70 px-6 py-3.5 text-[15px] font-medium text-forest-950 transition hover:bg-white"
            >
              See how it works
            </Link>
          </div>

          <p className="mt-5 text-[13px] text-ink-500">
            No seed phrase. No account. Connect a wallet and the rule does the rest.
          </p>
        </div>

        <HeroPanel />
      </div>
    </section>
  );
}

/**
 * A representation of the two outcomes, side by side.
 *
 * The refusal is shown with the same weight as the approval, because a refusal is the
 * product working rather than an error state.
 */
function HeroPanel() {
  return (
    <div className="relative">
      <div className="rounded-[22px] bg-forest-950 p-5 shadow-[0_24px_60px_-20px_rgba(5,23,12,0.5)] sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-white/60">Daily limit</p>
          <p className="font-mono text-[13px] text-white">10 XRP</p>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[40%] rounded-full bg-signal-500" />
        </div>
        <p className="mt-2 text-[12px] text-white/45">4 XRP spent · 6 XRP remaining</p>

        <div className="mt-5 space-y-2.5">
          <OutcomeRow
            approved
            amount="4 XRP"
            note="Within the limit — signed by the enclave"
          />
          <OutcomeRow
            approved={false}
            amount="25 XRP"
            note="Over the limit — no signature produced"
          />
        </div>
      </div>
    </div>
  );
}

function OutcomeRow({
  approved,
  amount,
  note,
}: {
  approved: boolean;
  amount: string;
  note: string;
}) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3.5 ${
        approved
          ? "border-signal-500/25 bg-signal-500/10"
          : "border-block-500/25 bg-block-500/10"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          approved ? "bg-signal-500 text-forest-950" : "bg-block-500 text-forest-950"
        }`}
      >
        {approved ? "✓" : "✕"}
      </span>
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-white">
          Send {amount}
          <span className="sr-only">{approved ? " — approved" : " — blocked"}</span>
        </p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-white/55">{note}</p>
      </div>
    </div>
  );
}
