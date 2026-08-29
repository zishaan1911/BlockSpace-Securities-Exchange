#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "=== GASX tool installer (inside WSL) ==="

sudo apt-get update -y
sudo apt-get install -y curl git ca-certificates gnupg python3

if ! command -v psql >/dev/null 2>&1; then
    echo "Installing PostgreSQL ..."
    sudo apt-get install -y postgresql postgresql-contrib
fi

echo "Starting PostgreSQL ..."
sudo service postgresql start || true

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='gasx'" | grep -q 1; then
    sudo -u postgres psql -c "CREATE ROLE gasx LOGIN PASSWORD 'gasx';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='gasx'" | grep -q 1; then
    sudo -u postgres createdb -O gasx gasx
fi

if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js 20 LTS ..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv ..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v pnpm >/dev/null 2>&1; then
    echo "Installing pnpm ..."
    npm install -g pnpm
fi

if ! command -v sui >/dev/null 2>&1; then
    echo "Installing Sui CLI (latest release) ..."
    URL=$(python3 - <<'EOF'
import json, urllib.request
r = json.load(urllib.request.urlopen("https://api.github.com/repos/MystenLabs/sui/releases/latest"))
assets = [a["browser_download_url"] for a in r["assets"]
          if "linux-x86_64" in a["name"] and a["name"].endswith(".tgz")]
url = next((u for u in assets if "testnet" in u), assets[0] if assets else "")
print(url)
EOF
)
    if [ -z "$URL" ]; then
        echo "ERROR: could not find a Sui release asset" >&2
        exit 1
    fi
    mkdir -p "$HOME/.sui/bin"
    curl -L "$URL" -o /tmp/sui.tgz
    tar -xzf /tmp/sui.tgz -C "$HOME/.sui"
    find "$HOME/.sui" -name sui -type f -exec mv {} "$HOME/.sui/bin/" \;
    rm -f /tmp/sui.tgz
    grep -q '.sui/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.sui/bin:$PATH"' >> "$HOME/.bashrc"
fi

echo ""
echo "Installed versions:"
psql --version
node --version
python3 --version
uv --version 2>/dev/null || echo "uv: reopen your shell or run 'export PATH=\"\$HOME/.local/bin:\$PATH\"'"
pnpm --version 2>/dev/null || echo "pnpm: reopen your shell"
echo "sui: $("$HOME/.sui/bin/sui" --version 2>/dev/null || echo 'reopen your shell')"
echo ""
echo "Done. Close and reopen your WSL terminal so PATH changes apply."
