#!/usr/bin/env bash
# generate-bindings.sh — Compile Solidity contracts and generate Go bindings.
#
# Prerequisites: forge (Foundry), Go
#
# Extraction goes through `forge inspect` rather than jq so the only tools needed are
# the ones the project already requires.
#
# Usage: ./scripts/generate-bindings.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Contract name and Go package ---
CONTRACT_NAME="InstructionSender"
GO_PKG="policyguard"
BINDINGS_DIR="$PROJECT_DIR/go/tools/pkg/contracts/$GO_PKG"

cd "$PROJECT_DIR"

echo "=== Step 1: Compile Solidity contracts ==="
forge build

# Verify the contract name in the source matches what we expect
if ! grep -q "contract ${CONTRACT_NAME}" "$PROJECT_DIR/contracts/InstructionSender.sol" 2>/dev/null; then
    echo ""
    echo "ERROR: Contract name '${CONTRACT_NAME}' not found in contracts/InstructionSender.sol."
    echo "Make sure the contract name in InstructionSender.sol matches CONTRACT_NAME in this script."
    exit 1
fi

echo "=== Step 2: Extract ABI and BIN ==="
FORGE_OUT="$PROJECT_DIR/out/InstructionSender.sol/${CONTRACT_NAME}.json"
if [[ ! -f "$FORGE_OUT" ]]; then
    echo "ERROR: forge output not found at $FORGE_OUT"
    echo "Check that CONTRACT_NAME matches your Solidity contract name."
    exit 1
fi

mkdir -p "$BINDINGS_DIR"

# Extract the ABI as a JSON array.
forge inspect "$CONTRACT_NAME" abi --json > "$BINDINGS_DIR/${CONTRACT_NAME}.abi"

# Extract the creation bytecode, stripping the 0x prefix abigen does not expect.
forge inspect "$CONTRACT_NAME" bytecode | sed 's/^0x//' > "$BINDINGS_DIR/${CONTRACT_NAME}.bin"

# An empty artifact here produces bindings that compile but fail at deploy time with
# an opaque error, so fail loudly instead.
for artifact in "${CONTRACT_NAME}.abi" "${CONTRACT_NAME}.bin"; do
    if [[ ! -s "$BINDINGS_DIR/$artifact" ]]; then
        echo "ERROR: $BINDINGS_DIR/$artifact is empty — forge inspect produced no output."
        exit 1
    fi
done

echo "  ABI → $BINDINGS_DIR/${CONTRACT_NAME}.abi"
echo "  BIN → $BINDINGS_DIR/${CONTRACT_NAME}.bin"

echo "=== Step 3: Generate Go bindings ==="
cd "$PROJECT_DIR/go/tools"
go generate ./pkg/contracts/$GO_PKG/

echo "=== Done ==="
echo "Generated: $BINDINGS_DIR/autogen.go"
