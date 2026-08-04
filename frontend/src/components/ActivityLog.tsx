"use client";

import { explorerTxUrl } from "@/lib/chain";
import { formatTime, truncate } from "@/lib/format";
import type { LogEntry } from "@/lib/types";

const TONE = {
  info: "border-white/12 text-slate-400",
  success: "border-mint-500/40 text-mint-400",
  refused: "border-flare-500/40 text-flare-400",
  error: "border-flare-500/40 text-flare-400",
} as const;

/** A running trace of every instruction sent and every verdict returned. */
export function ActivityLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/70 p-5 backdrop-blur">
      <h3 className="text-sm font-semibold text-slate-200">Activity</h3>

      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          Nothing yet. Start with step 1 to create a wallet.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={`animate-fade-up border-l-2 pl-3 ${TONE[entry.kind]}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium text-slate-200">{entry.title}</p>
                <time className="shrink-0 font-mono text-xs text-slate-600">
                  {formatTime(entry.at)}
                </time>
              </div>
              {entry.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                  {entry.detail}
                </p>
              )}
              {entry.chainTx && (
                <a
                  href={explorerTxUrl(entry.chainTx)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block font-mono text-xs text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
                >
                  Coston2 {truncate(entry.chainTx, 10, 6)}
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
