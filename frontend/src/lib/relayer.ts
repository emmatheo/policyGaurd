import type { CreatedWallet, EnclaveState, PaymentVerdict } from "./types";

/**
 * Client for the instruction relay in front of the TEE extension.
 *
 * In a Coston2 deployment this is Flare's TEE proxy; locally it is the Go relayer in
 * go/cmd/relayer. Both speak the same instruction envelope to the same extension, so
 * the UI does not care which one is answering.
 */
const RELAYER_URL = (
  process.env.NEXT_PUBLIC_RELAYER_URL ?? "http://127.0.0.1:6674"
).replace(/\/+$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${RELAYER_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    });
  } catch {
    throw new Error(
      `Cannot reach the TEE relayer at ${RELAYER_URL}. Is it running? (npm run tee)`,
    );
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Relayer returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Relayer returned ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

/** Asks the enclave to generate an XRPL keypair for a wallet id. */
export async function createWallet(
  walletId: number,
  owner: string,
): Promise<CreatedWallet> {
  return post<CreatedWallet>("/wallet/create", { walletId, owner });
}

/** Sets the rolling 24h spending limit the enclave enforces. */
export async function setDailyLimit(
  walletId: number,
  limitDrops: bigint,
): Promise<{ walletId: number; limitDrops: number }> {
  return post("/policy/limit", { walletId, limitDrops: Number(limitDrops) });
}

export interface PaymentRequestInput {
  walletId: number;
  requestId: number;
  destination: string;
  amountDrops: bigint;
  limitDrops: bigint;
  sequence: number;
  feeDrops: number;
  lastLedgerSequence: number;
  destinationTag?: number;
}

/**
 * Submits a payment for policy evaluation.
 *
 * A refusal resolves successfully with `approved: false` — it is a verdict, not a
 * failure. Only an enclave that could not reach a verdict at all rejects.
 */
export async function requestPayment(
  input: PaymentRequestInput,
): Promise<PaymentVerdict> {
  return post<PaymentVerdict>("/payment/request", {
    walletId: input.walletId,
    requestId: input.requestId,
    destination: input.destination,
    amountDrops: Number(input.amountDrops),
    limitDrops: Number(input.limitDrops),
    sequence: input.sequence,
    feeDrops: input.feeDrops,
    lastLedgerSequence: input.lastLedgerSequence,
    destinationTag: input.destinationTag ?? 0,
  });
}

/** Reads the enclave's own view of every wallet it manages. */
export async function fetchState(): Promise<EnclaveState> {
  const response = await fetch(`${RELAYER_URL}/state`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Relayer returned ${response.status} for /state`);
  }
  return (await response.json()) as EnclaveState;
}

/** Reports whether the relayer and the extension behind it are both up. */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${RELAYER_URL}/health`, { cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

export { RELAYER_URL };
