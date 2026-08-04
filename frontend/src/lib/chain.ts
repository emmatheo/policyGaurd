import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
  type Hash,
} from "viem";

/**
 * Coston2, Flare's testnet and the chain the FCC contracts are deployed on.
 */
export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_COSTON2_RPC ??
          "https://coston2-api.flare.network/ext/C/rpc",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Coston2 Explorer",
      url: "https://coston2-explorer.flare.network",
    },
  },
  testnet: true,
});

/**
 * The subset of InstructionSender the UI calls. Kept as a hand-written ABI rather
 * than an imported artifact so the frontend has no build-time dependency on
 * `forge build` having been run.
 */
export const instructionSenderAbi = parseAbi([
  "function createWallet() payable returns (uint64 walletId)",
  "function setDailyLimit(uint64 walletId, uint64 limitDrops) payable",
  "function requestPayment(uint64 walletId, string destination, uint64 amountDrops, uint32 sequence, uint32 feeDrops, uint32 lastLedgerSequence, uint32 destinationTag) payable returns (uint64 requestId)",
  "function getWallet(uint64 walletId) view returns (address owner, uint64 dailyLimitDrops, uint64 createdAt)",
  "function getWalletsByOwner(address owner) view returns (uint64[])",
  "function nextWalletId() view returns (uint64)",
  "function nextRequestId() view returns (uint64)",
  "function extensionId() view returns (uint256)",
  "event WalletCreated(uint64 indexed walletId, address indexed owner)",
  "event DailyLimitSet(uint64 indexed walletId, uint64 limitDrops)",
  "event PaymentRequested(uint64 indexed walletId, uint64 indexed requestId, string destination, uint64 amountDrops, uint64 limitDrops)",
]);

/**
 * The deployed InstructionSender, if one is configured.
 *
 * When this is unset the UI runs in local-only mode: the enclave still enforces the
 * policy, but nothing is anchored on Coston2. That keeps the demo runnable before
 * the contract is deployed.
 */
export const INSTRUCTION_SENDER = (process.env.NEXT_PUBLIC_INSTRUCTION_SENDER ?? "")
  .trim() as Address | "";

export const isChainConfigured = /^0x[0-9a-fA-F]{40}$/.test(INSTRUCTION_SENDER);

/**
 * Fee forwarded with each instruction. The registry's minimum is 1000 wei; this is
 * comfortably above it so a fee-schedule change does not break the demo.
 */
export const INSTRUCTION_FEE_WEI = 1_000_000_000_000n;

export const publicClient = createPublicClient({
  chain: coston2,
  transport: http(),
});

/** The EIP-1193 provider injected by a browser wallet, if present. */
function injectedProvider() {
  if (typeof window === "undefined") return undefined;
  const provider = (window as { ethereum?: unknown }).ethereum;
  return provider as Parameters<typeof custom>[0] | undefined;
}

export function hasInjectedWallet(): boolean {
  return injectedProvider() !== undefined;
}

/**
 * Prompts the wallet for an account and makes sure it is pointed at Coston2.
 *
 * Signing a policy change against the wrong chain would silently do nothing useful,
 * so the switch is attempted up front and the chain is added if the wallet has never
 * seen it.
 */
export async function connectWallet(): Promise<Address> {
  const provider = injectedProvider();
  if (!provider) {
    throw new Error("No browser wallet found. Install MetaMask to use Coston2 mode.");
  }

  const walletClient = createWalletClient({ chain: coston2, transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("Wallet returned no accounts.");

  try {
    await walletClient.switchChain({ id: coston2.id });
  } catch {
    // The wallet does not know Coston2 yet; offer to add it.
    await walletClient.addChain({ chain: coston2 });
    await walletClient.switchChain({ id: coston2.id });
  }

  return account;
}

function walletClientFor(account: Address) {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found.");
  return createWalletClient({ account, chain: coston2, transport: custom(provider) });
}

function requireContract(): Address {
  if (!isChainConfigured) {
    throw new Error(
      "NEXT_PUBLIC_INSTRUCTION_SENDER is not set — deploy the contract and add it to .env.local.",
    );
  }
  return INSTRUCTION_SENDER as Address;
}

export interface ChainCall<T> {
  txHash: Hash;
  value: T;
}

/**
 * Registers a wallet on-chain and returns the id the contract assigned.
 *
 * The id comes from the WalletCreated event rather than the return value, because a
 * state-changing call only yields a receipt.
 */
export async function createWalletOnChain(account: Address): Promise<ChainCall<number>> {
  const contract = requireContract();
  const wallet = walletClientFor(account);

  const txHash = await wallet.writeContract({
    address: contract,
    abi: instructionSenderAbi,
    functionName: "createWallet",
    value: INSTRUCTION_FEE_WEI,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const logs = parseEventLogs({
    abi: instructionSenderAbi,
    eventName: "WalletCreated",
    logs: receipt.logs,
  });
  if (logs.length === 0) {
    throw new Error("createWallet succeeded but emitted no WalletCreated event.");
  }

  return { txHash, value: Number(logs[0].args.walletId) };
}

/** Publishes the daily limit on-chain. */
export async function setDailyLimitOnChain(
  account: Address,
  walletId: number,
  limitDrops: bigint,
): Promise<ChainCall<bigint>> {
  const contract = requireContract();
  const wallet = walletClientFor(account);

  const txHash = await wallet.writeContract({
    address: contract,
    abi: instructionSenderAbi,
    functionName: "setDailyLimit",
    args: [BigInt(walletId), limitDrops],
    value: INSTRUCTION_FEE_WEI,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, value: limitDrops };
}

export interface OnChainPaymentInput {
  walletId: number;
  destination: string;
  amountDrops: bigint;
  sequence: number;
  feeDrops: number;
  lastLedgerSequence: number;
  destinationTag?: number;
}

/** Records a payment request on-chain and returns the assigned request id. */
export async function requestPaymentOnChain(
  account: Address,
  input: OnChainPaymentInput,
): Promise<ChainCall<number>> {
  const contract = requireContract();
  const wallet = walletClientFor(account);

  const txHash = await wallet.writeContract({
    address: contract,
    abi: instructionSenderAbi,
    functionName: "requestPayment",
    args: [
      BigInt(input.walletId),
      input.destination,
      input.amountDrops,
      input.sequence,
      input.feeDrops,
      input.lastLedgerSequence,
      input.destinationTag ?? 0,
    ],
    value: INSTRUCTION_FEE_WEI,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const logs = parseEventLogs({
    abi: instructionSenderAbi,
    eventName: "PaymentRequested",
    logs: receipt.logs,
  });
  if (logs.length === 0) {
    throw new Error("requestPayment succeeded but emitted no PaymentRequested event.");
  }

  return { txHash, value: Number(logs[0].args.requestId) };
}

/** Reads a wallet's published policy record. */
export async function readWalletOnChain(walletId: number) {
  const contract = requireContract();
  const [owner, dailyLimitDrops, createdAt] = await publicClient.readContract({
    address: contract,
    abi: instructionSenderAbi,
    functionName: "getWallet",
    args: [BigInt(walletId)],
  });
  return { owner, dailyLimitDrops, createdAt };
}

/** Builds an explorer link for a Coston2 transaction. */
export function explorerTxUrl(txHash: string): string {
  return `${coston2.blockExplorers.default.url}/tx/${txHash}`;
}
