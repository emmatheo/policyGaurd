import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hash,
} from "viem";

/**
 * Flare network definitions and the InstructionSender bindings.
 *
 * Every state change in PolicyGuard is a transaction on one of these chains. There is
 * no off-chain path — the contract is what dispatches work to the enclave, so an
 * unconfigured contract address means the product cannot run, not that it falls back
 * to something local.
 */

export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] } },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" },
  },
  testnet: true,
});

export const songbird = defineChain({
  id: 19,
  name: "Songbird Canary-Network",
  nativeCurrency: { name: "Songbird", symbol: "SGB", decimals: 18 },
  rpcUrls: { default: { http: ["https://songbird-api.flare.network/ext/C/rpc"] } },
  blockExplorers: {
    default: { name: "Songbird Explorer", url: "https://songbird-explorer.flare.network" },
  },
});

export const flare = defineChain({
  id: 14,
  name: "Flare Mainnet",
  nativeCurrency: { name: "Flare", symbol: "FLR", decimals: 18 },
  rpcUrls: { default: { http: ["https://flare-api.flare.network/ext/C/rpc"] } },
  blockExplorers: {
    default: { name: "Flare Explorer", url: "https://flare-explorer.flare.network" },
  },
});

const CHAINS: Record<string, Chain> = {
  coston2: coston2,
  songbird: songbird,
  flare: flare,
};

/**
 * Which network the app talks to. Coston2 is the default because it is the only
 * network with a public FCC deployment today — see the README's network matrix.
 */
export const NETWORK = (process.env.NEXT_PUBLIC_FLARE_NETWORK ?? "coston2").toLowerCase();

export const activeChain: Chain = CHAINS[NETWORK] ?? coston2;

/** An RPC override, for a private or rate-limit-free endpoint. */
const RPC_URL = process.env.NEXT_PUBLIC_FLARE_RPC?.trim();

export const publicClient = createPublicClient({
  chain: activeChain,
  transport: http(RPC_URL || undefined),
});

/**
 * The deployed PolicyGuard InstructionSender.
 *
 * Written to `config/extension.env` as INSTRUCTION_SENDER by `scripts/pre-build.sh`.
 */
export const INSTRUCTION_SENDER = (
  process.env.NEXT_PUBLIC_INSTRUCTION_SENDER ?? ""
).trim() as Address | "";

export const isConfigured = /^0x[0-9a-fA-F]{40}$/.test(INSTRUCTION_SENDER);

/**
 * Fee forwarded with each instruction. The registry's minimum is 1000 wei; this sits
 * comfortably above it, and any excess is returned to the claim-back address.
 */
export const INSTRUCTION_FEE_WEI = BigInt(
  process.env.NEXT_PUBLIC_INSTRUCTION_FEE_WEI ?? "1000000000000",
);

export const instructionSenderAbi = parseAbi([
  "function createWallet() payable returns (uint64 walletId)",
  "function setDailyLimit(uint64 walletId, uint64 limitDrops) payable",
  "function requestPayment(uint64 walletId, string destination, uint64 amountDrops, uint32 sequence, uint32 feeDrops, uint32 lastLedgerSequence, uint32 destinationTag) payable returns (uint64 requestId)",
  "function getWallet(uint64 walletId) view returns (address owner, uint64 dailyLimitDrops, uint64 createdAt)",
  "function getWalletsByOwner(address owner) view returns (uint64[])",
  "function nextWalletId() view returns (uint64)",
  "function nextRequestId() view returns (uint64)",
  "function extensionId() view returns (uint256)",
  "function isTeeAvailable() view returns (bool)",
  "event WalletCreated(uint64 indexed walletId, address indexed owner, bool teeDispatched)",
  "event TeeUnavailable(bytes32 opType, bytes32 opCommand)",
  "event DailyLimitSet(uint64 indexed walletId, uint64 limitDrops, bool teeDispatched)",
  "event PaymentRequested(uint64 indexed walletId, uint64 indexed requestId, string destination, uint64 amountDrops, uint64 limitDrops, bool teeDispatched)",
]);

function injectedProvider() {
  if (typeof window === "undefined") return undefined;
  const provider = (window as { ethereum?: unknown }).ethereum;
  return provider as Parameters<typeof custom>[0] | undefined;
}

/** Prompts for an account and makes sure the wallet is pointed at the active chain. */
export async function connectWallet(): Promise<Address> {
  const provider = injectedProvider();
  if (!provider) {
    throw new Error(
      "No browser wallet found. PolicyGuard sends real transactions, so a wallet is required.",
    );
  }

  const walletClient = createWalletClient({ chain: activeChain, transport: custom(provider) });
  const [account] = await walletClient.requestAddresses();
  if (!account) throw new Error("Wallet returned no accounts.");

  try {
    await walletClient.switchChain({ id: activeChain.id });
  } catch {
    await walletClient.addChain({ chain: activeChain });
    await walletClient.switchChain({ id: activeChain.id });
  }

  return account;
}

