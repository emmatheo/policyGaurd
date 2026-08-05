import Link from "next/link";

import { Logo } from "@/components/brand";
import { Footer } from "@/components/landing/Footer";

export const metadata = {
  title: "PolicyGuard XRPL — what is real, what is blocked",
  description:
    "Verifiable status of the PolicyGuard XRPL submission: which parts run on Flare Coston2 today, which require Flare Confidential Compute, and the exact blocker.",
};

const CONTRACT = "0x494bd161F29F4024d91408AC1d480EF960f91348";
const DIAMOND = "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE";
const EXPLORER = "https://coston2-explorer.flare.network";
const RPC = "https://coston2-api.flare.network/ext/C/rpc";

const REAL = [
  ["InstructionSender deployed and source-verified on Coston2", "anyone can read the code on the explorer"],
  ["Wallet records created on-chain", "createWallet() succeeds; owner and id are public"],
  ["Daily limits published on-chain", "setDailyLimit() succeeds; getWallet() reads it back"],
  ["Payment requests recorded on-chain", "requestPayment() succeeds and emits the request"],
  ["Extension registered with the FCC registry", "extension id 65955, wired via setExtensionId()"],
  ["XRPL key generation, address derivation, signing", "implemented in Go, tested against rippled's own vectors"],
  ["Rolling 24h policy engine", "implemented in Go with unit tests for the boundary cases"],
  ["ABI contract across Solidity, Go and TypeScript", "pinned by cross-language byte-vector tests"],
];

const BLOCKED = [
  ["XRPL keypair generation inside the enclave", "needs a registered TEE machine"],
  ["Policy evaluation inside the enclave", "needs a registered TEE machine"],
  ["Signed XRPL Payment transactions", "needs a registered TEE machine"],
];

