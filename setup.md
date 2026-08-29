# GASX — Dev Environment Setup

Everything here is designed to be **disposable**: setup with one command, destroy with one command. Assumes **Windows 10/11 + WSL (Ubuntu distro)** and **VS Code**, both already installed by the user. All tooling runs inside the WSL Ubuntu distro; nothing else is installed on Windows.

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

Then run `wsl --shutdown` from PowerShell and reopen WSL. (The setup script also ignores any tool that resolves to `/mnt/c/...` as a safety net.)

**Impact of disabling Windows interop:**

- You can no longer launch Windows programs by name from WSL (`explorer.exe`, `clip.exe`, Windows git/python/node, etc.) — that is exactly the class of bug this prevents.
- Still works: `code .` (VS Code's WSL extension installs its own `code` shim inside WSL), all files under `/mnt/c/...` (a mount, not PATH), and everything installed inside WSL (git, Node, Python, Postgres, Sui).
- `scripts/setup.ps1` / `teardown.ps1` run from Windows PowerShell, so they are unaffected.

For this project the trade is a clear win: a Windows toolchain can never accidentally shadow the WSL one.

Then one command on Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

What it does:

1. Checks that an Ubuntu WSL distro exists (stops with instructions if not).
2. Inside WSL, installs: PostgreSQL, Node 20 LTS, Python 3, `uv`, `pnpm`, and the Sui CLI (latest release). It also creates the `gasx` database and role (user/pass/db = `gasx`).

Manual steps after the script:

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
6. Copy `.env.example` to `.env` and fill RPC endpoints. Never commit real keys.

---

## 3. Destroy

One command on Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/teardown.ps1
```

What it removes:

1. Stops PostgreSQL and drops the `gasx` database + role, then **uninstalls PostgreSQL**.
2. Project artifacts (`node_modules`, `.venv`).
3. **Uninstalls Node.js, pnpm, uv, and the Sui CLI** (inside WSL).

The WSL distro itself is left intact; Python 3 and base tools (curl, git) are kept because the distro depends on them. After teardown, `scripts/setup.ps1` fully rebuilds the environment in one run.

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

# Environment lifecycle (PowerShell on Windows)
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
powershell -ExecutionPolicy Bypass -File scripts/teardown.ps1
```
