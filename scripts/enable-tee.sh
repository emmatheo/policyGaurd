#!/usr/bin/env bash
# enable-tee.sh — Bring the confidential half online once Flare has issued Coston2
# indexer database credentials.
#
# Everything else is already done: the contract is deployed and verified, the extension
# is registered, and setExtensionId() has been called. The only missing input is the
# [db] block the extension proxy needs to follow the chain.
#
# Usage:
#   1. Put the credentials in config/proxy/extension_proxy.coston2.docker.toml
#   2. Expose the proxy publicly:  ngrok http 6674
#   3. EXT_PROXY_URL=https://<your-tunnel> ./scripts/enable-tee.sh
#
# On success, isTeeAvailable() flips to true and the app's TEE zone goes live with no
# code change and no redeploy.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[enable-tee]${NC} $*"; }
step() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
die()  { echo -e "${RED}[enable-tee] ERROR:${NC} $*" >&2; exit 1; }

TOML="config/proxy/extension_proxy.coston2.docker.toml"
RPC="${CHAIN_URL:-https://coston2-api.flare.network/ext/C/rpc}"

# --- preconditions --------------------------------------------------------
step "Checking prerequisites"

[[ -f "$TOML" ]] || die "$TOML not found.
  cp ${TOML}.example $TOML   then fill in the [db] block."

# The placeholders are the whole reason the proxy panics, so catch them here with a
# message that names the fix rather than letting Docker surface a stack trace.
if grep -q "<indexer-db-" "$TOML"; then
    die "$TOML still contains placeholders.
  Replace <indexer-db-host>, <indexer-db-name>, <indexer-db-user> and
  <indexer-db-password> with the Coston2 indexer credentials from Flare support.
  Without them the extension proxy panics on startup — this is the one input that
  cannot be self-served."
fi

command -v docker >/dev/null 2>&1 || die "Docker is not installed."
docker info >/dev/null 2>&1 || die "The Docker daemon is not running. Start Docker Desktop."

[[ -n "${EXT_PROXY_URL:-}" ]] || die "EXT_PROXY_URL is not set.
  Data providers push instructions to the proxy, so it must be publicly reachable:
    ngrok http 6674
    EXT_PROXY_URL=https://<your-tunnel> $0"

[[ "$EXT_PROXY_URL" == https://* ]] \
    || log "WARNING: EXT_PROXY_URL is not https. Data providers may refuse it."

[[ -f config/extension.env ]] || die "config/extension.env not found. Run scripts/pre-build.sh."
# shellcheck disable=SC1091
source config/extension.env
[[ -n "${EXTENSION_ID:-}" ]] || die "EXTENSION_ID missing from config/extension.env."
[[ -n "${INSTRUCTION_SENDER:-}" ]] || die "INSTRUCTION_SENDER missing from config/extension.env."

log "extension  $EXTENSION_ID"
log "contract   $INSTRUCTION_SENDER"
log "proxy      $EXT_PROXY_URL"

# --- bring the stack up ---------------------------------------------------
step "Starting the TEE stack"
export EXT_PROXY_URL
bash scripts/start-services.sh --chain coston2 \
    || die "start-services.sh failed. Check: docker logs \$(docker ps -aqf name=ext-proxy)"

# --- register the machine -------------------------------------------------
step "Registering the TEE machine"
bash scripts/post-build.sh \
    || die "post-build.sh failed. If it reports Verification.ChallengeExpired, simply re-run it."

# --- confirm ---------------------------------------------------------------
step "Confirming on-chain"
if command -v cast >/dev/null 2>&1; then
    AVAILABLE=$(cast call --rpc-url "$RPC" "$INSTRUCTION_SENDER" 'isTeeAvailable()(bool)' 2>/dev/null || echo "unknown")
    log "isTeeAvailable() = $AVAILABLE"
    if [[ "$AVAILABLE" == "true" ]]; then
        echo ""
        echo -e "${GREEN}The confidential half is live.${NC}"
        echo "  Nothing to redeploy — the app reads this from the chain on load."
        echo "  Prove it end to end:  bash scripts/test.sh"
    else
        die "The machine did not register. Inspect: docker logs \$(docker ps -aqf name=ext-proxy)"
    fi
else
    log "cast not on PATH; check isTeeAvailable() manually."
fi
