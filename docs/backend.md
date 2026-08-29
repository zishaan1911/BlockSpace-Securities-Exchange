# GASX — Backend & Frontend Design

C++ / Python / TypeScript services, frontend, API contract, events and data storage. Back to [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 1. C++ Backend

C++ is responsible for the performance-sensitive core.

```text
engine/
├── orderbook/
├── matching/
├── pricing/
├── risk/
├── portfolio/
├── marketdata/
└── protocol/
```

### 1.1 C++ services

#### Pricing Runtime

Consumes a normalized model response:

```json
{
  "market": "EGSI-1H",
  "expected_value": 441.2,
  "volatility": 69.4,
  "confidence": 0.91,
  "tail_probability": 0.21,
  "model_version": "egsi-v1.3"
}
```

Produces:

```text
fair_price
bid
ask
quote_size
```

#### Risk Engine

Responsibilities:

- position limits
- margin requirements
- leverage checks
- concentration
- max loss
- model-confidence limits
- oracle freshness checks
- hedge ratio
- circuit breakers

---

## 2. Python AI Backend

Recommended stack:

```text
Python 3.x
FastAPI
Pydantic
Pandas / Polars
NumPy
scikit-learn
LightGBM / XGBoost
PyTorch
Hugging Face Transformers
MLflow (optional)
```

Repository:

```text
ai/
├── ingestion/
├── normalization/
├── features/
├── technical/
├── quant/
├── sentiment/
├── regime/
├── models/
├── inference/
├── backtesting/
└── evaluation/
```

The Python service exposes a versioned inference API to the C++ pricing runtime.

---

## 3. TypeScript Backend

TypeScript owns integration-heavy responsibilities.

```text
api/
├── routes/
├── websocket/
├── auth/
├── services/
└── schemas/

blockchain/
├── sui/
├── thetanuts/
└── wormhole/
```

### Responsibilities

- REST gateway.
- WebSocket gateway.
- Sui SDK.
- Wallet transaction creation.
- Thetanuts SDK.
- Thetanuts MCP integration for agent/developer workflows.
- Thetanuts AgentKit integration where autonomous Base execution is enabled.
- Event indexing.
- API schema validation.

---

## 4. Frontend

```text
frontend/
├── components/
├── pages/
├── hooks/
├── services/
├── state/
├── wallet/
└── types/
```

Recommended stack:

```text
React
TypeScript
Vite
Tailwind CSS
TanStack Query
Sui dApp Kit
Lightweight Charts
```

### Main screens

#### Dashboard

```text
EGSI
438.6

AI Fair Value
441.2

Congestion Probability
72%

Block Utilization
91%

Mempool Pressure
78%

AI Confidence
91%
```

#### Trading Terminal

```text
Chart | Order Book | Trade Form | Positions
```

#### AI Intelligence

```text
Network signals
Technical signals
Quant forecast
Sentiment
Thetanuts risk state
AI decision history
```

#### Portfolio

```text
USDC margin
Open positions
Unrealized P&L
Realized P&L
ETH hedge
Residual exposure
```

---

## 5. API Contract

The frontend only communicates through stable domain APIs.

### REST

```text
GET  /api/v1/markets
GET  /api/v1/markets/:market/orderbook
GET  /api/v1/markets/:market/history
GET  /api/v1/markets/:market/forecast
GET  /api/v1/markets/:market/signals

GET  /api/v1/account/:address
GET  /api/v1/positions/:address
GET  /api/v1/orders/:address

POST /api/v1/orders/prepare
POST /api/v1/orders/cancel/prepare

GET  /api/v1/risk/:address
GET  /api/v1/thetanuts/hedges
POST /api/v1/thetanuts/hedges/quote
POST /api/v1/thetanuts/hedges/prepare
```

`prepare` endpoints return transaction payloads; the user's wallet or an explicitly authorized autonomous wallet signs them.

### WebSocket

```text
/ws/markets/:market
/ws/orderbook/:market
/ws/trades/:market
/ws/account/:address
/ws/ai/:market
/ws/risk/:address
```

---

## 6. Event-Driven System

Use NATS for low-friction event transport.

Topics:

```text
market.egsi.updated
market.orderbook.updated
market.trade.executed
market.order.created
market.order.cancelled

risk.position.updated
risk.margin.updated
risk.limit.breached

ai.forecast.updated
ai.decision.created

hedge.requested
thetanuts.quote.received
hedge.executed

settlement.started
settlement.completed
```

PostgreSQL remains the durable application database; NATS is the transport, not the source of truth.

---

## 7. Database

PostgreSQL tables:

```text
users
wallets
markets
orders
trades
positions
margin_accounts
oracle_updates
settlements

eth_blocks
gas_samples
network_activity
sentiment_samples
features

model_versions
model_predictions
ai_decisions

risk_events
hedge_requests
thetanuts_quotes
thetanuts_positions
```

Redis:

```text
live EGSI
orderbook snapshots
hot market data
session / websocket state
rate limits
```
