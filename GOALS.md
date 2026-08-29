# GASX — Goals

What we are trying to achieve. For what GASX is, see [README.md](README.md). For how it is designed, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Hackathon Goals

The demo must be able to:

1. Connect a Sui-compatible wallet.
2. Display live Ethereum gas conditions.
3. Produce a live EGSI value.
4. Produce an AI forecast and confidence score.
5. Display an on-chain order book.
6. Submit a real order.
7. Match/execute a real trade on Sui.
8. Show the resulting position.
9. Calculate portfolio exposure.
10. Query Thetanuts for an ETH hedge opportunity.
11. Execute or demonstrate a real Thetanuts hedge path under strict limits.

## 2. Engineering Goals

- Fully on-chain GASX trading and settlement.
- Frontend completely abstracted from implementation details.
- C++ for latency-sensitive trading/risk/pricing runtime.
- Python for data science, model training and inference services.
- TypeScript for APIs, Sui client integration, wallet integration and Thetanuts integration.
- Move for Sui smart contracts.
- Open-source modules wherever they reduce implementation risk.
- Hard risk controls independent of AI decisions.

## 3. Explicit Non-Goals for the Hackathon

- Building a new blockchain.
- Building a generic oracle network from scratch.
- Building a full cross-chain settlement protocol.
- Supporting dozens of contract maturities.
- Building a production-grade custody system.
- Building an HFT-grade distributed matching cluster.
- Reimplementing Thetanuts' options protocol.

---

## 4. Recommended Build Order

The project should be built in this order to maximize the probability of a real trade.

### Phase 0 — Integration spike

Before building anything elaborate:

1. Publish a tiny Move package on Sui testnet.
2. Connect a Sui wallet.
3. Execute a basic USDC transaction.
4. Clone/build DeepBook V3 locally and verify the SDK/contract workflow.
5. Run Thetanuts MCP and inspect live tool responses.
6. Install the official Thetanuts client SDK.
7. Verify Thetanuts market data and a read-only ETH pricing flow.
8. Verify the Thetanuts AgentKit example in a **strictly limited test environment**.

Do these first because integration surprises are more dangerous than model work.

### Phase 1 — Sui market

Build:

```text
Market
Order
Margin
Position
Trade event
Settlement
```

Get one deterministic manual trade working.

### Phase 2 — Frontend trading terminal

Build:

```text
wallet
market screen
orderbook
buy/sell form
positions
transaction status
```

### Phase 3 — EGSI

Implement the simplest index:

```text
base fee
+ utilization
+ fee momentum
+ volatility
```

Then add more features.

### Phase 4 — AI

Implement:

```text
baseline
-> LightGBM/XGBoost
-> quantile forecast
-> regime classifier
-> sentiment
-> Thetanuts volatility signals
```

### Phase 5 — Thetanuts

Implement:

```text
market data
MM pricing
option-chain analytics
RFQ
hedge selection
position monitoring
```

### Phase 6 — Autonomous hedge

Enable Thetanuts AgentKit execution behind a tiny hard-coded risk budget.

### Phase 7 — Demo polish

Add:

```text
AI terminal
agent activity feed
risk visualization
Thetanuts hedge view
on-chain transaction explorer links
```

---

## 5. Minimum Viable Demo

The absolute minimum successful demo is:

```text
1. Connect Sui wallet
2. Show live Ethereum network data
3. Show EGSI
4. Show AI forecast
5. Deposit USDC
6. Place BUY/SELL order
7. Execute a real Sui transaction
8. Show trade in on-chain state
9. Show position
10. Show Thetanuts-derived hedge analysis
11. Request an actual Thetanuts quote
12. Execute a tightly limited hedge if environment permits
```

The system should still be a valid GASX demo if the optional cross-chain transfer is unavailable.

---

## 6. Hackathon Demo Script

### Step 1 — Market opens

```text
EGSI = 418
```

### Step 2 — AI detects congestion

```text
Block utilization       ↑
Base fee acceleration   ↑
Mempool pressure        ↑
DeFi activity           ↑
Sentiment               ↑

AI forecast:
EGSI → 487
P(EGSI > 500) = 72%
```

### Step 3 — Trader acts

User buys 5 EGSI futures.

### Step 4 — Sui settles the trade

The transaction digest is shown in the UI.

### Step 5 — Risk changes

GASX computes increased ETH-related risk.

### Step 6 — Thetanuts is invoked

The system queries Thetanuts market/MM pricing and requests a hedge quote.

### Step 7 — Autonomous hedge

The AI agent proposes a hedge. Hard risk rules approve it. Thetanuts AgentKit executes within a tiny configured limit.

### Step 8 — Explainability

Show:

```text
Why GASX bought
Why the hedge was selected
What risk was reduced
What the current EGSI forecast is
```

This produces a complete story rather than a collection of disconnected features.

---

## 7. Production Evolution After the Hackathon

If GASX moves beyond the hackathon:

### Phase A

- multiple maturities
- deeper liquidity
- stronger oracle security
- better model calibration
- formal Move verification where justified

### Phase B

- permissionless market creation
- institutional API
- market-maker SDK
- advanced cross-margin
- richer Thetanuts hedge strategies

### Phase C

- multi-chain user access
- automated treasury management
- additional blockspace indices
- Base / Arbitrum / Solana congestion indices
- standardized blockchain congestion derivatives

Potential future products:

```text
ETH-GAS-1H
ETH-GAS-4H
ETH-GAS-24H
L2-GAS-1H
BASE-GAS-1H
ARB-GAS-1H
BLOB-GAS-1H
```
