/**
 * Minimal XRPL testnet client.
 *
 * The enclave signs transactions; it never talks to the XRP Ledger. This module covers
 * the two things that have to happen outside the trust boundary: reading the account
 * sequence and current ledger index so the signed transaction is actually valid, and
 * optionally submitting the finished blob.
 *
 * Both are best-effort. If the testnet is unreachable or the account is unfunded, the
 * UI falls back to manually entered values — a demo should not be blocked by someone
 * else's node being down.
 */

const XRPL_RPC = (
  process.env.NEXT_PUBLIC_XRPL_RPC ?? "https://s.altnet.rippletest.net:51234/"
).replace(/\/+$/, "");

/** Testnet faucet, surfaced in the UI so an unfunded wallet has an obvious next step. */
export const XRPL_FAUCET_URL = "https://test.bithomp.com/faucet/";

/** Explorer link for a submitted transaction. */
export function xrplTxUrl(hash: string): string {
  return `https://test.bithomp.com/explorer/${hash}`;
}

/** Explorer link for an account. */
export function xrplAccountUrl(address: string): string {
  return `https://test.bithomp.com/explorer/${address}`;
}

async function rpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(XRPL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: [params] }),
  });
  if (!response.ok) {
    throw new Error(`XRPL node returned ${response.status}`);
  }
  const body = (await response.json()) as { result?: T & { error?: string; error_message?: string } };
  if (!body.result) throw new Error("XRPL node returned no result");
  if (body.result.error) {
    throw new Error(body.result.error_message ?? body.result.error);
  }
  return body.result;
}

export interface AccountContext {
  /** Next sequence number for the account. */
  sequence: number;
  /** A ledger index a few hundred ahead, used as LastLedgerSequence. */
  lastLedgerSequence: number;
  /** Current balance in drops, or null when the account is not yet funded. */
  balanceDrops: string | null;
  /** True when the account exists on-ledger. */
  funded: boolean;
}

/**
 * Reads the sequence and ledger index needed to build a submittable transaction.
 *
 * An unfunded account is a normal state here — a freshly generated wallet has never
 * been touched — so it resolves with `funded: false` and sequence 1 rather than
 * throwing.
 */
export async function fetchAccountContext(address: string): Promise<AccountContext> {
  const ledger = await rpc<{ ledger_current_index: number }>("ledger_current", {});
  const lastLedgerSequence = ledger.ledger_current_index + 200;

  try {
    const info = await rpc<{ account_data: { Sequence: number; Balance: string } }>(
      "account_info",
      { account: address, ledger_index: "current" },
    );
    return {
      sequence: info.account_data.Sequence,
      lastLedgerSequence,
      balanceDrops: info.account_data.Balance,
      funded: true,
    };
  } catch (error) {
    // actNotFound simply means nobody has funded the address yet.
    if (error instanceof Error && /actNotFound|Account not found/i.test(error.message)) {
      return { sequence: 1, lastLedgerSequence, balanceDrops: null, funded: false };
    }
    throw error;
  }
}

export interface SubmitResult {
  engineResult: string;
  engineResultMessage: string;
  txHash?: string;
  accepted: boolean;
}

/**
 * Submits a signed transaction blob to the XRPL testnet.
 *
 * `tesSUCCESS` means the transaction was applied. Anything else is returned as-is so
 * the UI can show the ledger's own words rather than a guess.
 */
export async function submitTransaction(txBlob: string): Promise<SubmitResult> {
  const result = await rpc<{
    engine_result: string;
    engine_result_message: string;
    tx_json?: { hash?: string };
  }>("submit", { tx_blob: txBlob });

  return {
    engineResult: result.engine_result,
    engineResultMessage: result.engine_result_message,
    txHash: result.tx_json?.hash,
    accepted: result.engine_result === "tesSUCCESS",
  };
}
