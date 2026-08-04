/** Shared UI types. Wire types live in protocol.ts, next to their ABI schema. */

/** 1 XRP = 1,000,000 drops. Amounts are handled in drops everywhere below the UI. */
export const DROPS_PER_XRP = 1_000_000n;

/** An entry in the on-screen activity log. */
export interface LogEntry {
  id: number;
  at: Date;
  kind: "info" | "success" | "refused" | "error";
  title: string;
  detail?: string;
  /** The Flare transaction that carried this step — the on-chain evidence. */
  chainTx?: string;
}
