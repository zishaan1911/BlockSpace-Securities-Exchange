# GASX — Ethereum Gas Futures Exchange on Sui

> **AI-native gas futures exchange on Sui, hedged with Thetanuts**
>
> Built for **MUBA HACKS 2026 — Thetanuts Track 02**. The bar: an AI agent places **at least one real on-chain options trade on Thetanuts, live on Base mainnet** — not paper trading, not testnet. Frontend is a web app; GASX trading lives on Sui.

## Reading Order

1. **[README.md](README.md)** — you are here: the idea and how it works
2. **[GLOSSARY.md](GLOSSARY.md)** — plain-English definitions of every web3/finance term used here
3. **[GOALS.md](GOALS.md)** — what the demo must do, and the build order
4. **[ARCHITECTURE.md](ARCHITECTURE.md)** — how to build each piece, for developers
5. **[setup.md](setup.md)** — dev environment: what to install in WSL, per stack

---

## The Idea

GASX makes Ethereum congestion tradeable. It tracks one index — the **Ethereum Gas Stress Index (EGSI, 0–1000)** — that measures blockspace stress (base fee, block utilization, mempool pressure). AI forecasts EGSI; users trade 1-hour futures on it with USDC.

**Problem.** Gas congestion risk is hard to quantify, and there is no direct price discovery for future blockspace stress. Companies need predictable gas costs.

**Solution.** Bet on EGSI. If the bet wins, the payout offsets real gas fees.

## How It Works

1. The user sees the current EGSI and the AI forecast (e.g., EGSI = 450, forecast: 570 in 1 hour) and buys 5 contracts.
2. The order goes to the Sui contract; USDC is locked as a position.
3. The AI (on our own server, not on-chain) keeps computing EGSI and publishes it to the Sui oracle. The frontend reads history through the API gateway, which is the only service that touches the database.
4. After 1 hour the contract settles against the final EGSI. The winner collects USDC; the loser's USDC goes to the other side of the bet — another user, or GASX's own account if no one else exists.

**The hedge (why Thetanuts).** The oracle is ours, so GASX is not fully decentralized — but Thetanuts never decides outcomes. It is where GASX buys insurance: when gas spikes, everyone bets the same direction, and GASX's own account ends up holding the losing side. (No one can fail to pay — USDC is locked upfront — so the risk is GASX's book, not bad debts.) So the AI agent hedges with ETH options on Thetanuts on Base mainnet.

Demo flow: trade on Sui → risk engine spots the ETH exposure → agent hedges on Thetanuts → UI explains the hedge. That final trade is the judged bar.

## The Product

```text
EGSI-1H

Underlying:  Ethereum Gas Stress Index (0–1000)
Expiry:      1 hour
Collateral:  USDC
Settlement:  USDC P&L (linear payoff)

Example:
Current EGSI = 420, trader buys 5 contracts at 425
Final EGSI = 500
Long P&L = (500 - 425) × contract_multiplier × 5
```

Hackathon scope: **one market (EGSI-1H)**, done well.

## Why Sui?

1. **Gas futures can't trade on the chain that charges the gas.** On Ethereum/Base, every order pays the very congestion being traded, distorting the market. Sui's sub-cent fees keep it neutral.
2. **Performance fits the product.** ~0.4s finality and parallel execution suit 1-hour futures and frequent oracle updates.
3. **Move is safer for financial code.** Resources can't be copied or lost by accident, removing whole classes of Solidity bugs.
4. **The thesis generalizes.** A market on a non-EVM chain, hedged on Base, shows blockspace derivatives are chain-agnostic. Next: BASE-GAS, ARB-GAS, BLOB-GAS.
5. **Risk isolation.** The judged deliverable does not depend on Sui. If Sui breaks, the agent still meets the bar.

## Components

```text
frontend/     React web app (EGSI dashboard, order form, positions, hedge view)
api/          TypeScript gateway: REST, prepares Sui transactions, Thetanuts adapter
ai/           Python: ingestion → EGSI → forecast → oracle updates to Sui
contracts/    Move: market, order, margin, position, oracle, settlement, events
blockchain/   Sui adapter (reads + tx-prep) and Thetanuts adapter (market data + RFQ)
database/     MySQL schema
scripts/      test-all.sh (every test suite, all stacks)

docs: README.md · GOALS.md · ARCHITECTURE.md · GLOSSARY.md · setup.md
```

## Quick Start — run the whole stack

Three terminals, in this order. Everything runs locally with **no keys and
no deployment**: the Sui adapter serves a synthetic dev market (orders
disabled, labeled in the UI) while the AI service computes a **real EGSI
from live Ethereum data**.

```text
# 1. AI service (Python 3.12 — see setup.md)
cd ai
uv venv venv --python 3.12 && uv pip install --python venv/bin/python -r requirements.txt
cp .env.example .env
venv/bin/uvicorn main:app --port 8000
# first run: seed one EGSI snapshot (otherwise /egsi/current returns 503)
curl -X POST http://localhost:8000/cycle -H 'content-type: application/json' -d '{}'

# 2. API gateway (build the two adapters it links against, once)
cd blockchain/sui && npm install && npm run build && cd ../..
cd blockchain/thetanuts && npm install && npm run build && cd ../..
cd api
npm install
cp .env.example .env
npm run dev                                  # http://localhost:3000

# 3. Frontend (proxies /api to :3000)
cd frontend
npm install
npm run dev                                  # http://localhost:5173
```

Open http://localhost:5173 — live EGSI gauge, forecast, market terms,
and the hedge panel. Sanity-check the raw state with
`curl http://localhost:3000/api/v1/market`.

To go live: deploy `contracts/gasx` on Sui and fill in the deployed IDs
(`blockchain/sui/README.md`), then the same stack reads the real market
and order preparation turns on.

Every test suite, one command: `./scripts/test-all.sh`.

## The Safety Line

The AI can request actions but never bypass policy: position caps, 1% slippage, 70% min confidence, tiny hedge budget, isolated wallet. Everything state-changing goes:

```text
AI → policy → adapter → transaction
```

That's the whole system — deliberately small: one market, one model, one hedge path.
