import { parseAbi, parseEventLogs, type Hash, type Hex } from "viem";

import { publicClient } from "./chain";

/**
 * The Flare Confidential Compute instruction lifecycle, client side.
 *
 * There is exactly one path here and it goes through the chain:
 *
 *   1. a write to InstructionSender is mined on Flare
 *   2. the registry emits TeeInstructionsSent, carrying the instruction id and the
 *      TEE machines the instruction was routed to
 *   3. data providers pick the instruction up, reach consensus, and co-sign it
 *   4. the TEE proxy hands it to the TEE node, which calls the extension
 *   5. the signed result is published back and served by the proxy
 *
 * This module covers steps 2 and 5: read the instruction id out of the receipt, then
 * poll the proxy until the enclave answers. There is no local fallback — if the chain
 * did not emit the instruction, there is nothing to wait for.
 */

/**
 * The registry event that announces a dispatched instruction.
 *
 * `teeMachines` matters as much as the id: each entry carries the proxy URL the
 * instruction was routed to, so the result endpoint is discovered from the chain
 * rather than configured by hand. A proxy that was never assigned this instruction
 * cannot answer for it.
 */
export const teeInstructionsSentAbi = parseAbi([
  "struct TeeMachine { address teeId; address teeProxyId; string url; }",
  "event TeeInstructionsSent(uint256 indexed extensionId, bytes32 indexed instructionId, uint32 indexed rewardEpochId, TeeMachine[] teeMachines, bytes32 opType, bytes32 opCommand, bytes message, address[] cosigners, uint64 cosignersThreshold, address claimBackAddress, uint256 fee)",
]);

export interface DispatchedInstruction {
  /** The id the TEE proxy will publish the result under. */
  instructionId: Hash;
  /** The Flare transaction that dispatched it — the on-chain evidence. */
  txHash: Hash;
  /** Proxy URLs the instruction was routed to, straight from the event. */
  proxyUrls: string[];
  extensionId: bigint;
  blockNumber: bigint;
}

/**
 * Mines a transaction and extracts the dispatched instruction from its receipt.
 *
 * PolicyGuard emits its own event before calling the registry, so TeeInstructionsSent
 * is not necessarily the first log — the logs are scanned rather than indexed.
 */
export async function awaitDispatch(txHash: Hash): Promise<DispatchedInstruction> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    throw new Error(
      `Flare transaction ${txHash} reverted. Nothing was dispatched to the enclave.`,
    );
  }

  const logs = parseEventLogs({
    abi: teeInstructionsSentAbi,
    eventName: "TeeInstructionsSent",
    logs: receipt.logs,
  });

  if (logs.length === 0) {
    throw new Error(
      "The transaction succeeded but the registry emitted no TeeInstructionsSent event. " +
        "The extension is probably not registered — run scripts/pre-build.sh and setExtensionId().",
    );
  }

  const event = logs[0].args;
  const proxyUrls = event.teeMachines
    .map((machine) => machine.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);

  if (proxyUrls.length === 0) {
    throw new Error(
      "The instruction was dispatched but no TEE machine published a proxy URL, " +
        "so there is nowhere to collect the result from.",
    );
  }

  return {
    instructionId: event.instructionId,
    txHash: receipt.transactionHash,
    proxyUrls,
    extensionId: event.extensionId,
    blockNumber: receipt.blockNumber,
  };
}

/** Status codes the extension returns, per the FCC handler contract. */
export const ACTION_STATUS = {
  ERROR: 0,
  SUCCESS: 1,
  /** Anything >= 2 means still working. */
  PENDING_FROM: 2,
} as const;

export interface InstructionResult {
  status: number;
  /** ABI-encoded payload, ready for the decoders in protocol.ts. */
  data: Hex;
  /** The enclave's own message. Carries the reason when status is 0. */
  log: string;
  /** Which proxy answered. */
  proxyUrl: string;
}

interface ProxyActionResponse {
  status?: number;
  data?: string;
  log?: string;
  // The proxy nests the result under different keys across versions; both are handled.
  actionResult?: { status?: number; data?: string; log?: string };
  result?: { status?: number; data?: string; log?: string };
}

/**
 * Polls the TEE proxy until the enclave publishes a result for this instruction.
 *
 * The request goes through this app's own API route rather than straight from the
 * browser: the proxy is a third-party host that does not send CORS headers, so a direct
 * fetch would be blocked. See app/api/instruction/route.ts.
 */
export async function awaitResult(
  instruction: DispatchedInstruction,
  options: {
    /** How long to wait before giving up. Consensus plus enclave work takes a while. */
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** Called with each poll attempt, so the UI can show progress honestly. */
    onProgress?: (attempt: number, elapsedMs: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<InstructionResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;

  const startedAt = Date.now();
  let attempt = 0;
  let lastError = "";

  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) throw new Error("Cancelled.");
    attempt++;
    options.onProgress?.(attempt, Date.now() - startedAt);

    for (const proxyUrl of instruction.proxyUrls) {
      try {
        const response = await fetch(
          `/api/instruction?proxy=${encodeURIComponent(proxyUrl)}&id=${instruction.instructionId}`,
          { cache: "no-store", signal: options.signal },
        );

        if (response.status === 404) {
          // Not published yet — the normal state while consensus and the enclave work.
          continue;
        }

        const body = (await response.json()) as ProxyActionResponse & { error?: string };

        if (!response.ok) {
          lastError = body.error ?? `proxy returned ${response.status}`;
          continue;
        }

        const result = body.actionResult ?? body.result ?? body;
        const status = result.status;
        if (typeof status !== "number") {
          lastError = "proxy returned a result with no status";
          continue;
        }

        // >= 2 means the enclave accepted the work but is not finished.
        if (status >= ACTION_STATUS.PENDING_FROM) continue;

        return {
          status,
          data: normaliseHex(result.data),
          log: result.log ?? "",
          proxyUrl,
        };
      } catch (error) {
        if (options.signal?.aborted) throw new Error("Cancelled.");
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    await sleep(pollIntervalMs, options.signal);
  }

  throw new Error(
    `No result for instruction ${instruction.instructionId} after ${Math.round(timeoutMs / 1000)}s. ` +
      (lastError ? `Last error: ${lastError}. ` : "") +
      "Check that the TEE machine is registered and the proxy is reachable.",
  );
}

/**
 * Sends an instruction and waits for the enclave's answer.
 *
 * Every operation in the product goes through this function, which is what makes the
 * on-chain path the only path.
 */
export async function sendInstruction(
  txHash: Hash,
  options?: Parameters<typeof awaitResult>[1],
): Promise<{ instruction: DispatchedInstruction; result: InstructionResult }> {
  const instruction = await awaitDispatch(txHash);
  const result = await awaitResult(instruction, options);
  return { instruction, result };
}

/** The proxy returns bytes as hex with or without the prefix, and null when empty. */
function normaliseHex(value: string | undefined | null): Hex {
  if (!value) return "0x";
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Cancelled."));
      },
      { once: true },
    );
  });
}
