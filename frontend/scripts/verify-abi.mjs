/**
 * Cross-language ABI verification.
 *
 * The enclave encodes results with go/pkg/protocol; this app decodes them with
 * src/lib/protocol.ts. Nothing checks that the two schemas agree at compile time, so a
 * field added on one side and forgotten on the other would only surface as garbage
 * coming back from a live TEE.
 *
 * This closes the loop. The vectors in abi-vectors.json were produced by
 * `cast abi-encode`, which makes Solidity the source of truth, and equivalent vectors
 * are asserted from Go by go/pkg/protocol/protocol_test.go. Solidity->Go and
 * Solidity->TypeScript both pinned means Go and TypeScript agree.
 *
 * It also checks the TeeInstructionsSent topic hash against Flare's official ABI. If
 * that drifts, the app stops recognising real dispatches and every instruction appears
 * to hang — a failure worth catching at build time rather than in a demo.
 *
 * Run with: npm run verify:abi
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseAbi, toEventSelector } from "viem";

import {
  decodeCreateResponse,
  decodePaymentResponse,
  decodeSetLimitResponse,
} from "../src/lib/protocol.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "abi-vectors.json"), "utf8"));

let failures = 0;

function check(name, got, want) {
  const pass = got === want;
  if (!pass) failures++;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`          got:  ${got}\n          want: ${want}`);
}

// --- WALLET/CREATE ---------------------------------------------------------
{
  const v = vectors.createResponse;
  const r = decodeCreateResponse(v.encoded);
  console.log("WALLET/CREATE response");
  check("walletId", r.walletId, BigInt(v.walletId));
  check("classicAddress", r.classicAddress, v.classicAddress);
  check("publicKey", r.publicKey, v.publicKey);
}

// --- POLICY/SET_LIMIT ------------------------------------------------------
{
  const v = vectors.setLimitResponse;
  const r = decodeSetLimitResponse(v.encoded);
  console.log("\nPOLICY/SET_LIMIT response");
  check("walletId", r.walletId, BigInt(v.walletId));
  check("limitDrops", r.limitDrops, BigInt(v.limitDrops));
}

// --- PAYMENT/REQUEST, approved ---------------------------------------------
{
  const v = vectors.paymentApproved;
  const r = decodePaymentResponse(v.encoded);
  console.log("\nPAYMENT/REQUEST — approved");
  check("requestId", r.requestId, BigInt(v.requestId));
  check("approved", r.approved, true);
  check("reason", r.reason, v.reason);
  check("signedTxBlob", r.signedTxBlob, v.signedTxBlob);
  check("txHash", r.txHash, v.txHash);
  check("remainingDrops", r.remainingDrops, BigInt(v.remainingDrops));
}

// --- PAYMENT/REQUEST, refused ----------------------------------------------
// The case the product exists for: a refusal must decode as a successful result
// carrying approved=false, the full reason, and no signature.
{
  const v = vectors.paymentRefused;
  const r = decodePaymentResponse(v.encoded);
  console.log("\nPAYMENT/REQUEST — refused");
  check("requestId", r.requestId, BigInt(v.requestId));
  check("approved", r.approved, false);
  check("reason survives intact", r.reason, v.reason);
  check("no signature produced", r.signedTxBlob, "");
  check("txHash is zero", r.txHash, "0".repeat(64));
  check("limitDrops", r.limitDrops, BigInt(v.limitDrops));
  check("spentDrops", r.spentDrops, BigInt(v.spentDrops));
  check("remainingDrops", r.remainingDrops, BigInt(v.remainingDrops));
}

// --- TeeInstructionsSent topic ---------------------------------------------
{
  const appAbi = parseAbi([
    "struct TeeMachine { address teeId; address teeProxyId; string url; }",
    "event TeeInstructionsSent(uint256 indexed extensionId, bytes32 indexed instructionId, uint32 indexed rewardEpochId, TeeMachine[] teeMachines, bytes32 opType, bytes32 opCommand, bytes message, address[] cosigners, uint64 cosignersThreshold, address claimBackAddress, uint256 fee)",
  ]);

  // The canonical signature from Flare's own generated ABI (go-flare-common,
  // pkg/contracts/tee/instructions).
  const official =
    "TeeInstructionsSent(uint256,bytes32,uint32,(address,address,string)[],bytes32,bytes32,bytes,address[],uint64,address,uint256)";

  console.log("\nTeeInstructionsSent");
  check(
    "topic0 matches the official Flare ABI",
    toEventSelector(appAbi[0]),
    toEventSelector(official),
  );
}

console.log(
  failures === 0
    ? "\nAll ABI checks passed — Solidity, Go, and TypeScript agree."
    : `\n${failures} ABI check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
