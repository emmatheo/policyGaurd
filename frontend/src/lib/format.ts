import { DROPS_PER_XRP } from "./types";

/**
 * Renders drops as XRP, trimming trailing zeros so 10 XRP does not read as
 * "10.000000 XRP".
 */
export function formatXRP(drops: bigint | string | number): string {
  const value = BigInt(drops);
  const whole = value / DROPS_PER_XRP;
  const frac = value % DROPS_PER_XRP;

  if (frac === 0n) return `${whole}`;

  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/**
 * Parses a user-entered XRP amount into drops.
 *
 * Throws on anything that is not a non-negative decimal with at most 6 places —
 * silently rounding a user's amount would be the wrong kind of forgiving when the
 * result is a spending limit.
 */
export function parseXRP(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error("Enter an XRP amount with at most 6 decimal places, e.g. 10 or 2.5");
  }

  const [whole, frac = ""] = trimmed.split(".");
  return BigInt(whole) * DROPS_PER_XRP + BigInt(frac.padEnd(6, "0"));
}

/** Shortens a long hex string or address for display. */
export function truncate(value: string, lead = 10, tail = 8): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Formats a timestamp for the activity log. */
export function formatTime(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
