# GASX Frontend

React web app for the GASX exchange: EGSI dashboard, AI forecast, order
form, positions, and the autonomous Thetanuts hedge view. Built with
Vite + TypeScript + Sui dApp Kit + Recharts.

Per `ARCHITECTURE.md` §2 the UI talks only to stable domain endpoints
(`/api/v1/...`, `/ws/...`) — it never knows how the backend is composed.
Until the API gateway exists, the app runs on a **simulated feed**
(`src/lib/mock.ts`) so the full demo narrative plays with zero backend.

## Run

```bash
pnpm install
cp .env.example .env    # defaults run in mock mode
pnpm dev                # http://localhost:5173
```

## Scripts

| command | what it does |
|---|---|
| `pnpm dev` | dev server with HMR |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm build` | typecheck + production build to `dist/` |
| `pnpm preview` | serve the production build |

## Environment (`.env`)

| var | purpose |
|---|---|
| `VITE_NETWORK` | `testnet` (default) or `mainnet` |
| `VITE_USE_MOCK` | `true` forces the simulated feed even if an API exists |
| `VITE_API_URL` / `VITE_WS_URL` | API gateway REST + WebSocket endpoints |
| `VITE_GASX_PACKAGE_ID` | deployed `contracts/gasx` package id on Sui |
| `VITE_USDC_COIN_TYPE` | full USDC coin type, e.g. `0x...::usdc::USDC` |

## Modes

- **Mock (default):** `src/lib/mock.ts` simulates a live market — EGSI
  random walk with congestion regimes, synthetic order book, forecast,
  positions, and the hedge state machine (evaluating → proposed →
  approved → executed with a fake Base digest). The 1-hour cycle is
  accelerated to 60s so the whole demo story plays in a minute.
- **Live:** set `VITE_USE_MOCK=false` and point `VITE_API_URL` at the API
  gateway. The app polls `/api/v1/market-state` and subscribes to the
  WebSocket, falling back to polling if the socket drops.
- **On-chain orders:** in live mode with a connected wallet and
  `VITE_GASX_PACKAGE_ID` set, the order form builds a real Sui
  transaction (`src/lib/sui.ts` → `order::place_limit_order`) and signs
  it via Sui dApp Kit. Until the Move package is deployed and the
  call-signature is wired (market object id + USDC coin selection), the
  form routes orders through the API instead.

## Layout

```text
src/
├── main.tsx                  QueryClient + SuiClientProvider + WalletProvider
├── App.tsx                   dashboard layout (5 sections)
├── styles.css                dark theme, single stylesheet
├── hooks/
│   └── useMarketState.ts     owns the feed (mock or live), exposes state + submitOrder
├── lib/
│   ├── types.ts              domain types shared across the UI
│   ├── mock.ts               simulated market service (EGSI, book, hedge narrative)
│   ├── api.ts                REST/WS client for the API gateway
│   └── sui.ts                dApp Kit network config + order transaction builder
└── components/
    ├── Header.tsx            brand + wallet connect + mode badge
    ├── EGSIGauge.tsx         0–1000 stress dial
    ├── EGSIChart.tsx         history + forecast projection
    ├── ForecastCard.tsx      AI forecast: expected value, confidence, P(>500)
    ├── MarketMeta.tsx        expiry countdown, multiplier, oracle age
    ├── OrderBook.tsx         bid/ask depth
    ├── OrderForm.tsx         LONG/SHORT, qty, price, margin estimate, submit
    ├── PositionsTable.tsx    open positions with unrealized P&L
    └── HedgeView.tsx         Thetanuts hedge: exposure, RFQ candidate, tx link
```

## Demo script mapping

1. Gauge + chart show live EGSI; forecast card shows the AI's call
2. Order form places a LONG → position appears (real tx on Sui when wired)
3. HedgeView walks its narrative: exposure breach → Thetanuts quotes →
   policy approval → executed Base mainnet tx → explanation of risk reduced
