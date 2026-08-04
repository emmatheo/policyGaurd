"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";

import { ActivityLog } from "@/components/ActivityLog";
import { PolicyMeter } from "@/components/PolicyMeter";
import { VerdictCard } from "@/components/VerdictCard";
import {
  Badge,
  Button,
  Card,
  CopyableHex,
  Dot,
  ErrorNote,
  Field,
  StepCard,
} from "@/components/ui";
import {
  activeChain,
  connectWallet,
  createWalletTx,
  explorerAddressUrl,
  INSTRUCTION_SENDER,
  isConfigured,
  NETWORK,
  readExtensionId,
  readWallet,
  requestPaymentTx,
  setDailyLimitTx,
} from "@/lib/chain";
import { ACTION_STATUS, sendInstruction, type DispatchedInstruction } from "@/lib/fcc";
import { formatXRP, parseXRP, truncate } from "@/lib/format";
import {
  decodeCreateResponse,
  decodePaymentResponse,
  decodeSetLimitResponse,
  type PaymentResponse,
} from "@/lib/protocol";
import type { LogEntry } from "@/lib/types";
import { fetchAccountContext, XRPL_FAUCET_URL, xrplAccountUrl } from "@/lib/xrpl";

/** A well-known XRPL testnet address, pre-filled so a judge needs no setup. */
const DEFAULT_DESTINATION = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

interface Wallet {
  walletId: bigint;
  classicAddress: string;
  publicKey: string;
}

/** The policy state, assembled from the two places that actually know it. */
interface PolicyState {
  /** Published by the contract. */
  limitDrops: bigint;
  /** Reported by the enclave with its last verdict. */
  spentDrops: bigint;
  remainingDrops: bigint;
  signed: number;
  refused: number;
}

