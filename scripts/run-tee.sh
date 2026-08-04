#!/usr/bin/env bash
# run-tee.sh — Build and run the PolicyGuard TEE extension plus the local instruction
# relayer, for the demo that does not need Docker, ngrok, or indexer credentials.
#
# The extension binary is exactly the one that runs inside the Confidential Space VM.
# Only the transport differs: the relayer hand-delivers the same instruction envelope
# the TEE node would deliver. See go/cmd/relayer/main.go for what that does and does
# not reproduce.
#
# Prerequisites: Go 1.25+
#
# Usage: ./scripts/run-tee.sh
#   EXTENSION_PORT  port the extension listens on (default 7702)
#   RELAYER_LISTEN  address the relayer listens on (default :6674)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${GREEN}[policyguard]${NC} $*"; }
die() { echo -e "${RED}[policyguard] ERROR:${NC} $*" >&2; exit 1; }

EXTENSION_PORT="${EXTENSION_PORT:-7702}"
SIGN_PORT="${SIGN_PORT:-7701}"
RELAYER_LISTEN="${RELAYER_LISTEN:-:6674}"

command -v go >/dev/null 2>&1 || die "Go is not on PATH. Install Go 1.25+ from https://go.dev/dl/"

BIN_DIR="$PROJECT_DIR/.bin"
mkdir -p "$BIN_DIR"

log "Building the TEE extension and relayer..."
cd "$PROJECT_DIR/go"
go build -o "$BIN_DIR/policyguard-extension" ./cmd
go build -o "$BIN_DIR/policyguard-relayer" ./cmd/relayer

# Make sure both children die with this script, however it exits.
PIDS=()
cleanup() {
    for pid in "${PIDS[@]:-}"; do
        [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
    done
}
trap cleanup EXIT INT TERM

log "Starting the TEE extension on port $EXTENSION_PORT..."
EXTENSION_PORT="$EXTENSION_PORT" SIGN_PORT="$SIGN_PORT" "$BIN_DIR/policyguard-extension" &
PIDS+=($!)

# Wait for the extension to bind before pointing the relayer at it, so a slow start
# does not look like a crash.
for _ in $(seq 1 40); do
    if curl -sf -o /dev/null "http://127.0.0.1:$EXTENSION_PORT/state" 2>/dev/null; then
        break
    fi
    sleep 0.25
done
curl -sf -o /dev/null "http://127.0.0.1:$EXTENSION_PORT/state" 2>/dev/null \
    || die "The extension did not come up on port $EXTENSION_PORT."

log "Starting the local instruction relayer on $RELAYER_LISTEN..."
RELAYER_LISTEN="$RELAYER_LISTEN" EXTENSION_URL="http://127.0.0.1:$EXTENSION_PORT" \
    "$BIN_DIR/policyguard-relayer" &
PIDS+=($!)

sleep 1
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN} PolicyGuard TEE is running${NC}"
echo -e "${CYAN}========================================${NC}"
echo "  Extension   http://127.0.0.1:$EXTENSION_PORT"
echo "  Relayer     http://127.0.0.1${RELAYER_LISTEN}"
echo "  State       curl http://127.0.0.1${RELAYER_LISTEN}/state"
echo ""
echo "  Next: cd frontend && npm run dev"
echo "  Stop: Ctrl-C"
echo ""

wait
