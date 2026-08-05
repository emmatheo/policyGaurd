"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Address, Hash } from "viem";

import { ActivityLog } from "@/components/ActivityLog";
import { Logo } from "@/components/brand";
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
  ProgressNote,
  StepCard,
} from "@/components/ui";
import {
  activeChain,
  connectWallet,
  createWalletTx,
  explorerAddressUrl,
  INSTRUCTION_SENDER,
  isConfigured,
  readActiveTeeMachines,
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

/** A well-known XRPL testnet address, pre-filled so nothing has to be set up first. */
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

export default function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [extensionId, setExtensionId] = useState<bigint | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [teeMachines, setTeeMachines] = useState<number | null>(null);

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

  // Check the two setup conditions that make every send revert, so they are reported
  // before anything is clicked rather than as an opaque wallet error afterwards.
  useEffect(() => {
    if (!isConfigured) return;
    (async () => {
      const id = await readExtensionId();
      setExtensionId(id);

      if (id === 0n) {
        setSetupError(
          "The contract is deployed but its extension id is unset. Register the extension, " +
            "then call setExtensionId() — until then no instruction can be dispatched.",
        );
        return;
      }

      // The registry picks a random active machine per instruction. With none
      // registered it reverts TooMany(), which explains nothing on its own.
      const machines = await readActiveTeeMachines(id);
      setTeeMachines(machines.length);
      if (machines.length === 0) {
        setSetupError(
          `Extension ${id} is registered, but no TEE machine has joined it yet, so there is ` +
            "no enclave to answer. Start the TEE stack and run scripts/post-build.sh to " +
            "register one. Until then every request reverts with TooMany().",
        );
      }
    })().catch((e) =>
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
        title: `${label} submitted`,
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
      const { result, txHash } = await runInstruction("Create wallet", () =>
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
        title: `Wallet ${created.walletId} created in the enclave`,
        detail: `${created.classicAddress} — the key was generated inside the TEE and has no export path.`,
        chainTx: txHash,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addLog({ kind: "error", title: "Create wallet failed", detail: message });
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
      const { result, txHash } = await runInstruction("Set daily limit", () =>
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
      addLog({ kind: "error", title: "Set limit failed", detail: message });
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

      const { result, txHash } = await runInstruction("Request payment", () =>
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
          ? "Approved — the enclave signed an XRPL payment"
          : "Blocked — the policy refused",
        detail: decision.reason,
        chainTx: txHash,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      addLog({ kind: "error", title: "Request payment failed", detail: message });
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  const limitSet = policy.limitDrops > 0n;
  const ready = isConfigured && account !== null && setupError === null;

  if (!isConfigured) return <NotConfigured />;

  return (
    <div className="min-h-screen bg-mint-50">
      <AppHeader
        account={account}
        onConnect={onConnect}
        extensionId={extensionId}
        teeMachines={teeMachines}
      />

      <main className="mx-auto max-w-[1200px] px-5 py-10 sm:px-8 sm:py-12">
        {setupError && (
          <Card className="mb-6 border-fail-500/30 bg-fail-500/5">
            <p className="text-[14px] text-forest-950">{setupError}</p>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <StepCard
              step={1}
              title="Create wallet"
              description="The enclave generates an XRPL keypair and returns only the address. There is no seed phrase, because no secret exists outside the TEE."
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
                    label={`XRPL address · wallet ${wallet.walletId}`}
                    value={wallet.classicAddress}
                    href={xrplAccountUrl(wallet.classicAddress)}
                  />
                  <CopyableHex label="Public key" value={wallet.publicKey} />
                  <p className="text-[12.5px] text-ink-500">
                    Fund it at the{" "}
                    <a
                      href={XRPL_FAUCET_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-signal-600 underline decoration-dotted underline-offset-2"
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
              title="Set policy"
              description="Publish a daily spending limit on Flare. The enclave stores its own copy and applies whichever of the two is stricter."
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
              title="Send payment"
              description="The enclave adds up the last 24 hours and decides. Under the limit it signs a real XRPL payment; over it, you get a reason and nothing else."
              enabled={ready && wallet !== null && limitSet}
            >
              <div className="space-y-3">
                <Field
                  label="Destination"
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
                    Send payment
                  </Button>
                </div>
              </div>

              {verdict && (
                <div className="mt-5">
                  <VerdictCard verdict={verdict} />
                </div>
              )}
            </StepCard>

            {progress && <ProgressNote>{progress}</ProgressNote>}
            {error && <ErrorNote>{error}</ErrorNote>}
          </div>

          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
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
      </main>
    </div>
  );
}

function AppHeader({
  account,
  onConnect,
  extensionId,
  teeMachines,
}: {
  account: Address | null;
  onConnect: () => void;
  extensionId: bigint | null;
  /** Active TEE machines for the extension; null until read. */
  teeMachines: number | null;
}) {
  return (
    <header className="sticky top-0 z-40 bg-forest-950">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <Logo size={24} className="text-white" />
          <span className="text-[16px] font-medium text-white">PolicyGuard</span>
        </Link>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-[12.5px] text-white/70 sm:inline-flex">
            <Dot ok />
            {activeChain.name}
            {extensionId !== null && extensionId > 0n && (
              <span className="font-mono text-white/40">
                · ext {extensionId.toString()}
                {teeMachines !== null && ` · ${teeMachines} TEE`}
              </span>
            )}
          </span>

          {account ? (
            <a
              href={explorerAddressUrl(account)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 font-mono text-[12.5px] text-white/80 transition hover:bg-white/15"
            >
              {truncate(account, 6, 4)}
            </a>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className="rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-forest-950 transition hover:bg-signal-300"
            >
              Connect wallet
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Shown when no contract is configured.
 *
 * There is deliberately nothing to click. A build with no contract cannot do anything
 * real, and offering a simulated path would defeat the point of the product.
 */
function NotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-mint-50 px-5 py-14">
      <Card className="max-w-xl">
        <Badge tone="bad">Not configured</Badge>
        <h1 className="mt-4 text-[22px] font-semibold text-forest-950">
          No contract is set
        </h1>
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-700">
          PolicyGuard has no offline mode. Every wallet, policy change, and payment
          decision is dispatched by a contract on Flare and answered by a TEE, so
          without a deployed contract there is nothing to show.
        </p>
        <ol className="mt-5 space-y-2">
          {[
            "bash scripts/pre-build.sh",
            "bash scripts/start-services.sh",
            "bash scripts/post-build.sh",
            "Copy INSTRUCTION_SENDER into frontend/.env.local as NEXT_PUBLIC_INSTRUCTION_SENDER",
          ].map((line, i) => (
            <li key={i} className="flex gap-3">
              <span className="font-mono text-[13px] text-ink-400">{i + 1}</span>
              <code className="font-mono text-[12.5px] leading-relaxed text-forest-900">
                {line}
              </code>
            </li>
          ))}
        </ol>
        <div className="mt-6">
          <Link
            href="/"
            className="text-[13.5px] text-signal-600 underline decoration-dotted underline-offset-2"
          >
            Back to the homepage
          </Link>
        </div>
      </Card>
    </div>
  );
}
