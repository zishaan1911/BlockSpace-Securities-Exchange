#!/usr/bin/env bash
#
# Checks an OracleState object's actual on-chain price, independent of
# what the AI service or gateway report.
#
#   ./scripts/check-oracle.sh                    # reads blockchain/sui/.env
#   ./scripts/check-oracle.sh 0xORACLE_ID
#
# Exists because `sui client object --json`'s shape changed since this
# was last checked by hand: fields now sit flat under `content`, not
# nested under `content.fields` as in older CLI versions and most
# still-online examples. Written once here so nobody has to rediscover
# that from a KeyError again.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ORACLE_ID="${1:-}"
if [ -z "$ORACLE_ID" ]; then
  ORACLE_ID="$(grep '^GASX_SUI_ORACLE_ID=' "$REPO_ROOT/blockchain/sui/.env" 2>/dev/null | cut -d= -f2)"
  [ -n "$ORACLE_ID" ] || { echo "no oracle id given and none found in blockchain/sui/.env" >&2; exit 1; }
fi

sui client object "$ORACLE_ID" --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
c = d['content']
print(f\"oracle       {d['objectId']}\")
print(f\"has_price    {c['has_price']}\")
print(f\"price        {c['price']}\")
print(f\"max_price    {c['max_price']}\")
print(f\"last_update  {c['last_update_ms']} ms\")
print(f\"max_stale    {c['max_staleness_ms']} ms\")
print(f\"publisher    {c['publisher']}\")
"
