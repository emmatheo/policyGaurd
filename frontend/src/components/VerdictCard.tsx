"use client";

import { useState } from "react";

import { BlockedIcon, SignedIcon } from "@/components/landing/icons";
import { formatXRP } from "@/lib/format";
import type { PaymentResponse } from "@/lib/protocol";
import { submitTransaction, xrplTxUrl, type SubmitResult } from "@/lib/xrpl";
import { Badge, Button, CopyableHex, ErrorNote } from "./ui";

/**
 * The enclave's verdict, exactly as it came back through the instruction pipeline.
 *
 * Approval and refusal are given equal visual weight on purpose: a refusal is the
 * product working, and the reason is the most important thing on the screen. Refusal
 * is amber rather than red for the same reason — it is a decision, not a fault.
 */
export function VerdictCard({ verdict }: { verdict: PaymentResponse }) {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasBlob = verdict.approved && verdict.signedTxBlob.length > 0;

  async function submit() {
    if (!hasBlob) return;
    setSubmitting(true);
    setError(null);
    try {
      setSubmitted(await submitTransaction(verdict.signedTxBlob));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={`animate-rise rounded-2xl border p-5 ${
        verdict.approved
          ? "border-signal-500/35 bg-signal-500/[0.07]"
          : "border-block-500/35 bg-block-500/[0.07]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={verdict.approved ? "good" : "blocked"}>
          {verdict.approved ? <SignedIcon size={14} /> : <BlockedIcon size={14} />}
          {verdict.approved ? "Signed by the enclave" : "Blocked by policy"}
        </Badge>
        <span className="font-mono text-[12px] text-ink-500">
          request #{verdict.requestId.toString()}
        </span>
      </div>

      <p className="mt-4 text-[14.5px] leading-relaxed text-forest-950">
        {verdict.reason}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[
          { label: "Limit", value: formatXRP(verdict.limitDrops) },
          { label: "Spent", value: formatXRP(verdict.spentDrops) },
          { label: "Remaining", value: formatXRP(verdict.remainingDrops) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-white px-2 py-2.5 text-center">
            <dt className="text-[11px] tracking-wide text-ink-400 uppercase">
              {stat.label}
            </dt>
            <dd className="mt-0.5 font-mono text-[14px] text-forest-950">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {hasBlob && (
        <div className="mt-4 space-y-3">
          <CopyableHex label="XRPL transaction ID" value={verdict.txHash} />
          <CopyableHex label="Signed tx_blob" value={verdict.signedTxBlob} />

          {!submitted && (
            <div>
              <Button variant="ghost" onClick={submit} busy={submitting}>
                Submit to XRPL testnet
              </Button>
              <p className="mt-2 text-[12.5px] text-ink-500">
                Optional. The enclave&apos;s job ends at the signature — submitting
                happens outside the trust boundary and needs the wallet to be funded.
              </p>
            </div>
          )}

          {submitted && (
            <div
              className={`rounded-xl border px-3.5 py-3 ${
                submitted.accepted
                  ? "border-signal-500/30 bg-signal-500/10"
                  : "border-block-500/30 bg-block-500/10"
              }`}
            >
              <p className="font-mono text-[13px] font-medium text-forest-950">
                {submitted.engineResult}
              </p>
              <p className="mt-1 text-[12.5px] text-ink-700">
                {submitted.engineResultMessage}
              </p>
              {submitted.txHash && (
                <a
                  href={xrplTxUrl(submitted.txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[12.5px] text-signal-600 underline decoration-dotted underline-offset-2"
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
