/** Shared types for the PolicyGuard UI. */

/** 1 XRP = 1,000,000 drops. Amounts are handled in drops everywhere below the UI. */
export const DROPS_PER_XRP = 1_000_000n;

/** The public half of an XRPL identity generated inside the enclave. */
export interface CreatedWallet {
  walletId: number;
  classicAddress: string;
  publicKey: string;
}

/** The enclave's answer to a payment request. */
export interface PaymentVerdict {
  requestId: number;
  approved: boolean;
  /** Always populated, for approvals and refusals alike. */
  reason: string;
  limitDrops: string;
  spentDrops: string;
  remainingDrops: string;
  /** Present only when approved: the signed XRPL transaction, uppercase hex. */
  txBlob?: string;
  /** Present only when approved: the XRPL transaction ID. */
  txHash?: string;
}

/** One wallet's policy posture, as reported by the enclave's GET /state. */
export interface WalletState {
  walletId: number;
  classicAddress: string;
  dailyLimitDrops: string;
  spentDrops: string;
  remainingDrops: string;
  paymentsSigned: number;
  paymentsRefused: number;
}

/** The enclave's full state report. */
export interface EnclaveState {
  stateVersion: string;
  state: {
    policyWindowHours: number;
    wallets: WalletState[];
  };
}

/** An entry in the on-screen activity log. */
export interface LogEntry {
  id: number;
  at: Date;
  kind: "info" | "success" | "refused" | "error";
  title: string;
  detail?: string;
  /** Coston2 transaction hash, when the step was anchored on-chain. */
  chainTx?: string;
}
