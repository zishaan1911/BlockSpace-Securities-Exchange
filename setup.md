# GASX — Dev Environment Setup

Everything here is designed to be **disposable**. Assumes **Windows 10/11 + WSL (Ubuntu distro)** and **VS Code**, both already installed by the user. All tooling runs inside the WSL Ubuntu distro; nothing else is installed on Windows.

---

## 1. Tech Stack

| Component | Stack | Runs in |
|---|---|---|
| Frontend | React + TypeScript, Sui dApp Kit, WebSocket client, chart lib | WSL |
| API / integration | TypeScript (Fastify/Express + WS), Sui TS SDK, Thetanuts SDK (+ MCP dev-time, AgentKit autonomous), ethers/viem | WSL |
| AI / data | Python 3.11+, FastAPI, Pydantic, Pandas/Polars, NumPy, scikit-learn, LightGBM | WSL |
| Smart contracts | Move (Sui CLI + `sui move`) | WSL |
| Database | PostgreSQL 16 (native in WSL) | WSL |
| Editor | VS Code + WSL extension | Windows |
| Package managers | pnpm (Node), uv (Python) | WSL |
| Blockchains | Sui testnet RPC + Base mainnet RPC | network |
| Wallets | Sui Wallet extension (testnet) + one throwaway EVM wallet for the Base mainnet hedge | Any browser |

---

## 2. Prepare

**Prerequisites (install these yourself first):** WSL with an Ubuntu distro (`wsl --install -d Ubuntu`) and VS Code.

**Important WSL configuration:** by default WSL puts Windows executables on the PATH, so `node`/`pnpm` inside WSL can accidentally resolve to a Windows install. In WSL, create `/etc/wsl.conf` with:

```ini
[interop]
appendWindowsPath = false
```

Then run `wsl --shutdown` from PowerShell and reopen WSL.

**Impact of disabling Windows interop:**

- You can no longer launch Windows programs by name from WSL (`explorer.exe`, `clip.exe`, Windows git/python/node, etc.) — that is exactly the class of bug this prevents.
- Still works: `code .` (VS Code's WSL extension installs its own `code` shim inside WSL), all files under `/mnt/c/...` (a mount, not PATH), and everything installed inside WSL (git, Node, Python, Postgres, Sui).

For this project the trade is a clear win: a Windows toolchain can never accidentally shadow the WSL one.

**Install dependencies (run inside your WSL Ubuntu terminal):**

Open WSL first: `wsl -d Ubuntu` from PowerShell, or launch the "Ubuntu" app.

```bash
# 1. Base tools and PostgreSQL (Requires Ubuntu 24.04 for PG 16 by default)
sudo apt update
sudo apt install -y curl git ca-certificates gnupg build-essential unzip \
  python3 python3-pip python3-venv postgresql postgresql-contrib

# 2. Database setup
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE gasx LOGIN PASSWORD 'gasx';"
sudo -u postgres createdb -O gasx gasx

# 3. Node.js 20 LTS and pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# 4. uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# 5. Sui CLI
# For easiest installation, use Homebrew if installed: brew install sui
# Otherwise, download the pre-built Ubuntu binary from the official releases:
# https://github.com/MystenLabs/sui/releases
# Extract it and place the `sui` binary in ~/.local/bin/
```

Verify everything installed:

```bash
node -v        # v20.x
pnpm -v        # pnpm version
uv --version   # uv version
psql --version # PostgreSQL 16
sui --version  # Sui CLI version
```

Manual steps after installation:

1. Install the VS Code WSL extension: `code --install-extension ms-vscode-remote.remote-wsl`
2. Reopen your WSL terminal, then work from inside WSL: `wsl -d Ubuntu` → `cd <repo>` → `code .`
   (Repo extensions are recommended automatically via `.vscode/extensions.json`.)
3. Start the database: `sudo service postgresql start` (Postgres on `localhost:5432`, user/pass/db = `gasx`).
   Note: WSL2 doesn't auto-start services — run this once after each WSL boot, e.g. add `sudo service postgresql start` to your `~/.bashrc`.
4. Configure Sui testnet:
   ```bash
   sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
   sui client switch --env testnet
   sui client new-address ed25519
   ```
   Fund the address with the Sui testnet faucet (`sui client faucet` or the wallet UI).
5. Install browser wallets on Windows: **Sui Wallet** (switch to testnet) and a **throwaway EVM wallet** (Rabby/MetaMask) funded with a tiny amount of ETH + USDC on Base mainnet — this wallet is the only real-money account in the project.
6. Create a `.env` file (you can use `.env.example` as a template once available) and fill RPC endpoints. Never commit real keys.

---

## 3. Destroy

To clean up the environment, run these commands inside WSL:

```bash
# 1. Stop and remove PostgreSQL
sudo service postgresql stop
sudo -u postgres psql -c "DROP DATABASE IF EXISTS gasx;"
sudo -u postgres psql -c "DROP ROLE IF EXISTS gasx;"
sudo apt purge -y postgresql postgresql-contrib

# 2. Remove Node.js and pnpm
sudo npm uninstall -g pnpm
sudo apt purge -y nodejs
sudo rm -f /etc/apt/sources.list.d/nodesource.list

# 3. Remove uv
rm -rf ~/.local/bin/uv ~/.local/bin/uvx ~/.local/share/uv

# 4. Clean up project artifacts
find . -name "node_modules" -type d -exec rm -rf {} +
find . -name ".venv" -type d -exec rm -rf {} +
```

---

## 4. Useful Commands

```bash
# WSL / VS Code
wsl -d Ubuntu                        # open the Ubuntu distro
wsl --shutdown                       # restart WSL (from PowerShell)
code .                               # open the repo in VS Code (run inside WSL)

# Database
sudo service postgresql start        # start Postgres (after each WSL boot)
psql -h localhost -U gasx -d gasx    # connect to the database (password: gasx)

# Node (frontend / API)
pnpm install                         # install workspace dependencies
pnpm dev                             # run dev servers

# Python (AI service)
uv sync                              # install python deps from the lockfile
uv run <command>                     # run a command in the project venv

# Sui / Move
sui client envs                      # list network configs
sui client switch --env testnet      # switch to Sui testnet
sui client new-address ed25519       # create a new address
sui client faucet                    # get testnet SUI for an address
sui move build                       # compile the Move contracts
sui move test                        # run Move unit tests
```
