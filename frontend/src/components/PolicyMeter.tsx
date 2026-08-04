"use client";

import { formatXRP } from "@/lib/format";

/**
 * The rolling-window allowance.
 *
 * The limit comes from the contract and the spend from the enclave's last verdict —
 * the two authorities on the policy. Nothing here is derived from what the browser
 * thinks happened, so the bar cannot drift from what the enclave will enforce next.
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
    <div className="rounded-2xl bg-forest-950 p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-white">
          Rolling {windowHours}h allowance
        </h3>
        <span className="text-[12px] text-white/40">enforced in-enclave</span>
      </div>

      {limitDrops === 0n ? (
        <p className="mt-4 text-[14px] text-white/50">
          No limit published yet — the enclave refuses every payment until one is set.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-end justify-between gap-3">
            <p className="text-[30px] leading-none font-bold tracking-tight text-white">
              {formatXRP(remainingDrops)}
              <span className="ml-2 text-[14px] font-normal text-white/45">
                XRP left
              </span>
            </p>
            <p className="text-[12.5px] text-white/45">
              {formatXRP(spentDrops)} / {formatXRP(limitDrops)}
            </p>
          </div>

          <div
            className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Daily allowance used"
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                nearlySpent ? "bg-block-500" : "bg-signal-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/5 px-3.5 py-3">
              <dt className="text-[11.5px] text-white/40">Signed</dt>
              <dd className="mt-0.5 text-[18px] font-semibold text-signal-400">
                {signed}
              </dd>
            </div>
            <div className="rounded-xl bg-white/5 px-3.5 py-3">
              <dt className="text-[11.5px] text-white/40">Blocked</dt>
              <dd className="mt-0.5 text-[18px] font-semibold text-block-500">
                {refused}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
