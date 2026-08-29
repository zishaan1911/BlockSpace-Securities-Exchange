#!/usr/bin/env bash
set -uo pipefail

REPO=$1

echo ""
echo "=== GASX teardown (inside WSL) ==="

if [ -n "$REPO" ] && [ -d "$REPO" ]; then
    echo "Removing project artifacts (node_modules, .venv) ..."
    find "$REPO" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true
    find "$REPO" -name .venv -type d -prune -exec rm -rf {} + 2>/dev/null || true
fi

echo "Dropping the gasx database and role ..."
sudo service postgresql stop 2>/dev/null || true
sudo -u postgres psql -c "DROP DATABASE IF EXISTS gasx;" 2>/dev/null || true
sudo -u postgres psql -c "DROP ROLE IF EXISTS gasx;" 2>/dev/null || true

echo "Removing pnpm ..."
npm uninstall -g pnpm 2>/dev/null || true

echo "Removing Sui CLI ..."
rm -rf "$HOME/.sui"
sed -i '/\.sui\/bin/d' "$HOME/.bashrc" 2>/dev/null || true

echo "Removing uv ..."
rm -rf "$HOME/.local/bin/uv" "$HOME/.local/bin/uvx" "$HOME/.local/share/uv" 2>/dev/null || true

echo "Uninstalling PostgreSQL ..."
sudo apt-get purge -y postgresql postgresql-contrib 2>/dev/null || true

echo "Uninstalling Node.js ..."
sudo apt-get purge -y nodejs 2>/dev/null || true
sudo rm -f /etc/apt/sources.list.d/nodesource.list /etc/apt/keyrings/nodesource.gpg 2>/dev/null || true
sudo apt-get autoremove -y 2>/dev/null || true

echo ""
echo "Done. The Ubuntu distro is intact; Python 3 and base tools (curl, git) are kept because the distro depends on them."
