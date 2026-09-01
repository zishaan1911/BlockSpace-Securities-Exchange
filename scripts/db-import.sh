#!/usr/bin/env bash
#
# Imports a GASX database export produced by scripts/db-export.sh.
#
#   ./scripts/db-import.sh gasx-export-2026-09-01.sql.gz
#   ./scripts/db-import.sh dump.sql.gz --merge   # keep existing rows
#
# Default behaviour REPLACES the local gasx database. Pass --merge to add
# the imported readings to whatever is already there instead.

set -euo pipefail

DUMP="${1:-}"
MODE="replace"
[ "${2:-}" = "--merge" ] && MODE="merge"

[ -n "$DUMP" ] || { echo "usage: $0 <dump.sql.gz> [--merge]" >&2; exit 1; }
[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }

DB_USER="${GASX_DB_USER:-gasx}"
DB_PASS="${GASX_DB_PASS:-gasx}"
DB_HOST="${GASX_DB_HOST:-127.0.0.1}"
DB_NAME="${GASX_DB_NAME:-gasx}"

if ! mysqladmin ping -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" >/dev/null 2>&1; then
  echo "Cannot reach MySQL at $DB_HOST as '$DB_USER'." >&2
  echo "Run ./scripts/bootstrap.sh first, or: sudo service mysql start" >&2
  exit 1
fi

EXISTING=$(mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" -N -B \
  -e "SELECT COUNT(*) FROM egsi_snapshot;" 2>/dev/null || echo 0)

decompress() {
  case "$DUMP" in
    *.gz) gunzip -c "$DUMP" ;;
    *)    cat "$DUMP" ;;
  esac
}

if [ "$MODE" = "replace" ]; then
  if [ "$EXISTING" -gt 0 ]; then
    echo "This will REPLACE $EXISTING existing EGSI readings in '$DB_NAME'."
    echo "That data cannot be regenerated — past mempool state is unrecoverable."
    echo "Back it up first with ./scripts/db-export.sh, or re-run with --merge."
    read -r -p "Replace them? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
  fi
  echo "Importing (replace)..."
  # The dump includes CREATE DATABASE/USE, so it targets gasx itself.
  decompress | mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" 2>/dev/null
else
  echo "Importing (merge)..."
  # Load into a scratch database, then copy rows across with INSERT
  # IGNORE so the unique key on (market, block_number) drops duplicates
  # rather than aborting the whole import.
  SCRATCH="${DB_NAME}_import_tmp"
  mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" \
    -e "DROP DATABASE IF EXISTS \`$SCRATCH\`; CREATE DATABASE \`$SCRATCH\`;" 2>/dev/null

  # Strip the dump's own CREATE DATABASE/USE lines so it lands in the
  # scratch database instead of overwriting the real one.
  decompress \
    | grep -v '^CREATE DATABASE' \
    | grep -v '^USE `' \
    | mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$SCRATCH" 2>/dev/null

  for TABLE in egsi_snapshot hedge_evaluation prepared_order trade_event position_snapshot; do
    mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" 2>/dev/null <<SQL || true
INSERT IGNORE INTO \`$DB_NAME\`.\`$TABLE\` SELECT * FROM \`$SCRATCH\`.\`$TABLE\`;
SQL
  done
  # forecast references egsi_snapshot by id, and those ids will not line
  # up after a merge, so it is deliberately not copied. The readings
  # themselves are what matter for retraining; forecasts are regenerated.
  echo "Note: the forecast table was not merged — its snapshot ids would not"
  echo "      line up across machines. Readings are what retraining needs."

  mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" \
    -e "DROP DATABASE \`$SCRATCH\`;" 2>/dev/null
fi

FINAL=$(mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" -N -B \
  -e "SELECT COUNT(*) FROM egsi_snapshot;" 2>/dev/null || echo 0)

echo
echo "Done. '$DB_NAME' now holds $FINAL EGSI readings (was $EXISTING)."
mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" 2>/dev/null -e "
SELECT COUNT(*) AS readings,
       MIN(recorded_at) AS first_seen,
       MAX(recorded_at) AS last_seen
FROM egsi_snapshot;" || true
