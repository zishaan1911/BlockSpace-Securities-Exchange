#!/usr/bin/env bash
#
# GASX bootstrap — installs every dependency and builds the project on a
# fresh Ubuntu 24.04 / WSL2 machine.
#
#   ./scripts/bootstrap.sh              # install everything and build
#   ./scripts/bootstrap.sh --skip-sui   # skip the Sui CLI (large download)
#   ./scripts/bootstrap.sh --no-db      # skip MySQL entirely
#
# Safe to re-run: every step checks before installing.
#
# Nearly every step here exists because it broke on a real machine.
# Notably: WSL's Windows PATH shadowing Node, python3-venv missing from
# the base image, LightGBM needing libgomp1, MySQL's socket permissions,
# and MariaDB being what `mysql-server` actually installs on Ubuntu. The
# comments say which is which so a future reader can tell a real
# constraint from cargo cult.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_SUI=0
WITH_DB=1

for arg in "$@"; do
  case "$arg" in
    --skip-sui) SKIP_SUI=1 ;;
    --no-db)    WITH_DB=0 ;;
    -h|--help)  sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

need_sudo() {
  if ! sudo -n true 2>/dev/null; then
    echo "This script needs sudo for package installation."
    sudo -v || die "sudo is required"
  fi
}

# ---------------------------------------------------------------------------
say "Checking the environment"
# ---------------------------------------------------------------------------

[ -f "$REPO_ROOT/README.md" ] || die "run this from inside the GASX repo"
ok "repo root: $REPO_ROOT"

