# PolicyGuard XRPL

**A keyless, policy-controlled XRPL account, built on Flare Confidential Compute.**

Submission for the Flare Summer Signal hackathon — Confidential Compute Apps track.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Femmatheo%2FpolicyGaurd&project-name=policyguard-xrpl&repository-name=policyguard-xrpl&demo-title=PolicyGuard%20XRPL&demo-description=A%20keyless%2C%20policy-controlled%20XRPL%20account%20powered%20by%20Flare%20Confidential%20Compute)

> One click deploys the **frontend**. The landing page is fully self-contained. The
> `/demo` route needs a TEE to talk to, so it will report *TEE offline* on a hosted
> deployment until you point `NEXT_PUBLIC_RELAYER_URL` at a reachable enclave — see
> [Deploying the frontend](#deploying-the-frontend).

---

## The idea

An XRPL account is only as safe as the secret behind it. Lose the seed and the funds
are gone; leak it and they are someone else's. Every mitigation people reach for —
hardware wallets, multisig, custodians — works by making the key harder to *use*, which
is also what makes it harder to use *legitimately*.

PolicyGuard removes the key from the picture instead.

The XRPL signing key is generated inside a Trusted Execution Environment and never
leaves it. There is no seed to back up, no secret to export, and no API that returns
one. What the account holder controls is not a key but a **policy**, published on
Flare: *at most X XRP per rolling 24 hours*. The enclave holds the only copy of the
key, so the enclave is the only thing that can enforce that policy — and it does, on
every single payment, before it will produce a signature.

The result is an XRPL account governed by rules rather than by possession of a secret.

## What it does

The MVP implements exactly one policy type: a **rolling 24-hour spending limit**.

1. **Create a wallet.** The enclave generates a secp256k1 keypair from its own CSPRNG
   and returns only the derived classic address and public key.
2. **Set a daily limit.** The `InstructionSender` contract on Coston2 publishes the
   limit so anyone can audit the rule. The enclave stores its own copy.
3. **Request a payment.** The enclave re-derives the 24h spend from its in-enclave
   ledger and decides.
   - Within the limit → it signs a canonical XRPL `Payment` and returns the `tx_blob`.
   - Over the limit → it refuses, and says exactly why.

A refusal is not an error. It is the answer the caller asked for, returned as a
successful action result with `approved: false` and a human-readable reason. Errors are
reserved for the cases where no verdict could be reached at all — a malformed message,
an unknown wallet, a bad destination address.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Flare (Coston2)                                                     │
│                                                                      │
│   InstructionSender.sol  ──── the public policy record               │
│     · createWallet()      · setDailyLimit()   · requestPayment()     │
│     · stores the limit, emits every request as an event              │
│     · deliberately does NOT reject over-limit requests               │
│                            │                                         │
│                            │ sendInstructions()                      │
│                            ▼                                         │
│   TeeExtensionRegistry ── emits TeeInstructionsSent                  │
└────────────────────────────┼─────────────────────────────────────────┘
                             │
              data providers reach consensus and co-sign
                             │
                             ▼
                        TEE proxy  ──►  TEE node
                                          │  POST /action
┌─────────────────────────────────────────┼────────────────────────────┐
│  TEE extension (the enclave)            ▼                            │
│                                                                      │
│   WALLET/CREATE    → generate a secp256k1 keypair, return the address │
│   POLICY/SET_LIMIT → store the rolling 24h limit                     │
│   PAYMENT/REQUEST  → evaluate, then sign or refuse                   │
│                                                                      │
│   · the signing key lives only here, with no export path             │
│   · the 24h spend ledger lives only here                             │
│   · GET /state reports addresses and counters, never key material    │
└──────────────────────────────────────────────────────────────────────┘
```

### Why the contract does not enforce the policy

It would be natural to `revert` on an over-limit request. PolicyGuard does not, for two
reasons.

The first is demonstrability: a reverted transaction never reaches the enclave, so the
user gets a failed transaction instead of an explained decision. The refusal, with its
reason, is the product.

The second is honesty about where trust actually sits. The enclave holds the key, so
the enclave is the enforcement point whether or not the contract also checks. Putting a
second, weaker check on-chain would suggest a guarantee the contract cannot make.

What the contract *does* provide is auditability — the limit and every request are
public — and a **cap**. The current on-chain limit travels with each instruction, and
the enclave applies whichever of the two limits is stricter:

```go
// go/internal/policy/policy.go
func effectiveLimit(enclave, onChain uint64) uint64
```

So a stale enclave can never authorise more than the published policy allows, and a
forged instruction claiming a higher limit cannot raise the enclave's own ceiling.

### Defences worth pointing out

| Concern | How it is handled |
|---|---|
| Replayed instructions | Verdicts are memoised by request id, so a duplicate returns the original answer instead of spending the budget twice. |
| A relayer choosing the evaluation time | The rolling window is evaluated against the *enclave's* clock, never the timestamp in the instruction. |
| A typo'd destination eating the allowance | The destination is checksum-validated before the policy is consulted; a bad address is an error and consumes nothing. |
| A duplicate `CREATE` stranding funds | Wallet creation is idempotent — a redelivered instruction returns the existing address rather than minting a second key. |
| A wallet with no policy yet | The limit starts at zero, which means *deny everything*, not *allow everything*. |
| Key material leaking through `GET /state` | `xrpl.Keypair` has no accessor for the private key, not even an unexported one. A test asserts the state report's fields against an allowlist. |

## Repository layout

```
.
├── contracts/
│   ├── InstructionSender.sol         # policy record + FCC instruction entry point
│   └── interfaces/                   # ITeeExtensionRegistry, ITeeMachineRegistry
├── go/
│   ├── cmd/
│   │   ├── main.go                   # extension, standalone
│   │   ├── docker/main.go            # extension + tee-node, for the container
│   │   └── relayer/main.go           # local stand-in for the FCC instruction relay
│   ├── internal/
│   │   ├── config/                   # OPType constants — must match the Solidity side
│   │   ├── extension/                # the handlers
│   │   ├── policy/                   # the rolling 24h spend ledger
│   │   └── xrpl/                     # address derivation, serializer, signer
│   ├── pkg/
│   │   ├── protocol/                 # ABI encoding, shared by enclave and clients
│   │   └── types/                    # the GET /state report
│   └── tools/                        # deploy + registration CLIs, e2e test
├── frontend/                         # Next.js App Router + TypeScript + viem
├── scripts/
│   ├── run-tee.sh                    # local demo: build and run extension + relayer
│   ├── demo.sh                       # drive the whole flow from the shell
│   ├── generate-bindings.sh          # contract → Go bindings
│   ├── pre-build.sh                  # deploy + register on Coston2
│   ├── post-build.sh                 # register the TEE machine
│   └── test.sh                       # on-chain end-to-end test
├── Dockerfile, docker-compose.yaml   # the Coston2 stack
└── config/coston2/                   # Flare contract addresses
```

## Quick start — the local demo

This path needs only **Go 1.25+** and **Node 20+**. No Docker, no ngrok, no database
credentials, no testnet funds.

```bash
# Terminal 1 — the TEE
./scripts/run-tee.sh

# Terminal 2 — the UI
cd frontend
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

Prefer the command line? With the TEE running:

```bash
./scripts/demo.sh
```

It walks all four steps and asserts each outcome.

### What "local" does and does not mean

The extension binary is the same one that runs inside the Confidential Space VM, with
the same handlers and the same wire format. The local relayer replaces only the
*transport*: it builds the identical `DataFixed` envelope the TEE node delivers and
posts it to the same `POST /action` endpoint. Nothing in the enclave is special-cased.

What it does **not** reproduce is the consensus layer. Locally, instructions are
accepted because the relayer sent them — not because a threshold of Flare data
providers signed them, and not inside real hardware-attested memory. That is precisely
what the Coston2 deployment below adds, and why this is a development harness rather
than a substitute for one.

## Deploying to Coston2

Follow Flare's [FCC guides](https://dev.flare.network/fcc/guides). PolicyGuard is built
on the official [`fce-sign`](https://github.com/flare-foundation/fce-sign) scaffold and
keeps its tooling intact, so the standard scripts apply unchanged.

**Prerequisites**

- A funded Coston2 account ([faucet](https://faucet.flare.network/coston2))
- Docker and `ngrok`
- Coston2 indexer database credentials — **request these from Flare support**; the
  extension proxy cannot follow the chain without them

**Steps**

```bash
# 1. Configure
cp .env.example .env.local.coston2
#    Fill in DEPLOYMENT_PRIVATE_KEY and INITIAL_OWNER.

# 2. Expose the proxy and select the chain
ngrok http 6674
#    Put the HTTPS URL in EXT_PROXY_URL, then:
bash ./scripts/use-chain.sh local coston2 go

# 3. Deploy the contract and register the extension
bash ./scripts/pre-build.sh
#    Writes config/extension.env with EXTENSION_ID and INSTRUCTION_SENDER.

# 4. Configure the indexer
cp config/proxy/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml
#    Fill in the [db] block with the credentials from Flare.

# 5. Start the stack
bash ./scripts/start-services.sh

# 6. Register the TEE machine
bash ./scripts/post-build.sh

# 7. Run the on-chain end-to-end test
bash ./scripts/test.sh
```

`scripts/test.sh` performs the full demo on-chain and asserts each step, including that
an over-limit payment comes back **refused rather than failed**.

Then point the UI at the deployment:

```bash
# frontend/.env.local
NEXT_PUBLIC_INSTRUCTION_SENDER="0x…"     # from config/extension.env
NEXT_PUBLIC_RELAYER_URL="https://…"      # your ngrok URL
```

With a contract configured, connecting a wallet puts the UI in Coston2 mode: every step
is anchored on-chain first, and the activity log links each one to the explorer.

## Deploying the frontend

### Locally, as a production build

```bash
npm run install:frontend
npm run build
npm run start          # http://localhost:3000
```

Run `npm run tee` alongside it and the `/demo` route is fully live.

### On Vercel, in one click

Use the button at the top of this file. It clones the repo and builds it with the
settings already committed in [`vercel.json`](vercel.json) — the Next.js app lives in
`frontend/`, which is what `buildCommand` and `outputDirectory` account for. No
manual project configuration is needed.

**What you get:** the landing page, complete and self-contained.

**What you do not get:** a TEE. The enclave is a Go binary that has to run somewhere
reachable, and Vercel's runtime is not that place. Out of the box the `/demo` route
will show *TEE offline*, which is the honest state rather than a broken one.

To make the hosted demo live, expose a running enclave and point the deployment at it:

```bash
npm run tee            # locally
ngrok http 6674        # copy the HTTPS URL
```

Then set this in the Vercel project's environment variables and redeploy:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_RELAYER_URL` | your ngrok HTTPS URL |
| `NEXT_PUBLIC_INSTRUCTION_SENDER` | the deployed contract address, to enable Coston2 mode |

Both are `NEXT_PUBLIC_`, so they are baked in at build time — a change needs a
redeploy, not just a restart.

## Demo script (2–3 minutes)

> **Setup before recording:** `./scripts/run-tee.sh` in one terminal, `npm run dev` in
> another, browser at `http://localhost:3000`. Check the header shows **TEE online**.

**0:00 — The problem.**
"This is an XRPL account with no private key. Not a key in a vault — no key that exists
outside a TEE at all. What controls it is a policy."

**0:20 — Create the wallet.** Click **Create wallet**.
"The enclave just generated a secp256k1 keypair using its own random source. It gave
back the address and the public key. It did not give back a secret, because there's no
code path that returns one — the private key field has no accessor, even inside the
package."

**0:50 — Set the policy.** Limit `10` XRP → **Set limit**.
"Ten XRP per rolling 24 hours. On Coston2 this is published by the contract so anyone
can audit it. The enclave keeps its own copy and enforces whichever is stricter."

**1:15 — A payment that passes.** Amount `4` → **Request payment**.
"Four XRP, under the limit. The enclave checked its own 24-hour ledger and signed. This
is a real canonical XRPL Payment — here's the tx_blob and the transaction ID. The
allowance meter now reads 6 XRP remaining."

**1:50 — A payment that gets blocked.** Amount `25` → **Request payment**.
"Twenty-five XRP. Over the limit."

> *daily limit exceeded: requested 25 XRP, but only 6 XRP of the 10 XRP limit remains
> (4 XRP already spent in the last 24 hours)*

"No signature was produced. Not a rejected transaction — the signature was never
created, because the key is inside the enclave and the enclave said no. The blocked
counter goes up, and the reason is specific enough to act on."

**2:20 — Why it matters.**
"For an XRP holder, this is a spending account that cannot be drained by a stolen seed,
because there is no seed. And the policy layer is the extension point: a daily limit is
one rule, but destination allowlists, time windows, and price-triggered rules all fit
the same shape."

## Testing

```bash
# Contracts
forge build

# Go: XRPL crypto, policy engine, handlers, ABI compatibility
cd go && go test ./...

# Frontend
cd frontend && npm run typecheck && npm run build

# End to end against a running TEE
./scripts/demo.sh
```

The Go suite is where the real assurance lives:

- **`internal/xrpl`** — RIPEMD-160 against its published vectors, and address
  derivation against rippled's `masterpassphrase` account
  (`rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh`). Canonical field ordering is checked by
  walking the serialized output; every signature is verified against the public key.
- **`internal/policy`** — accumulation, the exact boundary, partial window rolls,
  stricter-limit-wins, and that a refusal consumes no budget.
- **`internal/extension`** — the full demo flow through the real action envelope, plus
  replay, idempotency, and the state-report allowlist.
- **`pkg/protocol`** — decodes byte vectors produced by Foundry's `cast abi-encode`, so
  a change to the Solidity call sites that is not mirrored in Go fails the build rather
  than a live TEE.

## Design notes

**Why the key is generated rather than imported.** Flare's `fce-sign` example *receives*
an ECIES-encrypted key. PolicyGuard generates its own, which means the secret has no
existence outside the enclave at any point in its lifetime — not even briefly on the
machine that would have encrypted it.

**Why there is no seed.** XRPL wallets are usually derived from a 16-byte seed via the
family generator, and the seed is what a user backs up. PolicyGuard has nothing to back
up by design. XRPL derives the account address from the public key alone, so a directly
generated secp256k1 keypair is a first-class XRPL identity.

**Why RIPEMD-160 is vendored.** `golang.org/x/crypto/ripemd160` has been deprecated
since 2019 and is a removal candidate. ~150 lines of a frozen, fully specified
algorithm, pinned by published test vectors, is a better dependency for an image that
has to build reproducibly.

**Keys do not survive a restart.** The FCC extension spec forbids extension filesystem
use, so wallets live in enclave memory. A production deployment would use Flare's
`WalletKeyManager` facet for sealed backup. For an MVP, restarting the TEE means
creating a new wallet.

## Known limitations

- **One policy type.** A rolling 24h spending limit, per the MVP scope. Destination
  allowlists, per-transaction caps, and time-of-day rules are not implemented.
- **Keys are not persisted** across a TEE restart (see above).
- **Local mode has no consensus.** Instructions are trusted because the relayer sent
  them. Coston2 adds data-provider consensus and real attestation.
- **`cosigners` is left empty** in `_send`. The field is wired and documented, so
  requiring a co-signing threshold is a one-line change, but the MVP does not use it.
- **Simulated TEE.** `SIMULATED_TEE=true` uses test attestation. A production deployment
  needs a GCP Confidential Space VM, which is out of scope here.
- **Coston2 requires indexer credentials** from Flare support, which is why the local
  path exists.

## Credits

Built on the Flare Foundation's [`fce-sign`](https://github.com/flare-foundation/fce-sign)
extension scaffold. The infrastructure layer (`go/pkg/server`, `go/tools`, the proxy
configuration, and the deployment scripts) is the scaffold's, kept deliberately intact
per its `create-extension` specification; the developer-owned pieces — the contract, the
handlers, the policy engine, the XRPL implementation, and the frontend — are this
project's.

Reference documentation: [Flare Confidential Compute](https://dev.flare.network/fcc/overview),
[FCC guides](https://dev.flare.network/fcc/guides),
[private key extension](https://dev.flare.network/fcc/guides/sign-extension).
