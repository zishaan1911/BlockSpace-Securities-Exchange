# GASX — Operations

Cross-chain strategy, deployment, observability, testing and repository layout. Back to [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## 1. Cross-Chain Strategy

The GASX core should **not** require cross-chain messaging for every trade.

```text
Sui
 |
 +-- GASX trades
 +-- USDC margin
 +-- futures positions
 +-- GASX settlement

Base
 |
 +-- Thetanuts hedge
```

Cross-chain components such as Wormhole should only be introduced for:

- moving hedge collateral
- moving supported assets
- synchronizing limited hedge-state messages
- future automated treasury rebalancing

Wormhole's current support matrix includes Sui and Base for several messaging/token-transfer products, so it is a viable candidate when cross-chain functionality becomes necessary. [Wormhole support matrix](https://wormhole.com/docs/products/connect/reference/support-matrix/)

For the first successful trade, keep the Sui trading path independent of the bridge.

---

## 2. Deployment

Hackathon deployment:

```text
                    Cloud / VPS
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
  Frontend           Backend             AI
  Vite/Static        Docker              Docker
       |                 |                  |
       |          +------+-------+          |
       |          |      |       |          |
       |          v      v       v          |
       |       API    C++ Core  Indexer     |
       |                 |                  |
       +-----------------+------------------+
                         |
                 PostgreSQL + Redis
                         |
                       NATS
```

Use Docker Compose initially.

Do not introduce Kubernetes unless the hackathon infrastructure specifically requires it.

---

## 3. Observability

Use open-source monitoring.

### Metrics

```text
Prometheus
Grafana
```

Track:

```text
egsi_current
ai_forecast_error
model_confidence
order_latency
trade_count
trade_volume
oracle_age
risk_rejections
thetanuts_quote_latency
hedge_success_rate
sui_transaction_success_rate
```

### Logs

Structured JSON logs with:

```text
request_id
wallet_address_hash
market_id
order_id
trade_id
model_version
oracle_version
transaction_digest
```

Never log private keys or wallet secrets.

---

## 4. Testing Strategy

### Move

- Unit tests.
- Position/margin invariants.
- Settlement edge cases.
- Oracle freshness tests.
- Overflow/underflow tests.
- Authorization tests.

### C++

- Matching engine tests.
- Price-time priority tests.
- Risk limit tests.
- Fixed-point arithmetic tests.

### Python

- Feature tests.
- Leakage checks.
- Backtests.
- Model regression tests.
- Forecast calibration.

### TypeScript

- API schema tests.
- Sui transaction construction tests.
- Thetanuts adapter tests.
- Wallet flow tests.

### Integration

One golden-path test:

```text
wallet
 -> deposit
 -> place order
 -> match
 -> position
 -> settlement
 -> hedge request
```

---

## 5. Recommended Repository Structure

```text
gasx/
├── ARCHITECTURE.md
├── README.md
├── GOALS.md
├── docker-compose.yml
├── .env.example
│
├── frontend/
│   ├── src/
│   └── package.json
│
├── api/
│   ├── src/
│   └── package.json
│
├── engine/
│   ├── include/
│   ├── src/
│   └── tests/
│
├── ai/
│   ├── ingestion/
│   ├── features/
│   ├── models/
│   ├── inference/
│   └── tests/
│
├── blockchain/
│   ├── sui/
│   ├── thetanuts/
│   └── wormhole/
│
├── contracts/
│   └── gasx/
│
├── oracle/
│   ├── publishers/
│   └── aggregator/
│
├── indexer/
│
├── database/
│   └── migrations/
│
├── infra/
│   ├── docker/
│   └── monitoring/
│
└── docs/
    ├── protocol.md
    ├── ai.md
    ├── thetanuts.md
    ├── backend.md
    ├── risk.md
    └── operations.md
```
