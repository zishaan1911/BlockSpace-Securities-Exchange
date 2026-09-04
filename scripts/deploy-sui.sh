#!/usr/bin/env bash
#
# Publishes contracts/gasx to Sui and creates the EGSI-1H market plus its
# oracle, then writes the resulting object IDs into the adapters' .env
# files so the stack switches off dev-market mode.
#
#   ./scripts/deploy-sui.sh                      # publish to the active network
#   ./scripts/deploy-sui.sh --dry-run            # show what it would do
#   ./scripts/deploy-sui.sh --collateral=0x..::usdc::USDC
#   ./scripts/deploy-sui.sh --multiplier=1 --tick=1 --margin-bps=100
#
# This spends gas. On testnet that is free from the faucet; if your
# active environment is mainnet the script refuses unless you pass
# --allow-mainnet, because publishing there costs real SUI.
#
# Requires: the sui CLI on PATH, an active address with gas, and jq.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY_RUN=0
ALLOW_MAINNET=0
# Market<C> and MarginAccount<C> are generic over the collateral coin,
# and C is fixed when the market is created -- changing it later means
# deploying a new market, not editing config. ARCHITECTURE.md §5 calls
# for USDC; SUI is the default here only because a faucet address
# already holds it, so the full path works without first sourcing test
# USDC. Override with --collateral <type> to do it properly.
COLLATERAL="0x2::sui::SUI"
# Market economics. Margin scales with price * quantity * multiplier *
# margin_bps, so these three set what a single test order actually
# costs. The defaults are deliberately small: on testnet the point is to
# exercise the flow cheaply, not to model a realistic contract size.
MULTIPLIER=1
TICK=1
MARGIN_BPS=100

for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=1 ;;
    --allow-mainnet) ALLOW_MAINNET=1 ;;
    --collateral=*)  COLLATERAL="${arg#*=}" ;;
    --multiplier=*)  MULTIPLIER="${arg#*=}" ;;
    --tick=*)        TICK="${arg#*=}" ;;
    --margin-bps=*)  MARGIN_BPS="${arg#*=}" ;;
    -h|--help)       sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v sui >/dev/null 2>&1 || die "sui CLI not found. See scripts/README.md."
command -v jq  >/dev/null 2>&1 || die "jq not found. Install with: sudo apt-get install -y jq"

# ---------------------------------------------------------------------------
say "Checking the Sui environment"
# ---------------------------------------------------------------------------

ACTIVE_ENV="$(sui client active-env 2>/dev/null || true)"
ACTIVE_ADDR="$(sui client active-address 2>/dev/null || true)"
[ -n "$ACTIVE_ENV" ]  || die "no active Sui environment. Try: sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443 && sui client switch --env testnet"
[ -n "$ACTIVE_ADDR" ] || die "no active Sui address. Try: sui client new-address ed25519"

ok "network: $ACTIVE_ENV"
ok "collateral: $COLLATERAL"
ok "multiplier $MULTIPLIER · tick $TICK · margin ${MARGIN_BPS}bps"
ok "address: $ACTIVE_ADDR"

if [ "$ACTIVE_ENV" = "mainnet" ] && [ "$ALLOW_MAINNET" -eq 0 ]; then
  die "active env is mainnet and publishing there costs real SUI. Re-run with --allow-mainnet if you mean it."
fi

# Publishing needs gas. Checking now gives a clear message instead of a
# confusing failure partway through.
GAS_COUNT="$(sui client gas --json 2>/dev/null | jq 'length' || echo 0)"
[ "$GAS_COUNT" -gt 0 ] || die "no gas coins for $ACTIVE_ADDR. On testnet: sui client faucet"
ok "$GAS_COUNT gas coin(s) available"

if [ "$DRY_RUN" -eq 1 ]; then
  echo
  echo "Dry run. Would:"
  echo "  1. sui client publish contracts/gasx"
  echo "  2. call gasx::oracle::create_oracle  (publisher=$ACTIVE_ADDR)"
  echo "  3. call gasx::market::create_market  (EGSI-1H)"
  echo "  4. write PACKAGE/MARKET/ORACLE ids and the collateral type into"
  echo "     blockchain/sui/.env and ai/.env"
  exit 0
