"use client";

import { useState } from "react";

import { formatXRP } from "@/lib/format";
import type { PaymentVerdict } from "@/lib/types";
import { submitTransaction, xrplTxUrl, type SubmitResult } from "@/lib/xrpl";
import { Badge, Button, CopyableHex, ErrorNote } from "./ui";

/**
 * The enclave's answer to a payment request.
 *
 * Approval and refusal are presented with equal weight on purpose: a refusal is the
 * product working, and the reason string is the most important thing on the screen.
 */
export function VerdictCard({ verdict }: { verdict: PaymentVerdict }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!verdict.txBlob) return;
    setSubmitting(true);
    setError(null);
    try {
      setSubmitted(await submitTransaction(verdict.txBlob));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`animate-fade-up rounded-2xl border p-5 ${
        verdict.approved
          ? "border-mint-500/30 bg-mint-500/[0.06]"
          : "border-flare-500/30 bg-flare-500/[0.06]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={verdict.approved ? "good" : "bad"}>
          {verdict.approved ? "Signed by the TEE" : "Blocked by policy"}
        </Badge>
        <span className="font-mono text-xs text-slate-500">
          request #{verdict.requestId}
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-slate-200">{verdict.reason}</p>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          { label: "Limit", value: formatXRP(verdict.limitDrops) },
          { label: "Spent", value: formatXRP(verdict.spentDrops) },
          { label: "Remaining", value: formatXRP(verdict.remainingDrops) },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/8 bg-ink-950/40 px-2 py-2.5"
          >
            <dt className="text-[11px] tracking-wide text-slate-500 uppercase">
              {stat.label}
            </dt>
            <dd className="mt-0.5 font-mono text-sm text-slate-200">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {verdict.approved && verdict.txBlob && verdict.txHash && (
        <div className="mt-4 space-y-3">
          <CopyableHex label="XRPL transaction ID" value={verdict.txHash} />
          <CopyableHex label="Signed tx_blob" value={verdict.txBlob} />

          {!submitted && (
            <div>
              <Button variant="ghost" onClick={submit} busy={submitting}>
                Submit to XRPL testnet
              </Button>
              <p className="mt-2 text-xs text-slate-500">
                Optional. The enclave&apos;s job ends at the signature — submitting is
                done outside the trust boundary, and needs the wallet to be funded.
              </p>
            </div>
          )}

          {submitted && (
            <div
              className={`rounded-xl border px-3.5 py-3 text-sm ${
                submitted.accepted
                  ? "border-mint-500/30 bg-mint-500/10 text-mint-400"
                  : "border-amber-glow/30 bg-amber-glow/10 text-amber-glow"
              }`}
            >
              <p className="font-medium">{submitted.engineResult}</p>
              <p className="mt-1 text-xs text-slate-400">
                {submitted.engineResultMessage}
              </p>
              {submitted.txHash && (
                <a
                  href={xrplTxUrl(submitted.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs underline decoration-dotted underline-offset-2"
                >
                  View on the XRPL explorer
                </a>
              )}
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}
    </div>
  );
}
