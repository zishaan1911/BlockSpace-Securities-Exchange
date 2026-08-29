# GASX — Ethereum Gas Futures Exchange on Sui

> **AI-native Ethereum Gas Futures Exchange on Sui, hedged with Thetanuts**
>
> Hackathon architecture: optimize for a credible end-to-end product and **at least one real on-chain trade**, while reusing audited/open-source infrastructure wherever practical.

See [GOALS.md](GOALS.md) for what we are trying to achieve and [ARCHITECTURE.md](ARCHITECTURE.md) for how the system is designed.

---

## What is GASX?

GASX turns Ethereum blockspace demand into a tradable derivative.

The platform creates an **Ethereum Gas Stress Index (EGSI)** from live Ethereum network conditions and uses AI to forecast its future value. Users trade short-dated EGSI futures against each other on **Sui**, posting **USDC collateral**. At expiry, the contract settles according to the final EGSI value, with P&L paid in an ETH-denominated settlement asset.

The system additionally uses **Thetanuts extensively as the external ETH-derivatives intelligence and hedging layer**:

- Thetanuts market data becomes an input to the AI/risk stack.
- Thetanuts MM pricing and order data provide market-implied ETH volatility/skew signals.
- Thetanuts RFQs are used to source executable hedge quotes.
- Thetanuts positions are incorporated into GASX portfolio/risk calculations.
- Thetanuts' AgentKit/action-provider path is used for autonomous hedge execution on Base, under hard safety limits.
- Thetanuts MCP is used as a development/agent interface for discovery, live inspection, quote/RFQ workflows and transaction encoding. The MCP itself is not the production runtime dependency for state-changing execution.

Sui is the source of truth for the GASX market: order placement, collateral locking, positions, trades, oracle snapshots and settlement are on-chain.

---

## Problem

Ethereum gas demand can change very quickly. A user can observe cheap gas at one moment and severe congestion later, but there is no simple, purpose-built market in GASX form for trading that future network congestion.

GASX addresses three related problems:

1. **Congestion risk is hard to quantify**
   Gas price alone is an incomplete measure of future blockspace demand.

2. **There is limited direct price discovery for future Ethereum blockspace stress**
   Traders can speculate on ETH and ETH derivatives, but that is not the same as directly trading expected gas congestion.

3. **DeFi derivatives platforms need better cross-venue risk management**
   Gas exposure can create correlated ETH risk. Thetanuts gives GASX an existing derivatives venue from which to obtain market information and hedge that risk instead of building another options protocol.

---

## Solution

### Product

GASX offers short-dated futures on the **Ethereum Gas Stress Index (EGSI)**.

Example market:

```text
EGSI-1H

Underlying: Ethereum Gas Stress Index
Expiry:     1 hour
Collateral: USDC
Settlement: ETH-denominated P&L

Example:
Current EGSI = 420
Trader buys 5 contracts at 425
Final EGSI = 500

Long P&L = (500 - 425) × contract_multiplier × 5
```

The first hackathon version should launch **one market** well instead of many maturities.

Recommended initial market:

```text
EGSI-1H
```

Later:

```text
EGSI-15M
EGSI-1H
EGSI-4H
EGSI-24H
```

### Why an index instead of raw Gwei?

Raw gas price is noisy and can be distorted by short-lived fee spikes. EGSI combines:

- base fee
- priority fee
- gas used
- block utilization
- transaction throughput
- mempool pressure
- gas momentum
- fee volatility
- DeFi activity
- DEX activity
- liquidation activity
- ETH volatility
- stablecoin activity
- market/social sentiment
- Thetanuts ETH options market signals

The index therefore describes **network stress and future blockspace demand**, not simply today's gas price.

---

## What Is Actually Novel?

The novelty should not be marketed as "AI trading" alone.

The stronger product thesis is:

> **GASX creates a new financial primitive around Ethereum blockspace demand.**

AI turns heterogeneous network and market signals into a forecastable index. Sui provides the native on-chain market and settlement layer. Thetanuts provides an external ETH derivatives market that supplies market-implied information and hedging capability.

This creates a closed loop:

```text
Ethereum activity
      ↓
AI network forecast
      ↓
EGSI
      ↓
Gas futures market on Sui
      ↓
Portfolio risk
      ↓
Thetanuts ETH hedge
      ↓
New market information
      ↓
AI updates forecast
```

---

## Documentation

| Document | Purpose |
|---|---|
| [GOALS.md](GOALS.md) | What we are trying to achieve: goals, non-goals, build order, minimum demo |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design: components, contracts, data flow, risk and security |
