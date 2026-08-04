"use client";

import { explorerTxUrl } from "@/lib/chain";
import { formatTime, truncate } from "@/lib/format";
import type { LogEntry } from "@/lib/types";

const TONE = {
  info: "bg-ink-400",
  success: "bg-signal-500",
  refused: "bg-block-500",
  error: "bg-fail-500",
} as const;

/** A running trace of every instruction sent and every verdict returned. */
export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="rounded-2xl border border-mint-200 bg-white p-5 sm:p-6">
      <h3 className="text-[15px] font-semibold text-forest-950">Activity</h3>

      {entries.length === 0 ? (
        <p className="mt-4 text-[14px] text-ink-500">
          Nothing yet. Start with step 1 to create a wallet.
        </p>
      ) : (
        <ol className="mt-4 space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="animate-rise flex gap-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE[entry.kind]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[14px] font-medium text-forest-950">
                    {entry.title}
                  </p>
                  <time className="shrink-0 font-mono text-[11.5px] text-ink-400">
                    {formatTime(entry.at)}
                  </time>
                </div>
                {entry.detail && (
                  <p className="mt-0.5 text-[13px] leading-relaxed break-words text-ink-500">
                    {entry.detail}
                  </p>
                )}
                {entry.chainTx && (
                  <a
                    href={explorerTxUrl(entry.chainTx)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block font-mono text-[11.5px] text-signal-600 underline decoration-dotted underline-offset-2 hover:text-forest-950"
                  >
                    Flare tx {truncate(entry.chainTx, 10, 6)}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
