# GASX — Goals (Hackathon)

> Read first: [README.md](README.md) (the idea) and [GLOSSARY.md](GLOSSARY.md) (the terms). Then read this file for what to build; then [ARCHITECTURE.md](ARCHITECTURE.md) for how each piece works.

## Success Criteria

The demo must:

1. Connect a Sui-compatible wallet.
2. Show live Ethereum gas conditions and a live EGSI value.
3. Show an AI forecast with a confidence score.
4. Submit and execute a **real order on Sui**, and show the resulting position.
5. Query Thetanuts for ETH hedge opportunities via live market data / MM pricing.
6. **THE BAR**: the AI agent places at least one real on-chain options trade on Thetanuts' OptionBook or OptionFactory, live on Base mainnet, against live pricing. Testnet or paper trades do not count.

> Scope note: **only the Thetanuts options trade must be on mainnet.** The GASX futures trade on Sui may run on testnet.

## Engineering Principles

- Fully on-chain trading and settlement on Sui (Move).
- Web frontend, fully abstracted from backend implementation details.
- TypeScript for API, Sui integration and Thetanuts integration; Python for the AI/data stack.
- Reuse audited/open-source components wherever practical.
- Hard risk controls that the AI cannot bypass.

## Non-Goals (This Hackathon)

- No new blockchain, no generic oracle network, no cross-chain settlement protocol.
- No C++ engine, no NATS/event bus, no Kubernetes.
- No DeepBook CLOB integration, no multiple maturities, no production custody.
- No ETH-denominated settlement (USDC P&L is enough for the demo).
- No reimplementing Thetanuts' options protocol.

## Build Order

- **Phase 0 — Integration spike:** publish a tiny Move package on Sui testnet; connect a wallet; move USDC; run Thetanuts MCP; verify Thetanuts SDK read flows **and OptionBook/OptionFactory trade execution on Base mainnet with a tiny budget** (highest-risk item — validate first).
- **Phase 1 — Sui market:** Market/Order/Margin/Position/Settlement contracts; one manual on-chain trade.
- **Phase 2 — Frontend:** wallet, market screen, order book, buy/sell form, positions.
- **Phase 3 — EGSI + AI:** index from base fee + utilization + fee momentum + gas volatility; LightGBM forecast with confidence.
- **Phase 4 — Thetanuts:** market data + MM pricing into the AI; add Thetanuts IV/skew to EGSI; RFQ hedge workflow.
- **Phase 5 — Autonomous hedge:** the AI agent executes a real Thetanuts options trade on Base mainnet behind a tiny hard-coded budget. `POST /api/v1/hedge/execute` (api/src/routes/hedge.ts) implements this -- re-runs the full evaluation chain fresh, settles via Thetanuts' settleQuotationEarly only if that fresh run approves, gated behind an explicit `confirm: true`. NOT yet exercised against a live network; see that route's module comment and rfqHedge.ts's executeHedge for what remains unverified.

## Demo Script

```text
1. EGSI = 418, market opens
2. AI detects congestion: utilization ↑, base fee ↑, mempool ↑
   Forecast: EGSI → 487, P(EGSI > 500) = 72%
3. Trader buys 5 EGSI-1H contracts; Sui transaction digest shown in UI
4. Risk engine flags increased ETH-correlated exposure
5. GASX requests Thetanuts MM pricing + hedge RFQ
6. Hard risk rules approve a hedge; the AI agent executes a real options trade via Thetanuts OptionBook on Base mainnet within limits
7. UI explains: why we bought, why this hedge, what risk was reduced
```
