# GASX - Ethereum Gas Futures Exchange on Sui

> **AI-native gas futures exchange on Sui, hedged with Thetanuts**

## The Idea

GASX makes Ethereum congestion tradeable. It tracks one index - the **Ethereum Gas Stress Index (EGSI, 0–1000)**, that measures blockspace stress (base fee, block utilization, mempool pressure, etc). AI forecasts EGSI; users trade futures on it with USDC.

---

### Problem Statement

Every single day, thousands of builders, traders, and protocols get **blindsided by gas**. You size a trade, you queue a mint, you schedule a DAO payout; and then the mempool erupts, base fee 10x's in six blocks, and your "$4 transaction" clears at "$60 and my dignity." Ethereum's blockspace is the most valuable real estate in Web3, and it is priced **live, with zero forward guidance, for everyone who touches it.**

It's a **structural, economy-wide volatility tax** on the entire on-chain economy, and until now, nobody has built the instrument to price it, forecast it, or hedge it.

### Market Gap

Every mature market hedges its core input cost. Airlines hedge jet fuel. Farmers hedge wheat. Exporters hedge FX. **On-chain, there is no equivalent for gas** - despite gas being the single most universal, unavoidable, and violently volatile cost of doing business in crypto.

That gap is enormous, and it is sitting in plain sight:

- **DeFi protocols** eat unhedged gas risk on every keeper job, liquidation bot, and rebalance.
- **NFT projects** watch mint margins evaporate the second a drop goes viral and gas spikes with it.
- **DAOs** budget treasury operations in a currency (gas) with no forward curve.
- **Retail traders** - literally anyone who has ever smashed "confirm" during a gas spike - are exposed, unhedged, every single time.

If you have ever watched a gas fee eat your alpha: **you are the market.** GASX exists because that market has never had a product built for it.

### Target Users

- **DeFi-native power users & bots** - keepers, arbitrageurs, liquidators who eat gas cost as a line item and want to hedge it like any other operating expense.
- **NFT & dApp teams** - need predictable unit economics around mint/interaction windows, not a coin flip on network conditions.
- **DAOs & treasuries** - want to budget and hedge blockspace exposure the same disciplined way they'd hedge FX or interest rate risk.
- **Quant / degen traders** - want a clean, liquid, AI-forecasted volatility product that isn't just "another perp on a coin."
- **Anyone who has ever rage-quit a transaction because gas 5x'd mid-confirm.** (Yes, you. We see you.)

### High-Level Architecture

GASX is **AI-native, cross-chain by design, and built for capital efficiency**:

```text
   Ethereum mempool/base fee data
              │
              ▼
   ┌─────────────────────┐
   │   EGSI Engine (AI)   │   Python + C++ · real-time index + forecast
   └─────────┬────────────┘
             │  served live via API gateway
             ▼
   ┌─────────────────────┐        ┌─────────────────────┐
   │   Sui (Move) market  │◄──────►│  Thetanuts (Base)   │
   │  EGSI-1H futures     │        │  ETH options hedge  │
   └─────────────────────┘        └─────────────────────┘
             ▲
             │
     Frontend (React) — trade, chart, hedge, chat with Kora
```

- **Signal layer:** a Python + C++ engine ingests live Ethereum data and computes EGSI in real time, with a State-of-the-art AI forecast on top.
- **Settlement layer:** Sui/Move, chosen specifically because it is **not** the chain whose congestion is being traded - sub-cent fees keep the market itself from distorting the thing it's pricing.
- **Hedge layer:** Thetanuts on Base mainnet - real ETH options, real risk offset, not a synthetic paper hedge.
- **Experience layer:** a full trading terminal plus **Kora**, an AI copilot that explains the platform and reads back live stats on request.

One index. One market. One hedge rail. Engineered to scale horizontally into a whole **family of blockspace derivatives** (see roadmap).

### Business Model

GASX monetizes the exact thing it creates: a liquid market for a previously unpriced risk.

- **Trading fees** - a basis-point take on every winning EGSI-1H contract opened and settled. Classic exchange economics, applied to a brand-new asset class.
- **Protocol-owned hedge spread** - GASX's own book captures the spread between what it collects in premium and what it pays to hedge on Thetanuts, turning risk management into a revenue center instead of a cost center.
- **Premium AI insights** - deeper EGSI forecasting, historical analytics, and Kora-powered "gas advisory" for power users, DAOs, and protocols who want to plan treasury ops around a forward curve, not a guess.
- **B2B/API licensing** - the EGSI feed itself is a product: wallets, dApps, and gas estimators can license the index and forecast to power their own UX, the way market data terminals license price feeds today.
- **Expansion flywheel** - every new blockspace market (BASE-GAS, ARB-GAS, BLOB-GAS) reuses the same engine, the same hedge rail, and the same user base, compounding distribution instead of resetting it.

