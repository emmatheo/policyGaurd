#!/usr/bin/env bash
# demo.sh — Drive the whole PolicyGuard flow from the command line.
#
# Runs the same four steps as the UI against a running TEE, and asserts the outcome of
# each. Useful as a smoke test before recording a demo, and as a way to see the
# instruction payloads without a browser.
#
# Prerequisites: ./scripts/run-tee.sh running in another terminal, plus curl.
#
# Usage: ./scripts/demo.sh [relayer-url]
set -euo pipefail

RELAYER="${1:-http://127.0.0.1:6674}"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; DIM='\033[0;90m'; NC='\033[0m'
step() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
ok()   { echo -e "${GREEN}  PASS${NC} $*"; }
die()  { echo -e "${RED}  FAIL${NC} $*" >&2; exit 1; }

# A well-known XRPL testnet address.
DESTINATION="rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh"
WALLET_ID=1

command -v curl >/dev/null 2>&1 || die "curl is required"

# Extracts a top-level JSON string or number field without needing jq.
#
# String values are captured up to the closing quote rather than the next comma —
# the policy reasons contain commas, and stopping at the first one would print a
# truncated explanation, which is the one thing this demo must show in full.
field() {
    local json="$1" key="$2" value

    value=$(echo "$json" | sed -n "s/.*\"$key\":\"\([^\"]*\)\".*/\1/p" | head -1)
    if [[ -n "$value" ]]; then
        echo "$value"
        return
    fi
    echo "$json" | sed -n "s/.*\"$key\":\([0-9][0-9]*\).*/\1/p" | head -1
}

echo -e "${DIM}Relayer: $RELAYER${NC}"
curl -sf -o /dev/null "$RELAYER/health" \
    || die "TEE relayer not reachable at $RELAYER — start ./scripts/run-tee.sh first."

# --- Step 1 ---------------------------------------------------------------
step "Step 1: create a keyless XRPL wallet"
CREATE=$(curl -s -X POST "$RELAYER/wallet/create" \
    -H 'Content-Type: application/json' \
    -d "{\"walletId\":$WALLET_ID,\"owner\":\"0x0000000000000000000000000000000000000000\"}")
ADDRESS=$(field "$CREATE" classicAddress)

[[ "$ADDRESS" == r* ]] || die "expected an r... address, got: $CREATE"
ok "XRPL address generated in-enclave: $ADDRESS"
echo -e "${DIM}  The secret was created by the enclave's CSPRNG and never left it.${NC}"

# --- Step 2 ---------------------------------------------------------------
step "Step 2: set the daily limit to 10 XRP"
LIMIT=$(curl -s -X POST "$RELAYER/policy/limit" \
    -H 'Content-Type: application/json' \
    -d "{\"walletId\":$WALLET_ID,\"limitDrops\":10000000}")

[[ "$(field "$LIMIT" limitDrops)" == "10000000" ]] || die "limit not stored: $LIMIT"
ok "enclave confirmed a 10 XRP rolling 24h limit"

# --- Step 3 ---------------------------------------------------------------
step "Step 3: request 4 XRP (under the limit)"
ALLOWED=$(curl -s -X POST "$RELAYER/payment/request" \
    -H 'Content-Type: application/json' \
    -d "{\"walletId\":$WALLET_ID,\"requestId\":1,\"destination\":\"$DESTINATION\",
         \"amountDrops\":4000000,\"limitDrops\":10000000,\"sequence\":1,
         \"feeDrops\":12,\"lastLedgerSequence\":100000000}")

echo "$ALLOWED" | grep -q '"approved":true' || die "payment under the limit was refused: $ALLOWED"
echo "$ALLOWED" | grep -q '"txBlob"' || die "approved payment returned no signed transaction"
ok "APPROVED — the TEE signed a canonical XRPL Payment"
echo -e "${DIM}  reason:  $(field "$ALLOWED" reason)${NC}"
echo -e "${DIM}  tx hash: $(field "$ALLOWED" txHash)${NC}"

# --- Step 4 ---------------------------------------------------------------
step "Step 4: request 25 XRP (over the limit)"
BLOCKED=$(curl -s -X POST "$RELAYER/payment/request" \
    -H 'Content-Type: application/json' \
    -d "{\"walletId\":$WALLET_ID,\"requestId\":2,\"destination\":\"$DESTINATION\",
         \"amountDrops\":25000000,\"limitDrops\":10000000,\"sequence\":2,
         \"feeDrops\":12,\"lastLedgerSequence\":100000000}")

echo "$BLOCKED" | grep -q '"approved":false' || die "payment over the limit was approved: $BLOCKED"
echo "$BLOCKED" | grep -q '"txBlob"' && die "a refused payment still returned a signed transaction"
ok "REFUSED — no signature was produced"
echo -e "${DIM}  reason: $(field "$BLOCKED" reason)${NC}"

# --- Enclave state --------------------------------------------------------
step "Enclave state"
curl -s "$RELAYER/state"
echo ""

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN} Demo complete — all assertions passed${NC}"
echo -e "${GREEN}========================================${NC}"
