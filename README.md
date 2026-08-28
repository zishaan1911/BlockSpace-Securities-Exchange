# GASX

AI-native Ethereum Gas Futures Exchange on Sui, hedged with Thetanuts.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design, build order,
and rationale.

## Status

Early build. Following the phased build order in `ARCHITECTURE.md` (§40):

- [ ] Phase 0 — Integration spike
- [x] Phase 1 — Sui market (in progress: `contracts/gasx`)
- [ ] Phase 2 — Frontend trading terminal
- [ ] Phase 3 — EGSI
- [ ] Phase 4 — AI
- [ ] Phase 5 — Thetanuts
- [ ] Phase 6 — Autonomous hedge
- [ ] Phase 7 — Demo polish

## Repository layout

```text
contracts/  Move smart contracts (Sui)
engine/     C++ pricing / risk / matching runtime
ai/         Python data ingestion, feature engineering, models
api/        TypeScript API + WebSocket gateway
frontend/   React + TypeScript trading UI
blockchain/ Sui / Thetanuts / Wormhole client adapters
oracle/     EGSI oracle publishers + aggregator
indexer/    Chain event indexing
database/   Schema migrations
infra/      Docker, monitoring
docs/       Supplementary docs
```

## Contracts

The Move package lives in [`contracts/gasx`](./contracts/gasx). See that
directory's README for build/test instructions.