TL;DR: **first-mover in an entirely uncontested category** - gas derivatives, with a credibly neutral settlement layer, a real hedge rail, and a reliable growth path.

---

**Problem, restated simply.** Gas congestion risk is hard to quantify, and there is no direct price discovery for future blockspace stress. Companies need predictable gas costs.

**Solution, restated simply.** Bet on EGSI. If the bet wins, the payout offsets real gas fees.

## How It Works

1. The user sees the current EGSI and the AI forecast (e.g., EGSI = 450, forecast: 570 in 1 hour) and buys 5 contracts.
2. The order goes to the Sui contract; USDC is locked as a position.
3. The AI Agent keeps computing EGSI. The frontend reads history through the API gateway, which is the only service that touches the database.
4. After 1 hour the contract settles against the final EGSI. The winner collects USDC; the loser's USDC goes to the other side of the bet, another user, or GASX's own account if no one else exists.

**The hedge (why Thetanuts?).** GASX itself controls the settlement price feed, so it is not fully decentralized, but Thetanuts never decides outcomes. It is where GASX buys insurance: when gas spikes, everyone bets the same direction, and GASX's own account ends up holding the losing side. So the AI agent hedges with ETH options on Thetanuts on Base mainnet.

## Why Sui?

1. **Gas futures can't trade on the chain that charges the gas.** On Ethereum/Base, every order pays the very congestion being traded, distorting the market. Sui's sub-cent fees keep it neutral.
2. **Performance fits the product.** ~0.4s finality and parallel execution suit 1-hour futures and a fast-moving settlement price feed.
3. **Move is safer for financial code.** Resources can't be copied or lost by accident, removing whole classes of Solidity bugs.
4. **The thesis generalizes.** A market on a non-EVM chain, hedged on Base, shows blockspace derivatives are chain-agnostic. Next: BASE-GAS, ARB-GAS, BLOB-GAS.

## Run

Host the backend on one machine; anyone on the same network opens it in a
browser. Nothing to install on other machines, and no keys or deployment
required, the Sui adapter runs in dev-market mode (orders disabled,
labeled in the UI) while the AI service computes a **real EGSI from live
Ethereum data**.

On the host machine (Docker Desktop on Windows):

```text
docker compose up --build   # build + start everything
```

Then find the host's LAN IP (Windows: `ipconfig`, e.g. `192.168.1.20`) and
open `http://192.168.1.20/` from any machine on the same network.

The stack is four services: MySQL (schema auto-applied), the AI service,
the API gateway, and an nginx web server that serves the frontend and
proxies `/api` to the gateway.

```text
docker compose down         # stop and remove containers
docker compose down -v      # also wipe the MySQL data volume
```

After you change code, rebuild with the same `docker compose up --build`.
Builds are layer-cached, so you never re-download from scratch:

- **Nothing changed** → `docker compose up -d` reuses the existing images
  (no build, no download).
- **Only code changed** → `docker compose up --build` re-runs only the
  compile/copy steps; base images (`python`, `node`, `mysql`, `nginx`) and
  the `npm ci`/`pip install` layers are reused from cache.
- **A dependency changed** (`package.json`, `package-lock.json`, or
  `ai/requirements.txt`) → only that service's install layer re-runs.

Sui is pinned to **testnet** in `docker-compose.yml` (backend adapters) and
the frontend build (`VITE_SUI_NETWORK=testnet`). The "DEV MARKET" banner you
see is the un-deployed synthetic market (orders disabled), not the network —
the chain is testnet.

If a client can't connect: allow inbound TCP 80 through the
Windows Firewall and turn off the router's "client isolation". If port 80
is taken, change the `web` port in `docker-compose.yml` (e.g. `8080:80`)
and browse `http://<host-ip>:8080/`.

To go live: deploy `contracts/gasx` on Sui and fill in the deployed IDs.
Run every test suite: `./scripts/test-all.sh`.

## The Safety Line

The AI can request actions but never bypass policy: position caps, 1% slippage, 70% min confidence, tiny hedge budget, isolated wallet. Everything state-changing goes:

```text
AI → policy → adapter → transaction
```

## GASX - Trade and hedge Ethereum gas contracts with our Agentic AI, Kora.
