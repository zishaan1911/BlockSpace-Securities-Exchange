# GASX — Dev Environment Setup

Everything here is designed to be **disposable**. Assumes **Windows 10/11 + WSL (Ubuntu distro)** and **VS Code**, both already installed by the user. All tooling runs inside the WSL Ubuntu distro; nothing else is installed on Windows.

---

## 1. Tech Stack

| Component | Stack | Runs in |
|---|---|---|
| Frontend (`frontend/`) | React + TypeScript, Vite, Sui dApp Kit (`@mysten/dapp-kit-react`), Vitest | WSL |
| API gateway (`api/`) | TypeScript, Fastify, Vitest; links `blockchain/sui` + `blockchain/thetanuts` as local packages | WSL |
| Chain adapters (`blockchain/sui`, `blockchain/thetanuts`) | TypeScript, `@mysten/sui`, Thetanuts client, ethers | WSL |
| AI / data (`ai/`) | **Python 3.12** (requirements.txt requires ≥3.12), FastAPI, Pydantic, NumPy, scikit-learn, LightGBM | WSL |
| Smart contracts (`contracts/gasx`) | Move (Sui CLI + `sui move`) | WSL |
| Database (`database/`) | MySQL 8 / MariaDB (native in WSL) — optional; the gateway runs without it | WSL |
| Engine (`engine/`, legacy) | C++17 + CMake — out of hackathon scope (ARCHITECTURE.md §13) | WSL |
| Editor | VS Code + WSL extension | Windows |
| Package managers | npm (Node), uv (Python) | WSL |
| Blockchains | Sui testnet RPC + Base mainnet RPC | network |
| Wallets | Sui Wallet extension (testnet) + one throwaway EVM wallet for the Base mainnet hedge | Any browser |

## 1b. What each directory needs

