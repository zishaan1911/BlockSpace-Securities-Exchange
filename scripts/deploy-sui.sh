#!/usr/bin/env bash
#
# Publishes contracts/gasx to Sui and creates the EGSI-1H market plus its
# oracle, then writes the resulting object IDs into the adapters' .env
# files so the stack switches off dev-market mode.
#
#   ./scripts/deploy-sui.sh                      # publish to the active network
#   ./scripts/deploy-sui.sh --dry-run            # show what it would do
#   ./scripts/deploy-sui.sh --collateral=0x..::usdc::USDC
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

for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=1 ;;
    --allow-mainnet) ALLOW_MAINNET=1 ;;
    --collateral=*)  COLLATERAL="${arg#*=}" ;;
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
ok "address: $ACTIVE_ADDR"

if [ "$ACTIVE_ENV" = "mainnet" ] && [ "$ALLOW_MAINNET" -eq 0 ]; then
  die "active env is mainnet and publishing there costs real SUI. Re-run with --allow-mainnet if you mean it."
fi

# Publishing needs a SINGLE coin covering the whole gas budget, not
# merely some gas somewhere -- Sui does not auto-merge coins for a
# publish call. Three small coins pass a bare existence check while
# still failing to publish, which is exactly what happened on testnet
# here: the count check passed, the actual publish then failed with the
# real cause hidden. Check the largest coin's balance instead.
GAS_BUDGET=500000000
GAS_JSON="$(sui client gas --json 2>/dev/null || echo '[]')"
GAS_COUNT="$(echo "$GAS_JSON" | jq 'length' 2>/dev/null || echo 0)"
[ "${GAS_COUNT:-0}" -gt 0 ] || die "no gas coins for $ACTIVE_ADDR. On testnet: sui client faucet"

# The CLI's gas JSON shape has changed at least twice (nested id.id /
# balance.value, then flat gasCoinId / gasBalance, sometimes with an
# extra array-wrapping layer around the coin list) -- this script has
# now guessed wrong at that shape more than once. Recursive descent
# (`..`) finds a balance-shaped field wherever it actually sits, rather
# than assuming a specific nesting depth, and covers every shape seen
# so far in one filter.
MAX_BALANCE="$(echo "$GAS_JSON" | jq '
  [.. | objects | (.gasBalance // .mistBalance // .balance.value? // .balance // empty)
   | if type == "number" then . else (. | tonumber) end] | max
' 2>/dev/null)"

if [ -z "$MAX_BALANCE" ] || [ "$MAX_BALANCE" = "null" ]; then
  # Could not parse a balance out of whatever shape this CLI version
  # uses. Warn and proceed rather than blocking on a parsing gap in
  # THIS script -- the publish attempt below fails loudly with full
  # output on its own if gas really is insufficient, so this pre-check
  # is a convenience, not the safety net.
  warn "could not parse gas coin balances from 'sui client gas --json'; skipping the pre-check"
  warn "if publish fails below with a gas error, run: sui client faucet"
else
  ok "$GAS_COUNT gas coin(s), largest holds $MAX_BALANCE MIST (need $GAS_BUDGET)"
  if [ "$MAX_BALANCE" -lt "$GAS_BUDGET" ]; then
    die "no single gas coin covers the $GAS_BUDGET MIST budget (largest is $MAX_BALANCE). Run: sui client faucet"
  fi
fi

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

# The Move CLI records each publish per-network in a local Published.toml
# (or an equivalent build-info file, depending on toolchain version) and
# refuses to publish again over an existing entry: "Your package is
# already published." That file is never committed -- it is a per-machine
# publish record, not project state -- so nothing about a fresh git clone
# would ever show it, and it only appears after a publish has actually
# succeeded once on this machine.
#
# This script's whole purpose is standing up a disposable test market on
# every run, so reusing a previous publish is never what is wanted here.
# Rather than parse TOML in bash to remove one network's entry, every
# publish-tracking file under contracts/gasx is cleared before publishing
# -- broad on purpose, since guessing the exact filename has already cost
# real time in this project once already (see the gas-JSON-shape fixes
# above) and a stray leftover file from a different toolchain version
# would silently defeat a narrower match.
for stale in "$REPO_ROOT"/contracts/gasx/Published.toml              "$REPO_ROOT"/contracts/gasx/build/*/Published.toml              "$REPO_ROOT"/contracts/gasx/*.pubfile.json; do
  [ -e "$stale" ] || continue
  rm -f "$stale"
  ok "cleared stale publish record: $(basename "$stale")"
done

# stdout and stderr are captured to SEPARATE files, not merged.
#
# Merging them was tried first and was itself a bug: on a SUCCESSFUL
# publish, Sui writes its build-progress lines ("[NOTE] Dependencies
# on...", "BUILDING gasx") to one stream and the clean --json payload to
# the other. A merged capture concatenates text-then-JSON into one
# string, which is not valid JSON at all -- so a publish that fully
# succeeded (status success, package published, objectChanges present)
# was reported as a failure, because jq could not parse "[NOTE]...{...}"
# as one document. That happened for real: a publish creating package
# 0xc0b0...25000 with all 9 modules was reported as producing "no
# objectChanges", which was jq failing to parse, not the payload
# actually being empty.
#
# So: parse ONLY stdout, which is where --json puts the actual payload
# on success. If that parse fails for any reason, print BOTH files --
# stdout and stderr -- so a genuine failure still shows everything,
# regardless of which stream the CLI used to explain itself.
PUBLISH_OUT="$(mktemp)"
PUBLISH_ERR="$(mktemp)"
sui client publish --gas-budget "$GAS_BUDGET" --json "$REPO_ROOT/contracts/gasx"   > "$PUBLISH_OUT" 2> "$PUBLISH_ERR"
PUBLISH_STATUS=$?

if [ "$PUBLISH_STATUS" -ne 0 ] || ! PUBLISH_JSON="$(jq -e '.objectChanges' "$PUBLISH_OUT" >/dev/null 2>&1 && cat "$PUBLISH_OUT")"; then
  echo
  echo "--- sui client publish did not produce a usable result ---"
  echo "-- stderr --"
  cat "$PUBLISH_ERR"
  echo "-- stdout --"
  cat "$PUBLISH_OUT"
  rm -f "$PUBLISH_OUT" "$PUBLISH_ERR"
  die "publish failed or returned an unexpected payload (see the full output above)."
fi
rm -f "$PUBLISH_OUT" "$PUBLISH_ERR"

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
  --args "$ADMIN_CAP" "EGSI-1H" "$EXPIRY_MS" 10 10 1000 "$ORACLE_ID")"

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
