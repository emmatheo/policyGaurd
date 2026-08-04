# PolicyGuard XRPL

**A keyless, policy-controlled XRPL account, built on Flare Confidential Compute.**

Submission for the Flare Summer Signal hackathon — Confidential Compute Apps track.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Femmatheo%2FpolicyGaurd&project-name=policyguard-xrpl&repository-name=policyguard-xrpl)

---

## The idea

An XRPL account is only as safe as the secret behind it. Lose the seed and the funds
are gone; leak it and they are someone else's. Every mitigation people reach for —
hardware wallets, multisig, custodians — works by making the key harder to *use*, which
is also what makes it harder to use legitimately.

PolicyGuard removes the key from the picture instead.

The XRPL signing key is generated inside a Trusted Execution Environment and never
leaves it. There is no seed to back up, no secret to export, and no API that returns
one. What the account holder controls is not a key but a **policy**, published on
Flare: *at most X XRP per rolling 24 hours*. The enclave holds the only copy of the
key, so the enclave is the only thing that can enforce that policy — and it does, on
every payment, before it will produce a signature.

## There is no demo mode

Every wallet, policy change, and payment decision in this product is a **transaction on
Flare** that dispatches an **instruction** to a **TEE**. There is no local path, no
simulated verdict, and no offline fallback. Open the app without a deployed contract
and it tells you so and stops — there is deliberately nothing to click.

Concretely, one action is:

```
1.  wallet signs  requestPayment(...)                    → a real Flare transaction
2.  InstructionSender calls TeeExtensionRegistry
3.  the registry emits TeeInstructionsSent               → instruction id + TEE machines
4.  data providers pick it up, reach consensus, co-sign
5.  the TEE proxy hands it to the TEE node
6.  the node calls the extension: POST /action
7.  the enclave re-derives the 24h spend and decides
8.  the signed result is published back through the proxy
9.  the app polls the proxy and ABI-decodes the verdict
```

Steps 3 and 9 are in [`frontend/src/lib/fcc.ts`](frontend/src/lib/fcc.ts). Note step 3:
the proxy URL is read **out of the on-chain event**, not from configuration — the chain
decides which TEE machines handle an instruction, so a proxy that was never assigned
the work cannot answer for it.

## What is real, and what is simulated

Being precise about this matters more than claiming everything works.

| Component | Status |
|---|---|
| XRPL key generation, address derivation, canonical serialisation, signing | **Real.** Verified against rippled's own test vectors. |
| Daily-limit policy engine | **Real.** A rolling 24h ledger, re-derived in-enclave on every request. |
| `InstructionSender.sol` | **Real.** Official `sendInstructions` / OPType / OPCommand pattern. |
| Instruction dispatch and result collection | **Real.** On-chain event → data-provider consensus → proxy. |
| Frontend | **Real.** Sends transactions, decodes signed results. No simulated branch exists. |
| **Hardware attestation** | **Simulated on Coston2** (`SIMULATED_TEE=true`, `MODE=1`). This is Flare's own local setup, not a substitute implementation — the extension binary and instruction path are identical, only the attestation quote is a test quote. Production requires a GCP Confidential Space VM. |

### Networks