if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "running under WSL"
  # WSL puts Windows directories on PATH, so `npm` can resolve to
  # Windows' npm.exe. That then runs postinstall scripts through cmd.exe,
  # which cannot handle the \\wsl.localhost\... UNC path and fails with
  # "UNC paths are not supported". This wasted an hour once; check for it
  # up front rather than letting npm install fail confusingly.
  if command -v npm >/dev/null 2>&1 && [[ "$(command -v npm)" == /mnt/c/* ]]; then
    warn "npm resolves to Windows: $(command -v npm)"
    cat <<'EOF'

    Windows executables are shadowing WSL's own. Fix before continuing:

      sudo tee /etc/wsl.conf >/dev/null <<'CONF'
      [interop]
      appendWindowsPath = false
      CONF

    Then from a WINDOWS PowerShell window (not this one):
      wsl --shutdown
    Reopen your WSL terminal and re-run this script.

EOF
    die "Windows PATH is shadowing WSL binaries"
  fi
fi

need_sudo

# ---------------------------------------------------------------------------
say "System packages"
# ---------------------------------------------------------------------------

sudo apt-get update -qq
# libgomp1 is LightGBM's OpenMP runtime. Without it `import lightgbm`
# fails at load with an opaque shared-library error, so it is a hard
# requirement rather than a nicety.
sudo apt-get install -y -qq \
  build-essential cmake git curl ca-certificates jq \
  python3 python3-pip python3-venv \
  libgomp1 libnode-dev
ok "build tools, python3 (+venv), libgomp1, libnode-dev, jq"

# ---------------------------------------------------------------------------
say "Node.js 20"
# ---------------------------------------------------------------------------

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | sed 's/v\([0-9]*\).*/\1/')"
  [ "$NODE_MAJOR" -ge 18 ] && { ok "node $(node --version) already installed"; NODE_OK=1; }
fi
if [ "$NODE_OK" -eq 0 ]; then
  # Ubuntu's packaged nodejs is too old; NodeSource is the supported route.
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs
  ok "installed node $(node --version)"
fi

# ---------------------------------------------------------------------------
if [ "$WITH_DB" -eq 1 ]; then
say "MySQL"
# ---------------------------------------------------------------------------
  if ! command -v mysql >/dev/null 2>&1; then
    sudo apt-get install -y -qq mysql-server
    ok "installed $(mysql --version | awk '{print $1, $3}')"
  else
    ok "$(mysql --version | awk '{print $1, $3}') already installed"
  fi

  # Ubuntu's mysql-server package sometimes provides MariaDB, so the
  # service name differs. Try both rather than guessing.
  sudo service mysql start 2>/dev/null || sudo service mariadb start 2>/dev/null || true
  sleep 2
  if ! sudo mysqladmin ping >/dev/null 2>&1; then
    die "MySQL did not start. Try: sudo service mysql start"
  fi
  ok "server running"

  sudo mysql -e "
    CREATE DATABASE IF NOT EXISTS gasx;
    CREATE DATABASE IF NOT EXISTS gasx_test;
    CREATE USER IF NOT EXISTS 'gasx'@'localhost' IDENTIFIED BY 'gasx';
    CREATE USER IF NOT EXISTS 'gasx'@'127.0.0.1' IDENTIFIED BY 'gasx';
    GRANT ALL ON gasx.*      TO 'gasx'@'localhost';
    GRANT ALL ON gasx.*      TO 'gasx'@'127.0.0.1';
    GRANT ALL ON gasx_test.* TO 'gasx'@'localhost';
    GRANT ALL ON gasx_test.* TO 'gasx'@'127.0.0.1';
    FLUSH PRIVILEGES;"
  ok "databases gasx + gasx_test, user gasx"

  # Connect over TCP, not the unix socket: /run/mysqld is not always
  # readable by an unprivileged user, which surfaces as a confusing
  # "Can't connect ... (13)" permission error.
  for DB in gasx gasx_test; do
    mysql -u gasx -pgasx -h 127.0.0.1 "$DB" < "$REPO_ROOT/database/migrations/001_initial_schema.sql" 2>/dev/null
  done
  ok "schema applied to both databases"
else
  warn "skipping MySQL (--no-db); the gateway runs without it, just without durable state"
fi

# ---------------------------------------------------------------------------
if [ "$SKIP_SUI" -eq 0 ]; then
say "Sui CLI"
# ---------------------------------------------------------------------------
  if command -v sui >/dev/null 2>&1; then
    ok "already installed: $(sui --version 2>/dev/null || echo present)"
  else
    warn "not installed. It is only needed to build and test the Move contracts."
    cat <<'EOF'

    Install from a release binary (the repo does not vendor it):

      https://github.com/MystenLabs/sui/releases

    Download the ubuntu-x86_64 tarball, then:
      tar -xzf sui-*.tgz
      sudo mv sui /usr/local/bin/
      rm -f sui-* move-analyzer sui-bridge* sui-debug sui-faucet sui-fork sui-node sui-tool

    That last line matters: the tarball unpacks several binaries beside
    `sui`, and leaving them in the repo directory pollutes git status.

EOF
  fi
fi

# ---------------------------------------------------------------------------
say "Python: ai/"
# ---------------------------------------------------------------------------

cd "$REPO_ROOT/ai"
[ -d venv ] || python3 -m venv venv
venv/bin/pip install -q --upgrade pip
venv/bin/pip install -q -r requirements.txt
ok "virtualenv ready ($(venv/bin/python --version))"

[ -f .env ] || { cp .env.example .env; ok "created ai/.env from the example"; }

# ---------------------------------------------------------------------------
say "TypeScript packages"
# ---------------------------------------------------------------------------

# Order matters: api/ depends on both adapters as local file: packages
# and needs their compiled dist/ to exist before it can typecheck.
# The C++ engine's N-API addon. api/ depends on it as a local package,
# so it has to compile before api/ installs.
cd "$REPO_ROOT/engine/binding"
npm install --silent
ok "engine/binding (C++ N-API addon) built"

for PKG in blockchain/thetanuts blockchain/sui; do
  cd "$REPO_ROOT/$PKG"
  npm install --silent
  npm run build --silent
  [ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
  ok "$PKG installed and built"
done

for PKG in api frontend; do
  cd "$REPO_ROOT/$PKG"
  npm install --silent
  [ -f .env ] || { [ -f .env.example ] && cp .env.example .env; }
  ok "$PKG installed"
done

if [ "$WITH_DB" -eq 1 ]; then
  # Point the gateway at the database created above, if not already set.
  cd "$REPO_ROOT/api"
  if ! grep -q '^GASX_API_DATABASE_URL=' .env 2>/dev/null; then
    echo 'GASX_API_DATABASE_URL=mysql://gasx:gasx@127.0.0.1:3306/gasx' >> .env
    ok "api/.env points at the local database"
  fi
fi

# ---------------------------------------------------------------------------
say "Done"
# ---------------------------------------------------------------------------

cat <<EOF

Verify everything:

    ./scripts/test-all.sh

Bring up the stack (three terminals):

    cd ai       && venv/bin/uvicorn main:app --port 8000
    cd api      && npm run dev
    cd frontend && npm run dev            # http://localhost:5173

To bring over collected EGSI history from another machine:

    # on the old machine
    ./scripts/db-export.sh
    # copy the .sql.gz across, then here
    ./scripts/db-import.sh gasx-export-YYYY-MM-DD.sql.gz

To deploy the contracts and leave dev-market mode:

    ./scripts/deploy-sui.sh --dry-run    # see what it would do
    ./scripts/deploy-sui.sh

Note: the contracts are not deployed, so the Sui adapter serves a
synthetic dev market. Reads work; orders cannot be prepared. See
blockchain/sui/README.md.

EOF