fi

# ---------------------------------------------------------------------------
say "Publishing contracts/gasx"
# ---------------------------------------------------------------------------

# Capture stdout and stderr separately: --json puts the payload on
# stdout, but build and gas failures go to stderr, and `set -e` inside a
# command substitution was swallowing them -- a failed publish looked
# like the script simply stopping after "BUILDING gasx".
PUBLISH_ERR="$(mktemp)"
if ! PUBLISH_JSON="$(sui client publish --gas-budget 500000000 --json "$REPO_ROOT/contracts/gasx" 2>"$PUBLISH_ERR")"; then
  echo
  echo "--- sui client publish failed ---"
  cat "$PUBLISH_ERR" >&2
  rm -f "$PUBLISH_ERR"
  die "publish failed (see the output above). Common causes: not enough gas (sui client faucet), or a Move build error."
fi
# A publish can also "succeed" with no JSON if the CLI wrote a warning
# instead of a payload.
if ! echo "$PUBLISH_JSON" | jq -e '.objectChanges' >/dev/null 2>&1; then
  echo
  cat "$PUBLISH_ERR" >&2
  rm -f "$PUBLISH_ERR"
  die "publish returned no objectChanges. Output above."
fi
rm -f "$PUBLISH_ERR"

PACKAGE_ID="$(echo "$PUBLISH_JSON" | jq -r '
  .objectChanges[] | select(.type == "published") | .packageId')"
[ -n "$PACKAGE_ID" ] && [ "$PACKAGE_ID" != "null" ] || die "could not find the package id in the publish output"
ok "package: $PACKAGE_ID"

# admin.move's init mints an AdminCap to the publisher; both create_
# calls need it as their first argument.
ADMIN_CAP="$(echo "$PUBLISH_JSON" | jq -r --arg pkg "$PACKAGE_ID" '
  .objectChanges[]
  | select(.type == "created")
  | select(.objectType | test("::admin::AdminCap$"))
  | .objectId')"
[ -n "$ADMIN_CAP" ] && [ "$ADMIN_CAP" != "null" ] || die "no AdminCap was created by publish"
ok "admin cap: $ADMIN_CAP"

# ---------------------------------------------------------------------------
say "Creating the oracle"
# ---------------------------------------------------------------------------

# max_price 1000 is the EGSI scale's ceiling (ARCHITECTURE.md §3); the
# contract rejects anything above it. 120000ms = 2 minutes of staleness
# tolerance, comfortably longer than the ~12s publish cadence.
ORACLE_JSON="$(sui client call --json --gas-budget 100000000 \
  --package "$PACKAGE_ID" --module oracle --function create_oracle \
  --args "$ADMIN_CAP" "$ACTIVE_ADDR" 120000 1000)"

ORACLE_ID="$(echo "$ORACLE_JSON" | jq -r '
  .objectChanges[]
  | select(.type == "created")
  | select(.objectType | test("::oracle::OracleState$"))
  | .objectId')"
[ -n "$ORACLE_ID" ] && [ "$ORACLE_ID" != "null" ] || die "oracle creation did not return an OracleState"
ok "oracle: $ORACLE_ID"
ok "publisher authorised: $ACTIVE_ADDR"

# ---------------------------------------------------------------------------
say "Creating the EGSI-1H market"
# ---------------------------------------------------------------------------

# One hour out, in milliseconds — EGSI-1H is a one-hour product.
EXPIRY_MS=$(( ($(date +%s) + 3600) * 1000 ))

MARKET_JSON="$(sui client call --json --gas-budget 100000000 \
  --package "$PACKAGE_ID" --module market --function create_market \
  --args "$ADMIN_CAP" "EGSI-1H" "$EXPIRY_MS" "$MULTIPLIER" "$TICK" "$MARGIN_BPS" "$ORACLE_ID")"