| Directory | Depends on |
|---|---|
| `ai/` | Python 3.12 venv (`requirements.txt`), **`libgomp1`** (LightGBM import), Ethereum RPC (public default works), Sui keys only for oracle publishing |
| `api/` | Node 20 + npm; built `dist/` of `blockchain/sui` + `blockchain/thetanuts`; a running AI service for `/market` |
| `frontend/` | Node 20 + npm; a running API gateway (proxied at `/api`) |
| `blockchain/sui` | Node 20 + npm; Sui testnet RPC (reads); deployed IDs for real mode, empty IDs = dev-market mode |
| `blockchain/thetanuts` | Node 20 + npm; Base mainnet RPC (public default works); hedge wallet key only for RFQ writes |
| `contracts/gasx` | Sui CLI; testnet address with gas (`sui client faucet` → web UI) |
| `engine/` | CMake + C++17 compiler (legacy, optional) |

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
- Still works: `code .` (VS Code's WSL extension installs its own `code` shim inside WSL), all files under `/mnt/c/...` (a mount, not PATH), and everything installed inside WSL (git, Node, Python, MySQL, Sui).

For this project the trade is a clear win: a Windows toolchain can never accidentally shadow the WSL one.

**Install dependencies (run inside your WSL Ubuntu terminal):**

Open WSL first: `wsl -d Ubuntu` from PowerShell, or launch the "Ubuntu" app.

```bash
# 1. Base tools and MySQL
# libgomp1 is the OpenMP runtime LightGBM needs at import time.
sudo apt update
sudo apt install -y curl git ca-certificates gnupg build-essential unzip libgomp1 \
  python3 python3-pip python3-venv mysql-server

# 2. Database setup
# Ubuntu's `mysql-server` package may install MariaDB; both work, and the
# schema is written to be compatible with either (see database/README.md).
sudo service mysql start 2>/dev/null || sudo service mariadb start
sudo mysql -e "CREATE DATABASE IF NOT EXISTS gasx;
               CREATE USER IF NOT EXISTS 'gasx'@'localhost' IDENTIFIED BY 'gasx';
               GRANT ALL ON gasx.* TO 'gasx'@'localhost';"
mysql -u gasx -pgasx gasx < database/migrations/001_initial_schema.sql

# 3. Node.js 20 LTS and npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 4. uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# 5. Sui CLI
# For easiest installation, use Homebrew if installed: brew install sui
# Otherwise, download the pre-built Ubuntu binary from the official releases:
# https://github.com/MystenLabs/sui/releases
# Extract it and place the `sui` binary in ~/.local/bin/

# 6. (Optional, legacy engine only) CMake + C++ compiler
sudo apt install -y cmake g++
```

Verify everything installed:

```bash
node -v        # v20.x
npm -v         # npm version
uv --version   # uv version
mysql --version # MySQL 8 or MariaDB 10.11+
sui --version  # Sui CLI version
```

Manual steps after installation:

1. Install the VS Code WSL extension: `code --install-extension ms-vscode-remote.remote-wsl`
2. Reopen your WSL terminal, then work from inside WSL: `wsl -d Ubuntu` → `cd <repo>` → `code .`
   (Repo extensions are recommended automatically via `.vscode/extensions.json`.)
3. Start the database: `sudo service mysql start` (or `mariadb`). MySQL on `localhost:3306`, user/pass/db = `gasx`. Optional — the gateway runs without it, just with no durable state; set `GASX_API_DATABASE_URL=mysql://gasx:gasx@localhost:3306/gasx` in `api/.env` to enable it.
   Note: WSL2 doesn't auto-start services — run this once after each WSL boot, e.g. add `sudo service mysql start` to your `~/.bashrc`.
4. Configure Sui testnet:
   ```bash
   sui client new-env --alias testnet --rpc https://fullnode.testnet.sui.io:443
   sui client switch --env testnet
   sui client new-address ed25519
   ```
   Fund the address with the Sui testnet faucet — the CLI faucet now redirects to the
   web UI: https://faucet.sui.io (paste your address).
5. Install browser wallets on Windows: **Sui Wallet** (switch to testnet) and a **throwaway EVM wallet** (Rabby/MetaMask) funded with a tiny amount of ETH + USDC on Base mainnet — this wallet is the only real-money account in the project.
6. Copy each `.env.example` to `.env` (all gitignored, never commit real keys):
   - `ai/.env` — Ethereum RPC (public default works); Sui publisher key only for oracle publishing
   - `api/.env` — gateway port, AI service URL, risk policy constants
   - `blockchain/sui/.env` — Sui RPC; leave IDs empty for dev-market mode, fill after deploying
   - `blockchain/thetanuts/.env` — Base RPC (public default works); hedge wallet key only for RFQ writes

---

## 3. Destroy

To clean up the environment, run these commands inside WSL:

```bash
# 1. Stop and remove MySQL
sudo service mysql stop 2>/dev/null || sudo service mariadb stop
sudo mysql -e "DROP DATABASE IF EXISTS gasx; DROP USER IF EXISTS 'gasx'@'localhost';" 2>/dev/null
sudo apt purge -y mysql-server mariadb-server

# 2. Remove Node.js
sudo apt purge -y nodejs
sudo rm -f /etc/apt/sources.list.d/nodesource.list

# 3. Remove uv
rm -rf ~/.local/bin/uv ~/.local/bin/uvx ~/.local/share/uv

# 4. Clean up project artifacts
find . -name "node_modules" -type d -exec rm -rf {} +
find . -name ".venv" -type d -exec rm -rf {} +
find . -name "venv" -type d -exec rm -rf {} +
find . -name "dist" -type d -exec rm -rf {} +
```

---

## 4. Useful Commands

```bash
# WSL / VS Code
wsl -d Ubuntu                        # open the Ubuntu distro
wsl --shutdown                       # restart WSL (from PowerShell)
code .                               # open the repo in VS Code (run inside WSL)

# Database (not yet used by the running stack)
sudo service mysql start             # start MySQL (after each WSL boot; optional)
mysql -u gasx -pgasx gasx            # connect to the database

# Python (AI service — Python 3.12 venv; uv picks 3.12 explicitly)
cd ai
uv venv venv --python 3.12           # create the venv (or: python3.12 -m venv venv)
uv pip install --python venv/bin/python -r requirements.txt
venv/bin/uvicorn main:app --port 8000
venv/bin/pytest                      # AI tests (86)

# Node stacks (frontend, api, blockchain/*) — npm, not pnpm
cd <dir> && npm install && npm test && npm run typecheck

# Build the two adapter packages the API gateway links against
cd blockchain/sui && npm run build
cd blockchain/thetanuts && npm run build

# Run the gateway (needs the AI service up for /api/v1/market)
cd api && npm run dev

# Run the frontend (proxies /api to :3000)
cd frontend && npm run dev

# Everything, in order: see README.md's Quick Start

# All test suites at once
./scripts/test-all.sh

# Sui / Move
sui client envs                      # list network configs
sui client switch --env testnet      # switch to Sui testnet
sui client new-address ed25519       # create a new address
sui move build                       # compile the Move contracts
sui move test                        # run Move unit tests
```
