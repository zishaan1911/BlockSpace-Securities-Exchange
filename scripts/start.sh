#!/usr/bin/env bash
#
# Starts the whole GASX stack from one terminal.
#
#   ./scripts/start.sh              # everything, frontend on localhost
#   ./scripts/start.sh --lan        # also reachable from other devices on the wifi
#   ./scripts/start.sh --no-db      # skip MySQL (no durable state, no charts)
#
# Ctrl-C stops everything it started. Services that were already running
# are left alone, so this will not kill a database someone else is using.
#
# Logs stream to logs/*.log rather than being interleaved on one screen —
# four services writing to the same terminal is unreadable, and the whole
# point of this script is to stop juggling terminals.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
LAN=0
WITH_DB=1

for arg in "$@"; do
  case "$arg" in
    --lan)   LAN=1 ;;
    --no-db) WITH_DB=0 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# PIDs of things THIS script started, so cleanup does not kill anything
# that was already running.
STARTED_PIDS=()
STARTED_MYSQL=0

cleanup() {
  echo
  say "Stopping"
  for pid in "${STARTED_PIDS[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      # Kill the process group: npm/uvicorn spawn children that would
      # otherwise survive and keep ports bound.
      kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    fi
  done
  sleep 1
  for pid in "${STARTED_PIDS[@]:-}"; do
    kill -0 "$pid" 2>/dev/null && kill -KILL -"$pid" 2>/dev/null
  done
  if [ "$STARTED_MYSQL" -eq 1 ]; then
    warn "MySQL was started by this script and is left running (stopping it needs sudo)."
  fi
  ok "stopped"
  exit 0
}
trap cleanup INT TERM

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3<&- && return 0 || return 1; }

wait_for_port() {  # port name timeout
  local port="$1" name="$2" timeout="${3:-40}"
  for ((i = 0; i < timeout; i++)); do
    port_busy "$port" && { ok "$name ready on :$port"; return 0; }
    sleep 1
  done
  warn "$name did not come up on :$port — see $LOG_DIR/$name.log"
  return 1
}

start_service() {  # name port command...
  local name="$1" port="$2"; shift 2
  if port_busy "$port"; then
    ok "$name already running on :$port (left alone)"
    return 0
  fi
  # setsid gives each service its own process group so cleanup can take
  # down its children too.
  setsid "$@" > "$LOG_DIR/$name.log" 2>&1 &
  STARTED_PIDS+=("$!")
  wait_for_port "$port" "$name"
}

# ---------------------------------------------------------------------------
say "Database"
# ---------------------------------------------------------------------------

if [ "$WITH_DB" -eq 1 ]; then
  if port_busy 3306; then
    ok "MySQL already running"
  else
    # Ubuntu's package may be either; try both names.
    sudo service mysql start 2>/dev/null || sudo service mariadb start 2>/dev/null || true
    sleep 2
    if port_busy 3306; then
      STARTED_MYSQL=1
      ok "MySQL started"
    else
      warn "MySQL did not start. Continuing without durable state — no charts, no history."
    fi
  fi
else
  warn "skipping MySQL (--no-db)"
fi

# ---------------------------------------------------------------------------
say "Services"
# ---------------------------------------------------------------------------

[ -d "$REPO_ROOT/ai/venv" ] || die "ai/venv missing. Run ./scripts/bootstrap.sh first."

start_service ai 8000 \
  "$REPO_ROOT/ai/venv/bin/uvicorn" main:app --port 8000 --app-dir "$REPO_ROOT/ai"

# The gateway's predev hook rebuilds both adapters, so a stale dist/
# after a merge cannot silently break it.
start_service api 3000 npm --prefix "$REPO_ROOT/api" run dev

FRONTEND_ARGS=(npm --prefix "$REPO_ROOT/frontend" run dev)
if [ "$LAN" -eq 1 ]; then
  # --host makes Vite bind 0.0.0.0 instead of localhost. The API proxy
  # still points at 127.0.0.1:3000, which is correct: the proxy runs on
  # THIS machine, so other devices reach the gateway through it and the
  # gateway itself never needs exposing.
  FRONTEND_ARGS+=(-- --host)
fi
start_service frontend 5173 "${FRONTEND_ARGS[@]}"

# ---------------------------------------------------------------------------
say "Running"
# ---------------------------------------------------------------------------

echo
echo "    Frontend   http://localhost:5173"
if [ "$LAN" -eq 1 ]; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$LAN_IP" ] && echo "    On wifi    http://${LAN_IP}:5173"
fi
echo "    Gateway    http://localhost:3000/api/v1/health"
echo "    AI         http://localhost:8000/health"
echo
echo "    Logs       tail -f $LOG_DIR/{ai,api,frontend}.log"
echo
echo "    Ctrl-C stops everything this script started."
echo

# Wait forever; the trap handles shutdown.
while true; do sleep 3600; done