MARKET_ID="$(echo "$MARKET_JSON" | jq -r '
  .objectChanges[]
  | select(.type == "created")
  | select(.objectType | test("::market::Market$"))
  | .objectId')"
[ -n "$MARKET_ID" ] && [ "$MARKET_ID" != "null" ] || die "market creation did not return a Market"
ok "market: $MARKET_ID"
ok "expires: $(date -d "@$((EXPIRY_MS / 1000))" 2>/dev/null || echo "$EXPIRY_MS ms")"

# ---------------------------------------------------------------------------
say "Writing configuration"
# ---------------------------------------------------------------------------

RPC_URL="$(sui client envs --json 2>/dev/null \
  | jq -r --arg e "$ACTIVE_ENV" '.[0][] | select(.alias == $e) | .rpc' || true)"
[ -n "$RPC_URL" ] && [ "$RPC_URL" != "null" ] || RPC_URL="https://fullnode.${ACTIVE_ENV}.sui.io:443"
# `sui client envs` reports the JSON-RPC URL, which public fullnodes no
# longer serve. Strip any trailing path so the adapter gets the gRPC
# base URL instead.
RPC_URL="$(echo "$RPC_URL" | sed 's|/$||')"

set_env() {   # file key value
  local file="$1" key="$2" value="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    # Use | as the delimiter: object ids contain no |, but URLs contain /.
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

SUI_ENV="$REPO_ROOT/blockchain/sui/.env"
set_env "$SUI_ENV" GASX_SUI_RPC_URL "$RPC_URL"
set_env "$SUI_ENV" GASX_SUI_NETWORK "$ACTIVE_ENV"
set_env "$SUI_ENV" GASX_SUI_PACKAGE_ID "$PACKAGE_ID"
set_env "$SUI_ENV" GASX_SUI_MARKET_ID "$MARKET_ID"
set_env "$SUI_ENV" GASX_SUI_ORACLE_ID "$ORACLE_ID"
# Without this the gateway refuses to start: the adapter needs all five
# values unless dev-market mode is on. Omitting it left a half-written
# config that failed only at startup.
set_env "$SUI_ENV" GASX_SUI_COLLATERAL_COIN_TYPE "$COLLATERAL"
# This is what actually turns dev-market mode off.
set_env "$SUI_ENV" GASX_SUI_DEV_MARKET "false"
ok "blockchain/sui/.env updated (dev market OFF)"

AI_ENV="$REPO_ROOT/ai/.env"
set_env "$AI_ENV" GASX_AI_SUI_RPC_URL "$RPC_URL"
set_env "$AI_ENV" GASX_AI_SUI_PACKAGE_ID "$PACKAGE_ID"
set_env "$AI_ENV" GASX_AI_SUI_ORACLE_OBJECT_ID "$ORACLE_ID"
ok "ai/.env updated (oracle publishing target set)"

cat <<EOF

$(printf '\033[1;32mDeployed.\033[0m')

  package  $PACKAGE_ID
  market   $MARKET_ID
  oracle   $ORACLE_ID
  coin     $COLLATERAL
  admin    $ADMIN_CAP   <- keep this; it gates pause and settlement

The AdminCap is owned by $ACTIVE_ADDR. It is not written to any .env
because nothing in the running stack needs it — it is used from the CLI
for admin actions, and it should not sit in a file the services read.

NOTE: this market expires in one hour ($(date -d "@$((EXPIRY_MS / 1000))" +%H:%M 2>/dev/null || echo "1h")).
Re-run this script for a fresh market if you need one later; it is cheap
on testnet.

Restart the gateway to pick this up:

    cd api && npm run dev

It should no longer print the dev-market warning, and GET /api/v1/market
will read the real Market object.

The AI service still needs GASX_AI_SUI_PUBLISHER_PRIVATE_KEY set before
it can publish EGSI on-chain. That key must belong to $ACTIVE_ADDR,
since that is the address authorised as the oracle publisher above.

EOF