| Network | Status | Why |
|---|---|---|
| **Coston2** | **Live.** Built and tested here. | The only network with a public FCC contract set — `FlareTeeManager` at [`0x1a9C…18aE`](https://coston2-explorer.flare.network/address/0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE). |
| **Songbird** | **Prepared, not live.** [`.env.songbird.example`](.env.songbird.example) | The FCC rollout was approved by governance, but the contract set is not published in the official address book. There is no `FlareTeeManager` address to point at. |
| **Flare mainnet** | **Prepared, not live.** [`.env.flare.example`](.env.flare.example) | Flare's own documentation describes FCC as *"in the final stages of development and not yet a fully public production system."* No public mainnet contract set exists. |

The Songbird and Flare env files have **empty** address and proxy fields. That is
deliberate: inventing plausible-looking addresses would produce something that appears
deployable and is not, which is worse than an obvious gap.

Two things must be true before mainnet is appropriate, beyond the addresses existing:
`SIMULATED_TEE=false` on real Confidential Space hardware, and key persistence through
Flare's `WalletKeyManager` facet — see [Known limitations](#known-limitations).

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Flare (Coston2)                                                     │
│                                                                      │
│   InstructionSender.sol  ──── the public policy record               │
│     · createWallet()      · setDailyLimit()   · requestPayment()     │
│     · stores the limit, emits every request as an event              │
│     · deliberately does NOT reject over-limit requests               │
│                            │ sendInstructions()                      │
│                            ▼                                         │
│   TeeExtensionRegistry ── emits TeeInstructionsSent                   │
└────────────────────────────┼─────────────────────────────────────────┘
                             │ data providers reach consensus, co-sign
                             ▼
                        TEE proxy  ──►  TEE node
                                          │  POST /action
┌─────────────────────────────────────────┼────────────────────────────┐
│  TEE extension (the enclave)            ▼                            │
│   WALLET/CREATE    → generate a secp256k1 keypair, return the address │
│   POLICY/SET_LIMIT → store the rolling 24h limit                     │
│   PAYMENT/REQUEST  → evaluate, then sign or refuse                   │
│                                                                      │
│   · the signing key lives only here, with no export path             │
│   · the 24h spend ledger lives only here                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Why the contract does not enforce the policy

It would be natural to `revert` on an over-limit request. PolicyGuard does not, for two
reasons.

The first is that a reverted transaction never reaches the enclave, so the user gets a
failed transaction instead of an explained decision. The refusal, with its reason, is
the product.

The second is honesty about where trust sits. The enclave holds the key, so it is the
enforcement point whether or not the contract also checks. A second, weaker check
on-chain would imply a guarantee the contract cannot make.

What the contract *does* provide is auditability — the limit and every request are
public — and a **cap**. The current on-chain limit travels with each instruction, and
the enclave applies whichever of the two is stricter
([`policy.go`](go/internal/policy/policy.go)). A stale enclave can never authorise more
than the published policy allows, and a forged instruction claiming a higher limit
cannot raise the enclave's ceiling.

### Defences

| Concern | How it is handled |
|---|---|
| Replayed instructions | Verdicts are memoised by request id, so a duplicate returns the original answer instead of spending the budget twice. |
| A relayer choosing the evaluation time | The rolling window uses the *enclave's* clock, never the instruction's timestamp. |
| A typo'd destination eating the allowance | The destination is checksum-validated before the policy is consulted; a bad address consumes nothing. |
| A duplicate `CREATE` stranding funds | Wallet creation is idempotent — a redelivered instruction returns the existing address. |
| A wallet with no policy yet | The limit starts at zero, which means *deny everything*. |
| Key material leaking via `GET /state` | `xrpl.Keypair` has no accessor for the private key, not even unexported. A test asserts the state report against an allowlist. |
| SSRF via the result-fetching route | The proxy URL comes from an on-chain event but is still validated: http(s) only, and private/loopback targets are refused unless `FCC_ALLOW_PRIVATE_PROXY=true`. |

## Running it for real

**Prerequisites**

- Go 1.25+, Node 20+, Foundry, Docker, and `ngrok`
- A funded Coston2 account — [faucet](https://faucet.flare.network/coston2)
- **Coston2 indexer database credentials — request these from Flare support.** The
  extension proxy follows the chain through an indexer and cannot start without them.
  There is no way around this and no substitute path; it is the one hard external
  dependency.

**Steps**

```bash
# 1. Configure
cp .env.coston2.example .env.local.coston2
#    Fill in DEPLOYMENT_PRIVATE_KEY and INITIAL_OWNER.

# 2. Expose the proxy, then select the chain
ngrok http 6674
#    Put the HTTPS URL in EXT_PROXY_URL, then:
bash ./scripts/use-chain.sh local coston2 go

# 3. Deploy the contract and register the extension
npm run fcc:setup            # scripts/pre-build.sh
#    Writes config/extension.env with EXTENSION_ID and INSTRUCTION_SENDER.

# 4. Configure the indexer
cp config/proxy/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml
#    Fill in the [db] block with the credentials from Flare.

# 5. Start the stack
npm run fcc:start            # scripts/start-services.sh

# 6. Register the TEE machine
npm run fcc:register         # scripts/post-build.sh

# 7. Prove it end to end, on-chain
npm run fcc:test             # scripts/test.sh
```

`scripts/test.sh` runs the whole flow against the live chain and asserts each step,
including that an over-limit payment comes back **refused rather than failed**.

**Then the UI:**

```bash
cd frontend
cp .env.example .env.local
#    NEXT_PUBLIC_INSTRUCTION_SENDER = INSTRUCTION_SENDER from config/extension.env
#    FCC_ALLOW_PRIVATE_PROXY=true   only if your proxy is on localhost
npm install && npm run dev
```

## For a judge

Once the stack above is running, at `http://localhost:3000/demo`:

1. **Connect a wallet.** The header shows the contract address and its extension id,
   both read from Coston2.
2. **Create wallet.** Signs a real `createWallet()` transaction. The activity log links
   to the Flare explorer and shows the instruction id the registry emitted. The XRPL
   address that comes back was generated inside the enclave.
3. **Set the daily limit to 10 XRP.** A second real transaction. The limit is then read
   *back from the contract*, not from the input box.
4. **Request 4 XRP.** Under the limit → the enclave returns a signed XRPL Payment. The
   `tx_blob` and transaction ID are shown, and can be submitted to the XRPL testnet.
5. **Request 25 XRP.** Over the limit → refused, with:

   > *daily limit exceeded: requested 25 XRP, but only 6 XRP of the 10 XRP limit
   > remains (4 XRP already spent in the last 24 hours)*

   No signature was produced. Not a rejected transaction — the signature was never
   created, because the key is inside the enclave and the enclave said no.

**Evidence to check:** every step in the activity log links to a Coston2 transaction,
and each shows the instruction id that the `TeeInstructionsSent` event carried. Those
ids are what the app polled the TEE proxy with. Nothing in the browser decided anything.

## Testing

```bash
forge build                  # contracts
cd go && go test ./...       # XRPL crypto, policy engine, handlers, ABI
npm run verify:abi           # Solidity <-> Go <-> TypeScript agreement
cd frontend && npm run build
npm run fcc:test             # on-chain end-to-end, needs the stack above
```

Where the assurance actually lives:

- **`go/internal/xrpl`** — RIPEMD-160 against its published vectors, and address
  derivation against rippled's `masterpassphrase` account
  (`rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`). Canonical field ordering is checked by walking
  the serialised output; every signature is verified against its public key.
- **`go/internal/policy`** — accumulation, the exact boundary, partial window rolls,
  stricter-limit-wins, and that a refusal consumes no budget.
- **`go/internal/extension`** — the full flow through the real action envelope, plus
  replay, idempotency, and the state-report allowlist.
- **`npm run verify:abi`** — decodes `cast abi-encode` vectors with the TypeScript
  decoders, and checks the `TeeInstructionsSent` topic hash against Flare's official
  ABI. If that hash drifts the app silently ignores every dispatch, so it is pinned.

## Deploying the frontend

```bash
npm run install:frontend && npm run build && npm run start
```

Or one click with the Vercel button above; [`vercel.json`](vercel.json) already accounts
for the app living in `frontend/`.

A hosted deployment still needs `NEXT_PUBLIC_INSTRUCTION_SENDER` set to a deployed
contract, and the TEE proxy must be publicly reachable — it is, if you are using ngrok,
since that URL is what gets published on-chain. Leave `FCC_ALLOW_PRIVATE_PROXY` unset
in production.

## Known limitations

Stated plainly, because a judge will find them anyway.

- **Attestation is simulated on Coston2.** `SIMULATED_TEE=true` uses a test attestation
  quote. Real hardware attestation needs a GCP Confidential Space VM.
- **Keys do not survive a TEE restart.** The FCC extension spec forbids extension
  filesystem use, so wallets live in enclave memory. Production would use Flare's
  `WalletKeyManager` facet for sealed backup. Restarting the TEE means new wallets.
- **One policy type.** A rolling 24h spending limit, per the MVP scope. Destination
  allowlists, per-transaction caps, and time-of-day rules are not implemented — though
  they all fit the same instruction shape.
- **`cosigners` is left empty** in `_send`. The field is wired and documented, so
  requiring a co-signing threshold is a small change, but the MVP does not use it.
- **Coston2 requires indexer credentials from Flare.** Nothing runs without them.
- **Songbird and mainnet are configuration only** — see the network matrix.

## Credits

Built on the Flare Foundation's [`fce-sign`](https://github.com/flare-foundation/fce-sign)
extension scaffold. The infrastructure layer (`go/pkg/server`, `go/tools`, the proxy
configuration, and the deployment scripts) is the scaffold's, kept intact per its
`create-extension` specification. The developer-owned pieces — the contract, the
handlers, the policy engine, the XRPL implementation, and the frontend — are this
project's.

Reference: [FCC overview](https://dev.flare.network/fcc/overview) ·
[guides](https://dev.flare.network/fcc/guides) ·
[private key extension](https://dev.flare.network/fcc/guides/sign-extension)
