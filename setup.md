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