export default function Demo() {
  const [account, setAccount] = useState<Address | null>(null);
  const [extensionId, setExtensionId] = useState<bigint | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [policy, setPolicy] = useState<PolicyState>({
    limitDrops: 0n,
    spentDrops: 0n,
    remainingDrops: 0n,
    signed: 0,
    refused: 0,
  });
  const [verdict, setVerdict] = useState<PaymentResponse | null>(null);

  const [limitInput, setLimitInput] = useState("10");
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [amountInput, setAmountInput] = useState("4");

  const [busy, setBusy] = useState<null | "wallet" | "limit" | "pay">(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "at">) => {
    setLog((prev) =>
      [{ ...entry, id: prev.length + 1, at: new Date() }, ...prev].slice(0, 50),
    );
  }, []);

  // Confirm the contract knows its extension id. Without it every send reverts with
  // "Extension ID is not set", which is worth catching before a judge clicks anything.
  useEffect(() => {
    if (!isConfigured) return;
    readExtensionId()
      .then((id) => {
        setExtensionId(id);
        if (id === 0n) {
          setSetupError(
            "The contract is deployed but its extension id is unset. Run setExtensionId() " +
              "after registering the extension, or instructions cannot be dispatched.",
          );
        }
      })
      .catch((e) =>
        setSetupError(
          `Could not read the contract at ${INSTRUCTION_SENDER} on ${activeChain.name}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
  }, []);

  /**
   * Runs one instruction end to end: sign the transaction, wait for the registry to
   * dispatch it, then wait for the enclave to answer through the proxy.
   */
  const runInstruction = useCallback(
    async (label: string, send: () => Promise<Hash>) => {
      setProgress("Waiting for wallet signature…");
      const txHash = await send();

      setProgress(`Mining ${truncate(txHash, 10, 6)} on ${activeChain.name}…`);
      addLog({
        kind: "info",
        title: `${label} submitted on ${activeChain.name}`,
        detail: "Waiting for the registry to dispatch the instruction.",
        chainTx: txHash,
      });

      let dispatched: DispatchedInstruction | null = null;
      const { instruction, result } = await sendInstruction(txHash, {
        onProgress: (attempt, elapsed) => {
          if (dispatched) {
            setProgress(
              `Awaiting the enclave — instruction ${truncate(dispatched.instructionId, 10, 6)}, ` +
                `${Math.round(elapsed / 1000)}s (attempt ${attempt})`,
            );
          }
        },
      });
      dispatched = instruction;

      addLog({
        kind: "info",
        title: "Instruction dispatched by the registry",
        detail: `id ${instruction.instructionId} — routed to ${instruction.proxyUrls.length} TEE machine(s).`,
        chainTx: txHash,
      });

      if (result.status === ACTION_STATUS.ERROR) {
        throw new Error(result.log || "The enclave rejected the instruction.");
      }

      return { instruction, result, txHash };
    },
    [addLog],
  );

  async function onConnect() {
    setError(null);
    try {
      const connected = await connectWallet();
      setAccount(connected);
      addLog({ kind: "info", title: "Wallet connected", detail: connected });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // --- 1. create the wallet ---
  async function onCreateWallet() {
    if (!account) return;
    setBusy("wallet");
    setError(null);
    try {
      const { result, txHash } = await runInstruction("createWallet", () =>
        createWalletTx(account),
      );
      const created = decodeCreateResponse(result.data);

      setWallet({
        walletId: created.walletId,
        classicAddress: created.classicAddress,
        publicKey: created.publicKey,
      });
      setVerdict(null);
      setPolicy({
        limitDrops: 0n,
        spentDrops: 0n,
        remainingDrops: 0n,
        signed: 0,
        refused: 0,
      });

      addLog({
        kind: "success",
        title: `Enclave generated XRPL wallet ${created.walletId}`,
        detail: `${created.classicAddress} — the secret was created inside the TEE and has no export path.`,
        chainTx: txHash,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addLog({ kind: "error", title: "createWallet failed", detail: message });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  // --- 2. set the daily limit ---
  async function onSetLimit() {
    if (!account || !wallet) return;
    setBusy("limit");
    setError(null);
    try {
      const limitDrops = parseXRP(limitInput);
      const { result, txHash } = await runInstruction("setDailyLimit", () =>
        setDailyLimitTx(account, wallet.walletId, limitDrops),
      );
      const applied = decodeSetLimitResponse(result.data);

      // Read the limit back from the contract rather than trusting the input: the
      // published record is the auditable half of the policy.
      const onChain = await readWallet(wallet.walletId);

      setPolicy((prev) => ({
        ...prev,
        limitDrops: onChain.dailyLimitDrops,
        remainingDrops: onChain.dailyLimitDrops - prev.spentDrops,
      }));

      addLog({
        kind: "success",
        title: `Daily limit set to ${formatXRP(applied.limitDrops)} XRP`,
        detail: `Published on ${activeChain.name} and applied in-enclave.`,
        chainTx: txHash,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addLog({ kind: "error", title: "setDailyLimit failed", detail: message });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  // --- 3. request a payment ---
  async function onRequestPayment() {
    if (!account || !wallet) return;
    setBusy("pay");
    setError(null);
    setVerdict(null);
    try {
      const amountDrops = parseXRP(amountInput);

      // Read the live XRPL sequence so the signature covers a submittable transaction.
      setProgress("Reading the XRPL account sequence…");
      let sequence = 1;
      let lastLedgerSequence = 100_000_000;
      try {
        const context = await fetchAccountContext(wallet.classicAddress);
        sequence = context.sequence;
        lastLedgerSequence = context.lastLedgerSequence;
      } catch {
        addLog({
          kind: "info",
          title: "XRPL testnet unreachable",
          detail:
            "Using fallback sequence values. The policy decision does not depend on them.",
        });
      }

      const { result, txHash } = await runInstruction("requestPayment", () =>
        requestPaymentTx(account, {
          walletId: wallet.walletId,
          destination,
          amountDrops,
          sequence,
          feeDrops: 12,
          lastLedgerSequence,
        }),
      );

      const decision = decodePaymentResponse(result.data);
      setVerdict(decision);
      setPolicy((prev) => ({
        limitDrops: decision.limitDrops,
        spentDrops: decision.spentDrops,
        remainingDrops: decision.remainingDrops,
        signed: prev.signed + (decision.approved ? 1 : 0),
        refused: prev.refused + (decision.approved ? 0 : 1),
      }));

      addLog({
        kind: decision.approved ? "success" : "refused",
        title: decision.approved
          ? "Approved — the enclave signed an XRPL Payment"
          : "Refused — the policy check failed",
        detail: decision.reason,
        chainTx: txHash,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addLog({ kind: "error", title: "requestPayment failed", detail: message });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const limitSet = policy.limitDrops > 0n;
  const ready = isConfigured && account !== null && setupError === null;

  if (!isConfigured) {
    return <NotConfigured />;
  }

  return (
    <main className="demo-surface min-h-screen px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <header>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <Badge tone="warn">Flare Confidential Compute · {activeChain.name}</Badge>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50">
                PolicyGuard XRPL
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
                Every step below is a real transaction on {activeChain.name}. The
                contract dispatches an instruction, data providers carry it to the TEE,
                and the enclave answers. Nothing is decided in this browser.
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2.5">
              {account ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 font-mono text-xs text-slate-300">
                  <Dot ok />
                  {truncate(account, 6, 4)}
                </span>
              ) : (
                <Button onClick={onConnect}>Connect wallet</Button>
              )}
              <a
                href={explorerAddressUrl(INSTRUCTION_SENDER)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-slate-500 underline decoration-dotted underline-offset-2 hover:text-slate-300"
              >
                contract {truncate(INSTRUCTION_SENDER, 8, 6)}
              </a>
            </div>
          </div>

          {setupError && (
            <Card className="mt-6 border-flare-500/30 bg-flare-500/[0.06]">
              <p className="text-sm text-slate-200">{setupError}</p>
            </Card>
          )}

          {extensionId !== null && extensionId > 0n && (
            <p className="mt-4 font-mono text-[11px] text-slate-600">
              extension id {extensionId.toString()} · network {NETWORK}
            </p>
          )}
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <StepCard
              step={1}
              title="Create a keyless XRPL wallet"
              description="createWallet() registers the wallet on Flare and dispatches WALLET/CREATE. The enclave generates a secp256k1 keypair with its own CSPRNG and returns only the address and public key."
              enabled={ready}
              done={wallet !== null}
            >
              <Button
                onClick={onCreateWallet}
                busy={busy === "wallet"}
                disabled={!ready || busy !== null}
              >
                {wallet ? "Create another wallet" : "Create wallet"}
              </Button>

              {wallet && (
                <div className="mt-4 space-y-3">
                  <CopyableHex
                    label={`XRPL classic address (wallet ${wallet.walletId})`}
                    value={wallet.classicAddress}
                    href={xrplAccountUrl(wallet.classicAddress)}
                  />
                  <CopyableHex label="Public key" value={wallet.publicKey} />
                  <p className="text-xs text-slate-500">
                    Fund it at the{" "}
                    <a
                      href={XRPL_FAUCET_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-2 hover:text-slate-300"
                    >
                      XRPL testnet faucet
                    </a>{" "}
                    to submit signed payments. Policy decisions work unfunded.
                  </p>
                </div>
              )}
            </StepCard>

            <StepCard
              step={2}
              title="Set the daily spending limit"
              description="setDailyLimit() publishes the rule on Flare and dispatches POLICY/SET_LIMIT. The enclave stores its own copy and applies whichever of the two is stricter."
              enabled={ready && wallet !== null}
              done={limitSet}
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <Field
                    label="Daily limit"
                    name="limit"
                    unit="XRP"
                    inputMode="decimal"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                    disabled={!wallet || busy !== null}
                  />
                </div>
                <Button
                  onClick={onSetLimit}
                  busy={busy === "limit"}
                  disabled={!ready || !wallet || busy !== null}
                >
                  Set limit
                </Button>
              </div>
            </StepCard>

            <StepCard
              step={3}
              title="Request a payment"
              description="requestPayment() dispatches PAYMENT/REQUEST. The enclave re-derives the 24h spend from its own ledger and either signs a canonical XRPL Payment or refuses with a reason."
              enabled={ready && wallet !== null && limitSet}
            >
              <div className="space-y-3">
                <Field
                  label="Destination address"
                  name="destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  disabled={!wallet || busy !== null}
                  spellCheck={false}
                />
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-44">
                    <Field
                      label="Amount"
                      name="amount"
                      unit="XRP"
                      inputMode="decimal"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      disabled={!wallet || busy !== null}
                    />
                  </div>
                  <Button
                    onClick={onRequestPayment}
                    busy={busy === "pay"}
                    disabled={!ready || !limitSet || busy !== null}
                  >
                    Request payment
                  </Button>
                </div>
              </div>

              {verdict && (
                <div className="mt-5">
                  <VerdictCard verdict={verdict} />
                </div>
              )}
            </StepCard>

            {progress && (
              <p className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 font-mono text-xs text-slate-400">
                {progress}
              </p>
            )}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>

          <div className="space-y-5 lg:sticky lg:top-8 lg:self-start">
            <PolicyMeter
              limitDrops={policy.limitDrops}
              spentDrops={policy.spentDrops}
              remainingDrops={policy.remainingDrops}
              signed={policy.signed}
              refused={policy.refused}
              windowHours={24}
            />
            <ActivityLog entries={log} />
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Shown when no contract is configured.
 *
 * There is deliberately nothing to click here. A build with no contract cannot do
 * anything real, and offering a simulated path would defeat the point of the product.
 */
function NotConfigured() {
  return (
    <main className="demo-surface flex min-h-screen items-center justify-center px-5 py-14">
      <Card className="max-w-xl">
        <Badge tone="bad">Not configured</Badge>
        <h1 className="mt-4 text-xl font-semibold text-slate-100">
          No InstructionSender contract is set
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          PolicyGuard has no offline mode. Every wallet, policy change, and payment
          decision is dispatched by a contract on Flare and answered by a TEE, so
          without a deployed contract there is nothing to show.
        </p>
        <ol className="mt-5 space-y-2 text-sm text-slate-400">
          {[
            "Deploy and register: bash scripts/pre-build.sh",
            "Start the stack: bash scripts/start-services.sh",
            "Register the machine: bash scripts/post-build.sh",
            "Copy INSTRUCTION_SENDER from config/extension.env into frontend/.env.local as NEXT_PUBLIC_INSTRUCTION_SENDER",
          ].map((line, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="font-mono text-slate-600">{i + 1}</span>
              <span className="font-mono text-xs leading-relaxed">{line}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-xs text-slate-500">
          Full instructions are in the README under “Running it for real”.
        </p>
      </Card>
    </main>
  );
}
