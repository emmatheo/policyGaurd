"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address } from "viem";

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
  connectWallet,
  createWalletOnChain,
  isChainConfigured,
  INSTRUCTION_SENDER,
  requestPaymentOnChain,
  setDailyLimitOnChain,
} from "@/lib/chain";
import { formatXRP, parseXRP, truncate } from "@/lib/format";
import * as relayer from "@/lib/relayer";
import { RELAYER_URL } from "@/lib/relayer";
import type {
  CreatedWallet,
  LogEntry,
  PaymentVerdict,
  WalletState,
} from "@/lib/types";
import {
  fetchAccountContext,
  XRPL_FAUCET_URL,
  xrplAccountUrl,
} from "@/lib/xrpl";

/** A well-known XRPL testnet address, pre-filled so the demo needs no setup. */
const DEFAULT_DESTINATION = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

export default function Home() {
  // --- connectivity ---
  const [teeOnline, setTeeOnline] = useState<boolean | null>(null);
  const [account, setAccount] = useState<Address | null>(null);

  // --- demo state ---
  const [wallet, setWallet] = useState<CreatedWallet | null>(null);
  const [walletState, setWalletState] = useState<WalletState | null>(null);
  const [windowHours, setWindowHours] = useState(24);
  const [verdict, setVerdict] = useState<PaymentVerdict | null>(null);

  // --- form state ---
  const [limitInput, setLimitInput] = useState("10");
  const [destination, setDestination] = useState(DEFAULT_DESTINATION);
  const [amountInput, setAmountInput] = useState("4");

  // --- ui state ---
  const [busy, setBusy] = useState<null | "wallet" | "limit" | "pay">(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  // Local ids, used when no contract is configured. On Coston2 the contract is the
  // source of truth for both and these are ignored.
  const nextLocalRequestId = useRef(1);

  const addLog = useCallback((entry: Omit<LogEntry, "id" | "at">) => {
    setLog((prev) =>
      [{ ...entry, id: prev.length + 1, at: new Date() }, ...prev].slice(0, 40),
    );
  }, []);

  /** Pulls the enclave's own state, which is the authority on the rolling window. */
  const refreshState = useCallback(async (walletId: number) => {
    try {
      const snapshot = await relayer.fetchState();
      setWindowHours(snapshot.state.policyWindowHours);
      setWalletState(
        snapshot.state.wallets.find((w) => w.walletId === walletId) ?? null,
      );
    } catch {
      // A failed refresh must not clobber a verdict the user is reading.
    }
  }, []);

  // Poll the relayer so the header reflects a TEE that goes away mid-demo.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const ok = await relayer.checkHealth();
      if (!cancelled) setTeeOnline(ok);
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const chainMode = isChainConfigured && account !== null;

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

  // --- step 1: create the wallet ---
  async function onCreateWallet() {
    setBusy("wallet");
    setError(null);
    try {
      let walletId: number;
      let chainTx: string | undefined;

      if (chainMode) {
        const call = await createWalletOnChain(account);
        walletId = call.value;
        chainTx = call.txHash;
        addLog({
          kind: "info",
          title: `Wallet ${walletId} registered on Coston2`,
          detail:
            "The contract published the policy record and dispatched WALLET/CREATE.",
          chainTx,
        });
      } else {
        // Without a contract, ids are assigned locally. The enclave only needs them
        // to be stable and distinct.
        walletId = 1;
      }

      const created = await relayer.createWallet(
        walletId,
        account ?? "0x" + "0".repeat(40),
      );
      setWallet(created);
      nextLocalRequestId.current = 1;
      setVerdict(null);

      addLog({
        kind: "success",
        title: "XRPL keypair generated inside the TEE",
        detail: `${created.classicAddress} — the secret never left the enclave.`,
      });

      await refreshState(created.walletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      addLog({
        kind: "error",
        title: "Wallet creation failed",
        detail: String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  // --- step 2: set the daily limit ---
  async function onSetLimit() {
    if (!wallet) return;
    setBusy("limit");
    setError(null);
    try {
      const limitDrops = parseXRP(limitInput);
      let chainTx: string | undefined;

      if (chainMode) {
        const call = await setDailyLimitOnChain(
          account,
          wallet.walletId,
          limitDrops,
        );
        chainTx = call.txHash;
      }

      await relayer.setDailyLimit(wallet.walletId, limitDrops);

      addLog({
        kind: "success",
        title: `Daily limit set to ${formatXRP(limitDrops)} XRP`,
        detail: chainMode
          ? "Published on Coston2 and stored in the enclave."
          : "Stored in the enclave.",
        chainTx,
      });

      await refreshState(wallet.walletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      addLog({
        kind: "error",
        title: "Setting the limit failed",
        detail: String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  // --- step 3: request a payment ---
  async function onRequestPayment() {
    if (!wallet) return;
    setBusy("pay");
    setError(null);
    setVerdict(null);
    try {
      const amountDrops = parseXRP(amountInput);
      const limitDrops = walletState ? BigInt(walletState.dailyLimitDrops) : 0n;

      // Read the live sequence and ledger index so the signed transaction is actually
      // submittable. If the testnet is unreachable, fall back to safe defaults — the
      // policy decision does not depend on these.
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
            "Using placeholder sequence values; the policy decision is unaffected.",
        });
      }

      let requestId: number;
      let chainTx: string | undefined;

      if (chainMode) {
        const call = await requestPaymentOnChain(account, {
          walletId: wallet.walletId,
          destination,
          amountDrops,
          sequence,
          feeDrops: 12,
          lastLedgerSequence,
        });
        requestId = call.value;
        chainTx = call.txHash;
      } else {
        requestId = nextLocalRequestId.current++;
      }

      addLog({
        kind: "info",
        title: `Requested ${formatXRP(amountDrops)} XRP to ${truncate(destination, 8, 6)}`,
        detail: "Sent to the enclave for policy evaluation.",
        chainTx,
      });

      const result = await relayer.requestPayment({
        walletId: wallet.walletId,
        requestId,
        destination,
        amountDrops,
        limitDrops,
        sequence,
        feeDrops: 12,
        lastLedgerSequence,
      });

      setVerdict(result);
      addLog({
        kind: result.approved ? "success" : "refused",
        title: result.approved
          ? "Approved — the TEE signed the transaction"
          : "Refused — policy check failed",
        detail: result.reason,
      });

      await refreshState(wallet.walletId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      addLog({
        kind: "error",
        title: "Payment request failed",
        detail: String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  const limitSet = (walletState?.dailyLimitDrops ?? "0") !== "0";

  return (
    <main className="demo-surface min-h-screen px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto max-w-6xl">
        <Header
          teeOnline={teeOnline}
          account={account}
          chainMode={chainMode}
          onConnect={onConnect}
        />

        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          {/* --- the demo flow --- */}
          <div className="space-y-5">
            <StepCard
              step={1}
              title="Create a keyless XRPL wallet"
              description="The enclave generates a secp256k1 keypair with its own CSPRNG and returns only the derived address. No secret is ever produced outside the TEE, so there is nothing to export, back up, or steal."
              enabled={teeOnline !== false}
              done={wallet !== null}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={onCreateWallet}
                  busy={busy === "wallet"}
                  disabled={busy !== null || teeOnline === false}
                >
                  {wallet ? "Create another wallet" : "Create wallet"}
                </Button>
                {chainMode && (
                  <span className="text-xs text-slate-500">
                    Also registers the wallet on Coston2.
                  </span>
                )}
              </div>

              {wallet && (
                <div className="mt-4 space-y-3">
                  <CopyableHex
                    label="XRPL classic address"
                    value={wallet.classicAddress}
                    href={xrplAccountUrl(wallet.classicAddress)}
                  />
                  <CopyableHex
                    label="Public key (33-byte compressed)"
                    value={wallet.publicKey}
                  />
                  <p className="text-xs text-slate-500">
                    To submit real payments, fund this address at the{" "}
                    <a
                      href={XRPL_FAUCET_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-dotted underline-offset-2 hover:text-slate-300"
                    >
                      XRPL testnet faucet
                    </a>
                    . Policy decisions work without funding.
                  </p>
                </div>
              )}
            </StepCard>

            <StepCard
              step={2}
              title="Set the daily spending limit"
              description="The only policy type in this MVP: a rolling 24-hour cap. The contract publishes it so anyone can audit the rule; the enclave stores it and applies whichever of the two values is stricter."
              enabled={wallet !== null}
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
                  disabled={!wallet || busy !== null}
                >
                  Set limit
                </Button>
              </div>
            </StepCard>

            <StepCard
              step={3}
              title="Request a payment"
              description="The enclave re-derives the 24h spend from its own ledger, decides, and either signs a canonical XRPL Payment or refuses with a reason. Try one under the limit, then one over it."
              enabled={wallet !== null && limitSet}
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
                    disabled={!wallet || !limitSet || busy !== null}
                  >
                    Request payment
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <QuickAmount
                    label="4 XRP — under"
                    onClick={() => setAmountInput("4")}
                  />
                  <QuickAmount
                    label="25 XRP — over"
                    onClick={() => setAmountInput("25")}
                  />
                </div>
              </div>

              {verdict && (
                <div className="mt-5">
                  <VerdictCard verdict={verdict} />
                </div>
              )}
            </StepCard>

            {error && <ErrorNote>{error}</ErrorNote>}
          </div>

          {/* --- live enclave state --- */}
          <div className="space-y-5 lg:sticky lg:top-8 lg:self-start">
            <PolicyMeter wallet={walletState} windowHours={windowHours} />
            <ActivityLog entries={log} />
            <ArchitectureNote chainMode={chainMode} />
          </div>
        </div>
      </div>
    </main>
  );
}

function QuickAmount({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/10 bg-white/4 px-2.5 py-1 text-xs text-slate-400 transition hover:bg-white/8 hover:text-slate-200"
    >
      {label}
    </button>
  );
}

function Header({
  teeOnline,
  account,
  chainMode,
  onConnect,
}: {
  teeOnline: boolean | null;
  account: Address | null;
  chainMode: boolean;
  onConnect: () => void;
}) {
  return (
    <header>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <Badge tone="warn">Flare Confidential Compute</Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
            PolicyGuard XRPL
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            An XRPL account with no private key to lose. The signing key is
            generated and held inside a TEE, and it only ever signs a payment
            that satisfies the policy published on Flare.
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
            <Dot ok={teeOnline} />
            {teeOnline === null
              ? "Checking TEE…"
              : teeOnline
                ? "TEE online"
                : "TEE offline"}
          </span>

          {isChainConfigured ? (
            account ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 font-mono text-xs text-slate-300">
                <Dot ok />
                {truncate(account, 6, 4)}
              </span>
            ) : (
              <Button variant="ghost" onClick={onConnect}>
                Connect to Coston2
              </Button>
            )
          ) : (
            <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-slate-500">
              Local TEE mode
            </span>
          )}
        </div>
      </div>

      {teeOnline === false && (
        <Card className="mt-6 border-flare-500/30 bg-flare-500/[0.06]">
          <p className="text-sm text-slate-200">
            The TEE relayer is not reachable at{" "}
            <code className="font-mono text-flare-400">{RELAYER_URL}</code>.
          </p>
          <p className="mt-1.5 text-sm text-slate-400">
            Start it with{" "}
            <code className="font-mono text-slate-300">npm run tee</code> from
            the project root, or follow the README&apos;s local demo steps.
          </p>
        </Card>
      )}

      {!chainMode && isChainConfigured && (
        <p className="mt-4 text-xs text-slate-500">
          Contract configured at{" "}
          <code className="font-mono">
            {truncate(INSTRUCTION_SENDER, 10, 8)}
          </code>{" "}
          — connect a wallet to anchor each step on Coston2.
        </p>
      )}
    </header>
  );
}

function ArchitectureNote({ chainMode }: { chainMode: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-ink-900/70 p-5 backdrop-blur">
      <h3 className="text-sm font-semibold text-slate-200">
        How a request flows
      </h3>
      <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-400">
        {[
          chainMode
            ? "InstructionSender.sol records the request on Coston2 and emits the instruction."
            : "The local relayer builds the same instruction envelope the contract would emit.",
          "The instruction reaches the TEE extension as POST /action.",
          "The enclave re-derives the 24h spend from its own in-enclave ledger.",
          "Over the limit → a refusal with a reason. Within it → a signed XRPL Payment.",
          "The signature never reveals the key; submitting the blob happens outside the TEE.",
        ].map((line, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 font-mono text-slate-600">{i + 1}</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
