# GASX — Ethereum Gas Futures Exchange on Sui

> **AI-native Ethereum Gas Futures Exchange on Sui, hedged with Thetanuts**
>
> Built for **MUBA HACKS 2026 — Thetanuts Track 02 (AI × OPTIONS)**. The bar: an AI agent places **at least one real on-chain options trade on Thetanuts (OptionBook / OptionFactory), live on Base mainnet** — not paper trading, not testnet. Frontend is a web app; GASX trading lives on Sui.

## Reading Order

1. **[README.md](README.md)** — you are here: the idea, the pitch, the two chains
2. **[GLOSSARY.md](GLOSSARY.md)** — plain-English definitions of every web3/finance term used here
3. **[GOALS.md](GOALS.md)** — what the demo must do, and the build order
4. **[ARCHITECTURE.md](ARCHITECTURE.md)** — how to build each piece, for developers
5. **[setup.md](setup.md)** — dev environment: tech stack, one-command setup, one-command teardown

---

## The Idea

GASX makes Ethereum network congestion tradeable.

It builds an index — the **Ethereum Gas Stress Index (EGSI, 0–1000)** — that measures how stressed Ethereum blockspace is (base fee, block utilization, mempool pressure, DeFi activity...), uses AI to forecast it, and lets users trade short-dated futures on that index with USDC.

---

## The Two Chains

- **Sui (Move contracts)** — where the GASX futures market lives: order book, margin, positions, settlement. Cheap, fast, and the product differentiator.
- **Base / Thetanuts** — the ETH options venue. It does two jobs: (1) its options data (IV, skew, MM pricing) feeds the AI forecast, and (2) it's where the AI agent hedges.

---

## Why Thetanuts Matters Here

Trading gas futures creates ETH-correlated risk (gas spikes when ETH volatility spikes). GASX doesn't build its own options exchange — it uses Thetanuts to hedge.

That also happens to be exactly what the MUBA track demands: an AI agent that places at least one real options trade on Thetanuts' OptionBook/OptionFactory, live on Base mainnet. Our pitch: **"an autonomous hedging agent for a gas-futures exchange"** — track idea #3.

---

## The Whole Thing in Plain English

**Problem.** ETH gas fees (transaction fee) are affected by many factors such as congestion etc. Predictable gas fees are a crucial need, at least for companies — they want to make sure the gas price is always lower than what they bet for.

**Solution.** GASX, a platform that tracks EGSI and provides the option to trade futures on EGSI. If a user makes money from this EGSI, it could be used to compensate the recurring gas fees.

**GASX workflow.** GASX is 450; the user bets it will be 570 after 1 hour since GASX's AI analysis suggested this, and places a 5-contract order. It is sent to the deployed Sui smart contract, and his USDC is locked (a position is created). The AI meanwhile keeps running on our own server (NOT inside the Sui blockchain) to calculate EGSI, publishes the latest EGSI onto Sui (oracle), and also stores it in PGSQL to be displayed at the frontend. After 1 hour, the contract settles and reads the final EGSI. If the user's bet was correct, he receives USDC per the contract; else he loses the USDC used to bet — because the USDC he lost goes to whoever took the opposite side of his bet: another user who bet the price will be lower, OR the exchange itself (GASX's own account) when no opposing user exists. This is the main workflow.

**Hidden workflow: Thetanuts.** GASX is not fully decentralized because the final EGSI outcome is decided by our own oracle (our AI publishing the number onto Sui) — not because of Thetanuts. Thetanuts never decides any outcome; it is purely where GASX buys its insurance. The reason: for these futures to run (assuming a large user base), an equilibrium state may never be reached — everyone bets the same direction when gas spikes, so GASX's own account ends up on the losing side. Note that nobody can fail to pay, because USDC is locked on-chain upfront — the risk is not people not paying, it is GASX holding the losing side. Hence GASX hedges on ETH options on Thetanuts on Base mainnet to make sure it will not bear most of the loss, and can even profit over time.

---

## Problem

1. Gas congestion risk is hard to quantify — gas price alone is a poor measure of future blockspace demand.
2. There is no direct price discovery for future Ethereum blockspace stress.
3. Gas exposure creates correlated ETH risk; a venue like Thetanuts lets us hedge it instead of building another options protocol.

---

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

---

## Why Sui?

Sui hosts the GASX futures market; Base (Thetanuts) hosts the hedge. Why not build everything on one EVM chain?

1. **You can't trade gas futures on the chain that charges the gas.** Building the market on Ethereum/Base would be self-referential: every order pays gas, and the congestion being traded would distort the market itself. Sui's sub-cent, predictable fees keep the market neutral.
2. **Performance matches the product.** Order books need speed: Sui offers ~0.4s finality and parallel execution for high throughput — right for 1-hour futures and frequent oracle updates.
3. **Move is safer for financial code.** Its resource model makes assets impossible to copy or lose by accident, removing whole classes of Solidity bugs.
4. **It proves the thesis generalizes.** Demonstrating the market on a non-EVM chain while hedging on Base shows blockspace derivatives are ecosystem-agnostic — future markets: BASE-GAS, ARB-GAS, BLOB-GAS.
5. **Risk isolation.** The judged deliverable (a real Thetanuts options trade on Base mainnet) does not depend on Sui. If Sui breaks, the autonomous agent still meets the bar.

---

## The Moving Parts (5 Components)

1. **Frontend** — React web app: EGSI dashboard, order form, positions, hedge view
2. **API** — TypeScript gateway: REST/WS, prepares Sui transactions, runs the Thetanuts adapter
3. **AI service** — Python: ingests Ethereum data → computes EGSI → LightGBM forecast → publishes oracle updates to Sui
4. **Sui contracts** — Move: market, order, margin, position, oracle, settlement, events (linear payoff in USDC)
5. **Thetanuts adapter** — pulls MM pricing/RFQ quotes, executes trades via the autonomous wallet

```text
README.md / GOALS.md / ARCHITECTURE.md / GLOSSARY.md / setup.md
frontend/     React web app (Sui dApp Kit)
api/          TypeScript: REST/WS gateway, Sui + Thetanuts adapters
ai/           Python: ingestion, EGSI, forecast model, inference
contracts/    Move packages (market, order, margin, position, oracle, settlement, events)
database/     PostgreSQL
scripts/      setup.ps1 / setup.sh / teardown.ps1 / teardown.sh
```

---

## The Demo Story (One Narrative)

1. User connects Sui wallet, sees EGSI = 418 and AI forecast (EGSI → 487, 72% chance of >500)
2. User buys 5 EGSI-1H contracts — **real on-chain trade on Sui**
3. Risk engine notices the position added ETH-correlated exposure
4. Agent pulls Thetanuts option pricing, proposes a hedge
5. Hard-coded limits approve it; autonomous wallet executes — **real options trade on Thetanuts, Base mainnet** ← the judged bar
6. UI explains: why we bought, why this hedge, what risk was reduced

---

## The Safety Line

The AI can request actions but never bypass policy: position caps, 1% slippage, 70% min confidence, tiny hedge budget, isolated wallet. Everything state-changing goes:

```text
AI → policy → adapter → transaction
```

That's the whole system — a small product (one market, one model, one hedge path) built specifically so the critical path to that one real Thetanuts trade is as short as possible.