function walletClientFor(account: Address) {
  const provider = injectedProvider();
  if (!provider) throw new Error("No browser wallet found.");
  return createWalletClient({ account, chain: activeChain, transport: custom(provider) });
}

export function contractAddress(): Address {
  if (!isConfigured) {
    throw new Error(
      "NEXT_PUBLIC_INSTRUCTION_SENDER is not set. Deploy the contract with " +
        "scripts/pre-build.sh and copy INSTRUCTION_SENDER from config/extension.env.",
    );
  }
  return INSTRUCTION_SENDER as Address;
}

/**
 * The write calls.
 *
 * Each returns only a transaction hash. Everything after that — mining, the registry
 * event, consensus, the enclave's answer — belongs to the instruction lifecycle in
 * fcc.ts, so these stay honest about what they have actually accomplished.
 */

export async function createWalletTx(account: Address): Promise<Hash> {
  return walletClientFor(account).writeContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "createWallet",
    value: INSTRUCTION_FEE_WEI,
  });
}

export async function setDailyLimitTx(
  account: Address,
  walletId: bigint,
  limitDrops: bigint,
): Promise<Hash> {
  return walletClientFor(account).writeContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "setDailyLimit",
    args: [walletId, limitDrops],
    value: INSTRUCTION_FEE_WEI,
  });
}

export interface PaymentArgs {
  walletId: bigint;
  destination: string;
  amountDrops: bigint;
  sequence: number;
  feeDrops: number;
  lastLedgerSequence: number;
  destinationTag?: number;
}

export async function requestPaymentTx(
  account: Address,
  args: PaymentArgs,
): Promise<Hash> {
  return walletClientFor(account).writeContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "requestPayment",
    args: [
      args.walletId,
      args.destination,
      args.amountDrops,
      args.sequence,
      args.feeDrops,
      args.lastLedgerSequence,
      args.destinationTag ?? 0,
    ],
    value: INSTRUCTION_FEE_WEI,
  });
}

/** Reads a wallet's published policy record — the on-chain half of the limit. */
export async function readWallet(walletId: bigint) {
  const [owner, dailyLimitDrops, createdAt] = await publicClient.readContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "getWallet",
    args: [walletId],
  });
  return { owner, dailyLimitDrops, createdAt };
}

/** Every wallet an account owns, so a returning user is not stranded. */
export async function readWalletsByOwner(owner: Address): Promise<bigint[]> {
  const ids = await publicClient.readContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "getWalletsByOwner",
    args: [owner],
  });
  return [...ids];
}

/** Confirms the contract has discovered its extension id — the usual setup failure. */
export async function readExtensionId(): Promise<bigint> {
  return publicClient.readContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "extensionId",
  });
}

/**
 * Flare's FCC diamond, which routes the extension and machine registries.
 *
 * Published in `config/<network>/deployed-addresses.json` as `FlareTeeManager`. Only
 * Coston2 has a public deployment today.
 */
const TEE_MANAGER: Record<string, Address> = {
  coston2: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
};

const machineRegistryAbi = parseAbi([
  "struct TeeMachine { address teeId; address teeProxyId; string url; }",
  "function getActiveTeeMachines(uint256 extensionId) view returns (TeeMachine[])",
]);

/**
 * How many TEE machines are live for this extension.
 *
 * Worth checking before offering any action: `sendInstructions` asks the registry for
 * one random machine, and asking for one of zero reverts with `TooMany()` — an error
 * that says nothing about the actual problem. Reading the count first lets the app
 * explain that no enclave is registered yet, rather than letting a wallet surface an
 * opaque revert after the user has already committed to a transaction.
 */
export async function readActiveTeeMachines(
  extensionId: bigint,
): Promise<{ teeId: Address; teeProxyId: Address; url: string }[]> {
  const manager = TEE_MANAGER[NETWORK];
  if (!manager) return [];

  const machines = await publicClient.readContract({
    address: manager,
    abi: machineRegistryAbi,
    functionName: "getActiveTeeMachines",
    args: [extensionId],
  });
  return [...machines];
}

export function explorerTxUrl(txHash: string): string {
  return `${activeChain.blockExplorers?.default.url}/tx/${txHash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${activeChain.blockExplorers?.default.url}/address/${address}`;
}

/**
 * The contract's own answer to "can I reach an enclave right now".
 *
 * Read before every action so the UI can state which half of the system will run.
 * With no machine registered the on-chain policy record is still written, but no
 * signature can be produced by anyone — and saying so is the point.
 */
export async function readIsTeeAvailable(): Promise<boolean> {
  return publicClient.readContract({
    address: contractAddress(),
    abi: instructionSenderAbi,
    functionName: "isTeeAvailable",
  });
}