export default function Verify() {
  return (
    <div className="min-h-screen bg-white">
      <header className="bg-forest-950">
        <div className="mx-auto flex max-w-[900px] items-center justify-between px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={24} className="text-white" />
            <span className="text-[16px] font-medium text-white">PolicyGuard</span>
          </Link>
          <Link
            href="/app"
            className="rounded-full bg-white px-4 py-2 text-[13.5px] font-medium text-forest-950"
          >
            Open app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[900px] px-5 py-14 sm:px-8">
        <p className="text-[12px] font-medium tracking-[0.1em] text-signal-600 uppercase">
          For judges
        </p>
        <h1 className="mt-3 text-[34px] leading-tight font-bold tracking-tight text-forest-950">
          What is real, and what is blocked
        </h1>
        <p className="mt-4 text-[16px] leading-relaxed text-ink-700">
          PolicyGuard has two halves: a policy layer on Flare, and confidential execution
          inside a Flare Confidential Compute enclave. The first is live and you can
          verify every claim below yourself. The second is blocked on one credential set
          we cannot self-serve, and nothing in this app simulates it.
        </p>

        {/* --- addresses --- */}
        <section className="mt-10 rounded-2xl border border-mint-200 bg-mint-50 p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold text-forest-950">Addresses</h2>
          <dl className="mt-4 space-y-3 text-[13.5px]">
            {[
              ["Network", "Flare Coston2 · chain id 114 · C2FLR"],
              ["RPC", RPC],
              ["InstructionSender", CONTRACT],
              ["FCC diamond (FlareTeeManager)", DIAMOND],
              ["Extension id", "65955"],
              ["Active TEE machines", "0"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                <dt className="w-56 shrink-0 text-ink-500">{k}</dt>
                <dd className="break-hex font-mono text-forest-950">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`${EXPLORER}/address/${CONTRACT}#code`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-forest-950 px-4 py-2 text-[13.5px] font-medium text-white"
            >
              Read the verified source
            </a>
            <a
              href={`${EXPLORER}/address/${CONTRACT}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-mint-200 bg-white px-4 py-2 text-[13.5px] font-medium text-forest-950"
            >
              All transactions
            </a>
          </div>
        </section>

        {/* --- real --- */}
        <section className="mt-8">
          <h2 className="flex items-center gap-2.5 text-[19px] font-semibold text-forest-950">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-signal-500 text-[13px] text-forest-950">
              ✓
            </span>
            Real and verifiable today
          </h2>
          <ul className="mt-4 divide-y divide-mint-200 rounded-2xl border border-mint-200">
            {REAL.map(([what, how]) => (
              <li key={what} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
                <span className="flex-1 text-[14.5px] font-medium text-forest-950">
                  {what}
                </span>
                <span className="flex-1 text-[13px] text-ink-500">{how}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- blocked --- */}
        <section className="mt-8">
          <h2 className="flex items-center gap-2.5 text-[19px] font-semibold text-forest-950">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-block-500 text-[13px] text-forest-950">
              !
            </span>
            Blocked, and not simulated
          </h2>
          <ul className="mt-4 divide-y divide-block-500/20 rounded-2xl border border-block-500/30 bg-block-500/[0.05]">
            {BLOCKED.map(([what, why]) => (
              <li key={what} className="flex flex-col gap-1 p-4 sm:flex-row sm:gap-6">
                <span className="flex-1 text-[14.5px] font-medium text-forest-950">
                  {what}
                </span>
                <span className="flex-1 text-[13px] text-ink-500">{why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[13.5px] text-ink-700">
            The app never fabricates a signed XRPL payment. When the enclave is
            unreachable the contract emits{" "}
            <code className="font-mono text-[12.5px]">TeeUnavailable</code> and the UI
            says the record was written and the enclave was not invoked.
          </p>
        </section>

        {/* --- the blocker --- */}
        <section className="mt-8 rounded-2xl border border-mint-200 p-5 sm:p-6">
          <h2 className="text-[17px] font-semibold text-forest-950">
            The exact blocker
          </h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-700">
            Registering a TEE machine requires Flare&apos;s extension proxy, and the proxy
            connects to a Coston2 indexer database as the first statement of{" "}
            <code className="font-mono text-[12.5px]">proxy.Run</code>. Those credentials
            are issued by Flare. With placeholders in the config, the whole stack builds
            and starts, and the proxy exits immediately:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-forest-950 p-4 font-mono text-[12px] leading-relaxed text-signal-300">
{`$ docker compose ps -a
flarenetwork-extension-tee-1   Up
flarenetwork-redis-1           Up
flarenetwork-ext-proxy-1       Exited (2)

$ docker logs flarenetwork-ext-proxy-1
panic: connecting to database: opening mysql connection to
<indexer-db-host>:3306/<indexer-db-name> as <indexer-db-user>:
dial tcp: lookup <indexer-db-host>: no such host
    tee-proxy/internal/proxy/proxy.go:49`}
          </pre>
          <p className="mt-4 text-[14.5px] leading-relaxed text-ink-700">
            There is no degraded or offline mode to fall back on, so this is a hard
            prerequisite rather than a configuration preference. Everything downstream of
            it is built, tested, and waiting.
          </p>
        </section>

        {/* --- verify yourself --- */}
        <section className="mt-8">
          <h2 className="text-[17px] font-semibold text-forest-950">
            Verify it yourself
          </h2>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-forest-950 p-4 font-mono text-[12px] leading-relaxed text-signal-300">
{`RPC=${RPC}
C=${CONTRACT}

# the contract is wired to the real FCC diamond
cast call --rpc-url $RPC $C 'TEE_EXTENSION_REGISTRY()(address)'
# ${DIAMOND}

# the extension is registered
cast call --rpc-url $RPC $C 'extensionId()(uint256)'
# 65955

# ...and the contract itself reports no enclave is reachable
cast call --rpc-url $RPC $C 'isTeeAvailable()(bool)'
# false

# the on-chain policy record is real and readable
cast call --rpc-url $RPC $C 'getWallet(uint64)(address,uint64,uint64)' 1`}
          </pre>
        </section>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/app"
            className="rounded-full bg-signal-500 px-5 py-3 text-[14px] font-medium text-forest-950"
          >
            Try the live on-chain flow
          </Link>
          <a
            href="https://github.com/emmatheo/policyGaurd"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-mint-200 px-5 py-3 text-[14px] font-medium text-forest-950"
          >
            Read the source
          </a>
        </div>
      </main>

      <Footer />
    </div>
  );
}
