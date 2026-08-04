"use client";

import { formatXRP } from "@/lib/format";

/**
 * The rolling-window allowance.
 *
 * The limit comes from the contract and the spend from the enclave's last verdict —
 * the two authorities on the policy. Nothing here is derived from what the browser
 * thinks happened, so the bar cannot drift away from what the TEE will enforce next.
 */
export function PolicyMeter({
  limitDrops,
  spentDrops,
  remainingDrops,
  signed,
  refused,
  windowHours,
}: {
  limitDrops: bigint;
  spentDrops: bigint;
  remainingDrops: bigint;
  signed: number;
  refused: number;
  windowHours: number;
}) {
  const pct = limitDrops > 0n ? Number((spentDrops * 1000n) / limitDrops) / 10 : 0;
  const nearlySpent = limitDrops > 0n && pct >= 80;

  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/70 p-5 backdrop-blur">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">
          Rolling {windowHours}h allowance
        </h3>
        <span className="text-xs text-slate-500">enforced in-enclave</span>
      </div>

      {limitDrops === 0n ? (
        <p className="mt-4 text-sm text-slate-500">
          No limit published yet — the enclave refuses every payment until one is set.
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight text-slate-100">
              {formatXRP(remainingDrops)}{" "}
              <span className="text-sm font-normal text-slate-500">XRP remaining</span>
            </p>
            <p className="text-xs text-slate-500">
              {formatXRP(spentDrops)} / {formatXRP(limitDrops)} spent
            </p>
          </div>

          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-white/8"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily allowance used"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                nearlySpent ? "bg-flare-500" : "bg-mint-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5">
              <dt className="text-xs text-slate-500">Signed by the TEE</dt>
              <dd className="mt-0.5 font-semibold text-mint-400">{signed}</dd>
            </div>
            <div className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5">
              <dt className="text-xs text-slate-500">Blocked by policy</dt>
              <dd className="mt-0.5 font-semibold text-flare-400">{refused}</dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
