# GASX API gateway

TypeScript (Fastify) gateway implementing ARCHITECTURE.md §2's API
gateway component and §9's Trade Flow: "Get market state" and "Prepare
order (pre-trade risk checks)" → a Sui transaction payload for the
frontend's wallet to sign. Also implements ARCHITECTURE.md §8's Hard
Risk Policy (enforced here, "outside the language model, in the API/
contracts") and the bridge that keeps EGSI's Thetanuts IV component live
(closing the gap `ai/README.md` and `blockchain/thetanuts/README.md`
both flagged: "that's the API gateway's job once Phase 2 exists").

Depends on `blockchain/sui` (transaction preparation) and
`blockchain/thetanuts` (live ETH vol signal) as local workspace packages,
and talks to `ai/`'s FastAPI service over HTTP.

## Modules

| module | responsibility |
|---|---|
| `config` | environment-driven settings — port, AI service URL, risk policy constants, plus both adapters' own configs |
| `riskPolicy` | ARCHITECTURE.md §8's Hard Risk Policy — `checkOrderRisk` (manual orders), `checkHedgeConfidence` (pre-RFQ gate), `checkHedgeRisk` (full hedge check) |
| `exposure` | ETH-beta exposure — §10's "exposure breached threshold" trigger |
| `aiClient` | thin HTTP client for `ai/main.py` — `GET /egsi/current`, `GET /forecast`, `POST /cycle` |
| `server` | Fastify app factory, dependency-injected (`GatewayDeps`) so tests never touch a live network |
| `routes/market` | `GET /api/v1/market` |
| `routes/orders` | `POST /api/v1/orders/prepare`, `POST /api/v1/orders/prepare-cancel` |
| `routes/account` | `POST /api/v1/account/prepare-open`, `POST /api/v1/account/prepare-deposit` |
| `routes/hedge` | `POST /api/v1/hedge/sync-signal` |

## Endpoints

| method | path | does |
|---|---|---|
| GET | `/api/v1/health` | liveness check |
| GET | `/api/v1/market` | Sui `Market`/`OracleState` + the AI service's current EGSI + forecast, combined |
| POST | `/api/v1/orders/prepare` | risk-checks then prepares a `place_order` transaction |
| POST | `/api/v1/orders/prepare-cancel` | prepares a `cancel_order` transaction (no risk check — the Move contract itself never gates cancellation on market state) |
| POST | `/api/v1/account/prepare-open` | prepares an `open_account` transaction |
| POST | `/api/v1/account/prepare-deposit` | prepares a `deposit` transaction |
| POST | `/api/v1/hedge/sync-signal` | fetches a live Thetanuts ETH `VolSignal` and forwards it into the AI service's `POST /cycle` |
| POST | `/api/v1/hedge/assess` | computes ETH-beta exposure; read-only, no on-chain side effects |
| POST | `/api/v1/hedge/evaluate` | the full §10 chain through to an approve/reject decision — **submits a real RFQ on Base mainnet** |
| POST | `/api/v1/hedge/candidate` | re-polls an existing RFQ for late market-maker offers |

Every `prepare*` endpoint returns `{transactionJson, summary}`
(`blockchain/sui`'s `PreparedTransaction`) — the frontend's wallet
deserializes and signs it. This gateway never holds a private key or
signs anything itself.

## Run

Build the two adapter packages first — this gateway depends on them as
local `file:` packages, and needs their compiled `dist/` to exist for
both typechecking and running:

```bash
cd blockchain/sui && npm install && npm run build && cd ../..
cd blockchain/thetanuts && npm install && npm run build && cd ../..
```

Then:

```bash
cd api
npm install
cp .env.example .env   # defaults are fine for local dev
npm run typecheck
npm test               # 72 tests, all against fakes — no network needed
npm run dev            # or: npm run build && npm start
```

On startup the gateway loads `api/.env`, `blockchain/sui/.env` and
`blockchain/thetanuts/.env` into the process environment (each optional
— see `src/index.ts`).

The AI service (`ai/`) needs to be running separately for `/api/v1/market`
to carry live data — see `ai/README.md`.

**Dev-market mode (default until deployed).** With no Sui deployment
(empty IDs in `blockchain/sui/.env`), the Sui adapter serves a synthetic
EGSI-1H market (see `blockchain/sui/README.md`): `GET /api/v1/market`
and `/api/v1/hedge/assess` work fully, while every `prepare*` endpoint
returns **503 with an explanatory message** rather than failing
obscurely. Once `contracts/gasx` is deployed and the IDs are filled in,
the same gateway reads the real market and order preparation turns on.

## Verified status

- **Tested here**: `riskPolicy.ts`'s `checkOrderRisk`/`checkHedgeRisk`
  (pure functions) and every route via Fastify's `.inject()` against
  hand-written fakes implementing `ChainAdapter`/`HedgeProvider`/`AiClient`
  — success paths, validation failures, risk-policy rejections, and
  partial/total AI-service and Thetanuts failures. 72 tests pass;
  typechecks and builds cleanly.
- **Live-verified on this machine**: with the AI service up and
  dev-market mode on, `GET /api/v1/market` returns a combined state
  (synthetic market + real EGSI + forecast) with a 200, and
  `/api/v1/hedge/assess` returns real exposure math — so the gateway
  wiring (env loading, adapters, AI client) runs end-to-end without any
  keys. Still not exercised: real Sui reads/tx-prep (needs a
  deployment) and the Thetanuts hedge routes (needs Base + optionally a
  funded hedge wallet).

## What this gateway does NOT do (gaps worth knowing about)

- **No WebSocket support.** ARCHITECTURE.md §2 describes the gateway as
  "REST + WebSocket," but only REST is implemented here — real-time
  order book / position push updates aren't built. Fine for a first
  cut where the frontend can poll `GET /api/v1/market`; a real trading
  UI eventually wants push updates instead.
- **No real order book.** There's no indexer yet, so this gateway
  cannot list resting `Order` objects the way a real order book display
  needs. `GET /api/v1/market` returns Market config + EGSI +
  forecast, matching ARCHITECTURE.md §9's phrase "EGSI + orderbook +
  forecast" only partially — the orderbook piece needs a real indexer,
  a separate, not-yet-built piece of infrastructure (`indexer/` is still
  an empty scaffold in the repo root).
- **No PostgreSQL.** ARCHITECTURE.md §2 lists Postgres as part of the
  API gateway's stack ("Storage"); this gateway is currently entirely
  stateless (every request re-reads Sui/the AI service fresh). Fine for
  a demo's request volume; add caching/persistence if that changes.
- **The hedge flow stops before execution.** `POST /api/v1/hedge/evaluate`
  runs the whole of ARCHITECTURE.md §10 — assess ETH-beta exposure, pull
  MM pricing, submit an RFQ, collect the best candidate, apply §8's hard
  risk policy — and returns the approve/reject decision. It never calls
  Thetanuts' `settleQuotationEarly`/`settleQuotation`, so no options
  position is ever opened. That final step is Phase 5's autonomous
  execution; it spends real money on Base mainnet and should be a
  deliberate, separately-reviewed addition rather than something that
  starts happening because a threshold tripped.
- **No authentication.** Every endpoint is open. A `trader`/`marginAccountId`
  field in a request body is trusted as given — this gateway prepares a
  transaction for *someone* to sign, and Sui's own signature requirement
  is the actual authorization boundary (a prepared transaction for
  address X is useless without X's wallet signing it), but there's
  nothing here stopping one address from asking this gateway to prepare
  a transaction *as if* for another address. Not a real vulnerability
  given signing is the true gate, but worth knowing before exposing this
  publicly.

## Design notes

- **Dependency injection throughout** (`GatewayDeps`) — `buildServer`
  takes `ChainAdapter`/`HedgeProvider`/`AiClient` as plain arguments
  rather than constructing them internally, so every route's logic
  (validation, risk checks, response shaping) is tested against fakes
  without touching a network, mirroring `blockchain/thetanuts` and
  `blockchain/sui`'s own "mock the SDK boundary, test the real logic"
  convention.
- **The two hedge risk constants apply at different moments, on
  purpose.** `MIN_MODEL_CONFIDENCE` is checked *before* submitting an
  RFQ (via `checkHedgeConfidence`), because a hedge that would fail on
  confidence anyway shouldn't first spend real gas on Base mainnet.
  `MAX_HEDGE_NOTIONAL` can only be checked *after*, against the actual
  quoted premium, since that number doesn't exist until a market maker
  quotes. Applying `MAX_HEDGE_NOTIONAL` to the exposure being hedged as
  a stand-in would be a category error — a large book hedged with a
  cheap option is exactly the normal case.
- **The ETH beta is a configured assumption, not a measured
  correlation.** `exposure.ts` needs a coefficient relating EGSI
  exposure to ETH exposure; a real one would come from regressing EGSI
  returns against ETH returns, and GASX has no trading history to
  regress. Every figure the exposure panel shows inherits that
  assumption's error.
- **`checkOrderRisk` doesn't apply `MIN_MODEL_CONFIDENCE`.** A human
  placing their own order isn't "the AI requesting an action" (§8's own
  framing) — gating a manual trade on model confidence would be a
  category error. That constant is reserved for `checkHedgeRisk`
  instead, for whenever the not-yet-built hedge-settlement route needs
  it.
- **`GET /api/v1/market` degrades gracefully, `POST /api/v1/hedge/sync-signal`
  doesn't.** `aiClient.getCurrentEgsi()`/`getForecast()` return `null`
  on any failure rather than throwing — a down AI service shouldn't take
  the whole market-state response down with it. `aiClient.runCycle()`
  throws instead, because the hedge-sync route's entire job is making
  that call succeed; silently swallowing its failure would be worse than
  a loud 502.
- **`preparePlaceOrder`'s slippage check needs a reference price**, and
  the only one available right now is the oracle's own last-published
  EGSI value (`market.oracle.price`) — not independent, since the same
  AI service that computes EGSI is also what would eventually feed a
  forecast-based reference. Good enough for catching a wildly mistyped
  order price; not a substitute for real market-depth-aware slippage
  protection once a real order book/indexer exists.
