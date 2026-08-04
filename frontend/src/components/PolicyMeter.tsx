"use client";

import { formatXRP } from "@/lib/format";
import type { WalletState } from "@/lib/types";

/**
 * The enclave's own view of the rolling window.
 *
 * These numbers come from GET /state, not from the last verdict, so the bar always
 * reflects what the TEE will actually enforce on the next request rather than what
 * the UI believes happened.
 */
export function PolicyMeter({
  wallet,
  windowHours,
}: {
  wallet: WalletState | null;
  windowHours: number;
}) {
  const limit = wallet ? BigInt(wallet.dailyLimitDrops) : 0n;
  const spent = wallet ? BigInt(wallet.spentDrops) : 0n;
  const remaining = wallet ? BigInt(wallet.remainingDrops) : 0n;

  // Guard against a zero limit, which is the "not configured" sentinel.
  const pct =
    limit > 0n ? Number((spent * 1000n) / limit) / 10 : 0;
  const nearlySpent = limit > 0n && pct >= 80;

  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/70 p-5 backdrop-blur">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-200">
          Rolling {windowHours}h allowance
        </h3>
        <span className="text-xs text-slate-500">enforced in-enclave</span>
      </div>

      {limit === 0n ? (
        <p className="mt-4 text-sm text-slate-500">
          No limit configured yet — the enclave refuses every payment until one is set.
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-end justify-between gap-3">
            <p className="text-2xl font-semibold tracking-tight text-slate-100">
              {formatXRP(remaining)}{" "}
              <span className="text-sm font-normal text-slate-500">
                XRP remaining
              </span>
            </p>
            <p className="text-xs text-slate-500">
              {formatXRP(spent)} / {formatXRP(limit)} spent
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
              <dt className="text-xs text-slate-500">Payments signed</dt>
              <dd className="mt-0.5 font-semibold text-mint-400">
                {wallet?.paymentsSigned ?? 0}
              </dd>
            </div>
            <div className="rounded-xl border border-white/8 bg-ink-950/40 px-3 py-2.5">
              <dt className="text-xs text-slate-500">Blocked by policy</dt>
              <dd className="mt-0.5 font-semibold text-flare-400">
                {wallet?.paymentsRefused ?? 0}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
