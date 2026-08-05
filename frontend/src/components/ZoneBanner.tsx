"use client";

import Link from "next/link";

import { ChainIcon, KeyInEnclaveIcon } from "@/components/landing/icons";

/**
 * The two trust domains, stated before anything else on the page.
 *
 * PolicyGuard is currently live in one of them and blocked in the other, and the whole
 * value of this submission rests on not blurring that line. So the split is structural
 * — a banner at the top and a badge on every step — rather than a caveat in small text.
 */

export function ZoneBanner({ teeAvailable }: { teeAvailable: boolean | null }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-signal-500/35 bg-signal-500/[0.08] p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-500 text-forest-950">
            <ChainIcon size={17} />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-forest-950">
              Live on-chain
            </p>
            <p className="text-[11.5px] text-ink-500">
              Coston2 · real transactions
            </p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-700">
          Wallet records, daily limits, and payment requests are written to
          Flare and readable by anyone. These steps work now.
        </p>
      </div>

      <div
        className={`rounded-2xl border p-4 ${
          teeAvailable
            ? "border-signal-500/35 bg-signal-500/[0.08]"
            : "border-block-500/40 bg-block-500/[0.08]"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-lg text-forest-950 ${
              teeAvailable ? "bg-signal-500" : "bg-block-500"
            }`}
          >
            <KeyInEnclaveIcon size={17} />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-forest-950">
              FCC TEE execution
            </p>
            <p className="text-[11.5px] text-ink-500">
              {teeAvailable === null
                ? "checking…"
                : teeAvailable
                  ? "enclave registered"
                  : "blocked — no enclave registered"}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-700">
          {teeAvailable
            ? "An enclave is registered and will evaluate the policy and sign."
            : "Key generation, policy evaluation, and XRPL signing all happen inside the enclave. No enclave is registered, so none of that runs — and nothing here fakes it."}
        </p>
        {!teeAvailable && (
          <Link
            href="/verify"
            className="mt-2 inline-block text-[12.5px] font-medium text-block-600 underline decoration-dotted underline-offset-2"
          >
            Why, and what unblocks it →
          </Link>
        )}
      </div>
    </div>
  );
}

/** A small badge marking which domain a step belongs to. */
export function ZoneTag({ zone }: { zone: "chain" | "tee" }) {
  const chain = zone === "chain";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        chain
          ? "bg-signal-500/15 text-signal-600"
          : "bg-block-500/15 text-block-600"
      }`}
    >
      {chain ? <ChainIcon size={12} /> : <KeyInEnclaveIcon size={12} />}
      {chain ? "Live on-chain" : "Needs TEE"}
    </span>
  );
}

/**
 * Shown after an operation that was recorded on-chain but never reached an enclave.
 *
 * Deliberately not styled as an error: the transaction succeeded and the policy record
 * is real. What did not happen is the confidential half, and that is what it says.
 */
export function PartialOutcome({
  what,
  txHash,
  explorerUrl,
}: {
  what: string;
  txHash: string;
  explorerUrl: string;
}) {
  return (
    <div className="animate-rise mt-4 rounded-xl border border-block-500/35 bg-block-500/[0.07] p-4">
      <p className="text-[13px] font-semibold text-forest-950">
        Recorded on Flare · enclave not invoked
      </p>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-700">
        {what}
      </p>
      <p className="mt-2 text-[12.5px] text-ink-500">
        The contract emitted <code className="font-mono">TeeUnavailable</code>{" "}
        because no TEE machine is registered to this extension. No key was
        generated and no signature exists — this page will not invent one.
      </p>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block font-mono text-[12px] text-signal-600 underline decoration-dotted underline-offset-2"
      >
        verify on Coston2 explorer →
      </a>
      <span className="sr-only">{txHash}</span>
    </div>
  );
}
