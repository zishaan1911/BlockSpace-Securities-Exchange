# GASX

AI-native Ethereum Gas Futures Exchange on Sui, hedged with Thetanuts.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full system design, build order,
and rationale.

## Status

Mid-build. Following the phased build order in `ARCHITECTURE.md` (§40):

- [x] Phase 0 — Integration spike
- [x] Phase 1 — Sui market (`contracts/gasx`, 45 Move tests) — **not yet deployed**; the stack runs against a dev market until then (`blockchain/sui/README.md`)
- [x] Phase 2 — Frontend trading terminal (gateway-driven, wallet-connected; dev-market label until deployed)
- [x] Phase 3 — EGSI (AI service computes real EGSI from live Ethereum data)
- [x] Phase 4 — AI + Thetanuts data/RFQ adapters (hedge flow wired to an approve/reject decision)
- [ ] Phase 5 — Autonomous hedge execution (the judged bar: a real options trade on Thetanuts, Base mainnet)
- [ ] Phase 6 — Demo polish

Suites: Move 45 · ai 86 · thetanuts 23 · sui adapter 14 · api 72 ·
frontend 17 — all green (`scripts/test-all.sh`; engine needs cmake).

See `README.md`'s Quick Start to run the whole stack locally.

## Repository layout

```text
contracts/    Move smart contracts (Sui) — market, oracle, margin, order, settlement
blockchain/   Sui adapter (reads + tx-prep, dev-market mode) and Thetanuts adapter (vol signal + RFQ)
engine/       C++ pricing / risk / matching runtime (legacy, out of hackathon scope)
ai/           Python EGSI computation, forecasting, oracle publisher
api/          TypeScript API gateway (Fastify) — market, orders, account, hedge routes + risk policy
frontend/     React + TypeScript trading UI (Vite, Sui dApp Kit)
indexer/      Chain event indexing (empty scaffold)
database/     Schema migrations (empty scaffold)
infra/        Docker, monitoring (empty scaffold)
```

## Contracts

The Move package lives in [`contracts/gasx`](./contracts/gasx). See that
directory's README for build/test instructions.
