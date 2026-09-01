#!/usr/bin/env bash
#
# Exports the GASX database for transfer to another machine.
#
#   ./scripts/db-export.sh                    # -> gasx-export-YYYY-MM-DD.sql.gz
#   ./scripts/db-export.sh /path/to/out.sql.gz
#
# The EGSI history this produces is genuinely irreplaceable: readings are
# derived from live mempool and base-fee state at a moment in time, and
# there is no way to re-fetch a past block's pending transaction count.
# Losing it means starting the overnight collection again from zero.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_ROOT/gasx-export-$(date +%F).sql.gz}"

DB_USER="${GASX_DB_USER:-gasx}"
DB_PASS="${GASX_DB_PASS:-gasx}"
DB_HOST="${GASX_DB_HOST:-127.0.0.1}"
DB_NAME="${GASX_DB_NAME:-gasx}"

command -v mysqldump >/dev/null 2>&1 || { echo "mysqldump not found. Is MySQL installed?" >&2; exit 1; }

if ! mysqladmin ping -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" >/dev/null 2>&1; then
  echo "Cannot reach MySQL at $DB_HOST as '$DB_USER'." >&2
  echo "Start it with: sudo service mysql start" >&2
  exit 1
fi

ROWS=$(mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" -N -B \
  -e "SELECT COUNT(*) FROM egsi_snapshot;" 2>/dev/null || echo 0)
echo "Exporting $DB_NAME ($ROWS EGSI readings)..."

# --single-transaction takes a consistent snapshot without locking the
# tables, so this is safe to run while the stack is still collecting.
# --routines/--triggers keep the dump complete if either is ever added.
mysqldump \
  -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" \
  --single-transaction \
  --routines --triggers \
  --databases "$DB_NAME" \
  2>/dev/null | gzip > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "Wrote $OUT ($SIZE)"
echo
echo "Copy it to the other machine, then there:"
echo "    ./scripts/db-import.sh $(basename "$OUT")"
