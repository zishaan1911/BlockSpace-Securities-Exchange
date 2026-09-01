# GASX web app

React + TypeScript market screen (ARCHITECTURE.md §2). Talks only to the
API gateway over `/api/v1/...` — nothing here imports a Sui or Thetanuts
SDK for data, because the gateway hides both. The single exception is
signing, which by definition happens in the user's own wallet.

## Status

This is the merged frontend on `main` (brought in from `draft-frontend`,
alongside the API gateway in `api/` and the Sui adapter in
`blockchain/sui/`). Verified on the team's machine: `npm run typecheck`
clean, `npm test` 17/17 passing, `npm run build` clean.

It has been exercised against the real local stack in dev-market mode
(gateway serving the synthetic market + live EGSI from the AI service —
see `api/README.md`), but not yet against a deployed Sui market, and it
has not been visually verified in a browser (see Honest gaps).

## Run

The gateway must be running first (see `api/README.md`), along with the
AI service it depends on (`ai/README.md`):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:3000` (override with
`GASX_API_URL`), so the browser stays same-origin and the gateway needs
no CORS configuration. Point at a different Sui network with
`VITE_SUI_NETWORK=mainnet`; it defaults to testnet, which is where
GASX's own market lives (ARCHITECTURE.md §12).

```bash
npm run typecheck
npm test
npm run build
```

## Stack

- Vite + React 19 + TypeScript
- `@mysten/dapp-kit-react` (the maintained successor to
  `@mysten/dapp-kit`) with a `SuiGrpcClient`-based client per network
- Vitest + jsdom for the unit tests (`tests/egsi.test.ts`)
- npm as the package manager (`package-lock.json` committed)

## Repository layout

```text
frontend/
├── index.html
├── package.json / tsconfig.json / tsconfig.typecheck.json / vite.config.ts
├── src/
│   ├── main.tsx               createDAppKit + DAppKitProvider wiring
│   ├── App.tsx                the market screen: 15s poll of GET /api/v1/market
│   ├── styles.css             instrument-panel theme (see Design)
│   ├── lib/
│   │   ├── api.ts             the only backend contact: GET /market, POST /orders/prepare,
│   │   │                      /account/prepare-open, /hedge/assess, /hedge/evaluate
│   │   └── egsi.ts            pure band/format math: stressBand, bandLabel, gaugeFraction
│   └── components/
│       ├── EgsiGauge.tsx      270° calibrated arc gauge with band marks
│       ├── DriverBars.tsx     EGSI components sorted by contribution
│       ├── Panels.tsx         ForecastPanel + MarketPanel
│       ├── OrderTicket.tsx    order form; signs the gateway-prepared transaction
│       └── HedgePanel.tsx     hedge reasoning: assess/evaluate with named risk limits
└── tests/
    └── egsi.test.ts           unit tests for lib/egsi.ts
```

## Design

**Direction: Bloomberg Terminal.**

That is a specific, historically grounded language rather than a generic
dark theme, and it has rules worth following exactly:

- **Amber on black.** Amber (`#ffa028`) is the primary text colour, not
  an accent used sparingly. Cyan (`#2fb6e8`) carries section headers as
  solid title bars with inverted black text. White-ish (`#f0ede6`) is
  reserved for data *values*, so numbers read louder than their labels.
  Green and red appear only for direction, never decoratively.
- **Density over comfort.** 11.5px monospace, tight leading, three
  columns, everything on one screen. A terminal is scanned for a number,
  not browsed, so panels sit tight rather than breathing.
- **Hard rectangles.** No border radius, no shadows, no gradients.
- **Right-aligned tabular numerics** so columns compare by eye.

Monospace throughout is the one case where it is correct rather than
decorative: column alignment is load-bearing, and the terminal idiom is
itself monospaced. IBM Plex Mono stands in for Bloomberg's proprietary
face — a deliberate pick, not a fallback.

This replaced an earlier instrument-panel design whose signature element
was a 270-degree arc gauge. A dial is instrument vernacular; a terminal
shows the number large, the level as a horizontal band scale with the
500/750 boundaries marked, and the recent series as a sparkline beside
it. Losing the gauge was the point of the change, not a casualty of it.

**Layout** follows the order a trader reads: what the index is doing
(left), what it is worth and where it trades (centre), what you can do
about it (right). One screen, because there is one market
(ARCHITECTURE.md §12).

## What the screen shows

| Panel | Source |
|---|---|
| Gas Stress Index gauge | `GET /api/v1/market` → `egsi.score` |
| What's driving it | `egsi.components`, sorted by contribution |
| Forecast | `forecast`, with an explicit warning when it's the fallback |
| Market terms | `market` — expiry, tick, margin, oracle freshness |
| Depth ladder | `orderbook` + `quote` from the C++ engine — **indicative** |
| Sparkline | `GET /api/v1/history`, last 240 readings |
| Place an order | `POST /api/v1/orders/prepare`, then the wallet signs |
| ETH-correlated risk | `POST /api/v1/hedge/assess` and `/evaluate` |

**The order ticket never builds a transaction.** It sends parameters to
the gateway, which runs its pre-trade risk checks and returns a
serialized transaction; the wallet signs that. There is no client-side
path that produces a signable transaction without the gateway having
approved it first — the risk checks are unbypassable from the browser.

**The depth ladder is labelled indicative, permanently.** Those levels
come from the C++ engine quoting off the AI forecast, not from resting
orders anyone placed — `contracts/gasx` owns the real book and there is
no indexer to read it from. A depth ladder is about the most
executable-looking thing a screen can show, so the label sits in the
panel header and again beneath the table, and rides in the API payload
as `indicative: true` rather than living only in a comment.

**The hedge panel shows reasoning, not just outcomes.** ARCHITECTURE.md
§8's premise is that the AI can request an action but cannot bypass
policy, and that guarantee is only worth something if a person can watch
it being applied — so a rejection names the limit that stopped it, and
an approval states plainly that nothing was traded.

## Honest gaps

- **Not visually verified by a human.** The layout, palette and gauge
  were built and reviewed as code, and an automated headless-Chromium
  check verifies the page loads with zero console/page errors and every
  panel renders (including a hedge-assess round trip) — but no human
  has eyeballed the screenshot yet. Do that before the demo.
- **Order placement only works against a deployed market.** In
  dev-market mode the gateway returns a clear 503 ("contracts not
  deployed") which the ticket displays; signing a real order needs the
  Sui deployment described in `blockchain/sui/README.md`.
- **No order book and no positions list.** Both need an indexer, which
  does not exist (`indexer/` is still an empty scaffold). This is why
  the hedge panel asks you to type your net position rather than reading
  it: there is no position feed to read from.
- **No WebSocket.** ARCHITECTURE.md §2 specifies REST + WebSocket; the
  gateway implements only REST, so this polls `GET /api/v1/market` every
  15 seconds instead of receiving push updates.
- **One market, one screen.** There is only ever one market
  (ARCHITECTURE.md §12), so navigation between screens would be chrome
  around a single view.
- **Margin accounts have no UI.** Opening one
  (`POST /api/v1/account/prepare-open`) is wired in the API client but
  has no button yet; the account id is expected to come from the Sui CLI
  for now.
