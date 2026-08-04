import { decodeAbiParameters, type Hex } from "viem";

/**
 * ABI decoders for the results the TEE extension returns.
 *
 * These mirror `go/pkg/protocol/protocol.go` field for field and in the same order.
 * The enclave encodes with the Go definitions; this decodes with the TypeScript ones,
 * and nothing checks that the two agree at compile time — so any edit here needs the
 * matching edit there. `go/pkg/protocol/protocol_test.go` pins the encoding against
 * byte vectors produced by `cast abi-encode`, which is what catches drift.
 */

/** `uint64 walletId, string classicAddress, bytes publicKey` */
const createResponseArgs = [
  { name: "walletId", type: "uint64" },
  { name: "classicAddress", type: "string" },
  { name: "publicKey", type: "bytes" },
] as const;

/** `uint64 walletId, uint64 limitDrops` */
const setLimitResponseArgs = [
  { name: "walletId", type: "uint64" },
  { name: "limitDrops", type: "uint64" },
] as const;

/**
 * The payment verdict.
 *
 * A refusal arrives here as `approved: false` with an empty blob — a successful result
 * carrying a negative answer, not an error. Only an enclave that could not reach a
 * verdict at all reports failure, and that surfaces as a zero status before decoding.
 */
const paymentResponseArgs = [
  { name: "requestId", type: "uint64" },
  { name: "approved", type: "bool" },
  { name: "reason", type: "string" },
  { name: "signedTxBlob", type: "bytes" },
  { name: "txHash", type: "bytes32" },
  { name: "limitDrops", type: "uint64" },
  { name: "spentDrops", type: "uint64" },
  { name: "remainingDrops", type: "uint64" },
] as const;

export interface CreateResponse {
  walletId: bigint;
  classicAddress: string;
  publicKey: Hex;
}

export interface SetLimitResponse {
  walletId: bigint;
  limitDrops: bigint;
}

export interface PaymentResponse {
  requestId: bigint;
  approved: boolean;
  reason: string;
  /** Uppercase hex without the 0x prefix, the form XRPL nodes expect. Empty if refused. */
  signedTxBlob: string;
  /** Uppercase hex without the 0x prefix. Zero if refused. */
  txHash: string;
  limitDrops: bigint;
  spentDrops: bigint;
  remainingDrops: bigint;
}

export function decodeCreateResponse(data: Hex): CreateResponse {
  const [walletId, classicAddress, publicKey] = decodeAbiParameters(
    createResponseArgs,
    data,
  );
  return { walletId, classicAddress, publicKey };
}

export function decodeSetLimitResponse(data: Hex): SetLimitResponse {
  const [walletId, limitDrops] = decodeAbiParameters(setLimitResponseArgs, data);
  return { walletId, limitDrops };
}

export function decodePaymentResponse(data: Hex): PaymentResponse {
  const [
    requestId,
    approved,
    reason,
    signedTxBlob,
    txHash,
    limitDrops,
    spentDrops,
    remainingDrops,
  ] = decodeAbiParameters(paymentResponseArgs, data);

  return {
    requestId,
    approved,
    reason,
    signedTxBlob: stripHex(signedTxBlob),
    txHash: stripHex(txHash),
    limitDrops,
    spentDrops,
    remainingDrops,
  };
}

/** XRPL renders transaction blobs and hashes as uppercase hex with no prefix. */
function stripHex(value: Hex): string {
  return value.slice(2).toUpperCase();
}
