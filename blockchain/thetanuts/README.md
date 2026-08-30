# GASX Thetanuts adapter

TypeScript adapter implementing ARCHITECTURE.md §7's two non-execution
Thetanuts touchpoints — "Data" and "RFQ hedge" (GOALS.md's Phase 4).
Touchpoint 3, autonomous execution, is Phase 5 and not implemented here.

One `HedgeProvider`-style interface (§7: "so Thetanuts types never
leak") wraps `@thetanuts-finance/thetanuts-client`: everything outside
`src/client.ts` and `src/hedgeProvider.ts` only ever sees GASX's own
types (`src/types.ts`), never the SDK's.

## Modules

| module | responsibility |
|---|---|
| `types` | GASX-facing types — `VolSignal`, `HedgeRequestParams`, `HedgeRequest`, `HedgeCandidate`, the `HedgeProvider` interface |
| `config` | environment-driven config (chain ID fixed to 8453 — see below) |
| `volSignal` | touchpoint 1 ("Data"): `computeVolSignal` (pure) derives ETH ATM IV + 25-delta skew from live order greeks; `fetchVolSignal` wraps it with real SDK calls |
| `rfqHedge` | touchpoint 2 ("RFQ hedge"): `createHedgeRequest` submits an RFQ; `collectBestCandidate` decrypts offers and ranks them; `pickBestCandidate` (pure) is the ranking rule |
| `client` | constructs a real, configured `ThetanutsClient` |
| `hedgeProvider` | `ThetanutsHedgeProvider` — the concrete `HedgeProvider`, composing the above |

## Run

```bash
cd blockchain/thetanuts
npm install
cp .env.example .env   # fill in GASX_THETANUTS_BASE_RPC_URL; hedge wallet key is optional (read-only without it)
npm run typecheck
npm test
```

## What's actually verified in Claude's sandbox vs. what needs
## verification on your machine

Same split this project already uses for Move contracts and the AI
service's Ethereum/Sui integration (`GASX_PROJECT_HANDOFF.md` §1,
`ai/README.md`), for the same reason: no network egress to Base RPC
from that sandbox.

- **Fully tested, real, in-sandbox**: `computeVolSignal` (13 tests) and
  `pickBestCandidate`/`pricePerContractFromOfferAmount` (10 tests) —
  all pure functions against synthetic fixtures. The whole module also
  typechecks (`tsc --noEmit`) and builds (`tsc`) cleanly against the
  actually-installed `@thetanuts-finance/thetanuts-client@0.3.0`
  package — not just against its published docs (see below).
- **NOT exercised against a live endpoint** — needs verification on
  your machine before you trust it: `fetchVolSignal`, `createHedgeRequest`,
  and `collectBestCandidate`, all of which call the real SDK against
  Base mainnet. `createHedgeRequest` additionally needs a funded,
  dedicated hedge wallet (ARCHITECTURE.md §8) to test at all, since it
  submits a real on-chain transaction.

**A note on the SDK's docs vs. its actual shipped types**: this module
is built against `@thetanuts-finance/thetanuts-client`'s installed
`.d.ts` file, verified by introspection
(`node_modules/@thetanuts-finance/thetanuts-client/dist/index.d.ts`),
not purely from `docs.thetanuts.finance`'s published examples — two
real gaps turned up while building this:

1. The docs' RFQ examples pass a singular `strike: 2000`, but the
   installed package's `RFQBuilderParams` type requires `strikes:
   number | number[]` — `strike` is present but marked `@deprecated`.
   `rfqHedge.ts` uses `strikes`.
2. The docs' "decrypt an offer" example reads `offer.signedOfferForRequester`/
   `offer.signingKey` off an object it calls `offer` without saying
   where those fields come from. They're **not** on `OfferMadeEvent`
   (the on-chain event type, which only carries `quotationId`/`offeror`/
   block info) — they're on `StateOffer`, from `client.api.getFactoryOffers()`.
   `rfqHedge.ts`'s `collectBestCandidate` uses `getFactoryOffers()`.

If `@thetanuts-finance/thetanuts-client`'s pinned version in
`package.json` has moved since this was written, re-verify against the
installed `.d.ts` directly before trusting anything here — this is a
young, fast-moving SDK (`0.3.0`), and its published docs already
lagged its own shipped types once.

## Design notes

- **Thetanuts has no testnet** — only Base Mainnet (8453, full
  OptionBook/RFQ) and Ethereum Mainnet (1, WheelVault only) are
  supported. `config.ts` fixes `THETANUTS_CHAIN_ID = 8453`; there's no
  "point this at testnet for safe dev testing" option, for this
  protocol or for GASX's own build order (GOALS.md, ARCHITECTURE.md's
  scope note: "only the Thetanuts options trade must be on mainnet").
- **`computeVolSignal` reads IV/delta from live order `greeks`**
  (`client.api.fetchOrders()`'s `rawApiData.greeks`), not from
  `client.mmPricing`. `MMPricingModule`'s pricing objects
  (`MMVanillaPricing`) carry bid/ask/mark price but — despite what the
  SDK's own type-export docs describe — no IV field in the version this
  was built against; IV/delta live on `Order.rawApiData.greeks`
  instead, which is optional per-order (present only when the pricing
  API attached it). If real usage shows `greeks` frequently absent, the
  natural fallback is deriving IV from `MMVanillaPricing.markPrice` via
  Black-Scholes inversion — not implemented here.
- **Skew is a 25-delta risk-reversal proxy** (put IV at delta ≈ -0.25
  minus call IV at delta ≈ +0.25), a standard, recognizable volatility
  skew metric — not a bespoke one. Reads 0 when either leg can't be
  found near-enough to the target delta (few live quotes at that
  underlying/expiry), which callers should treat as "no skew signal
  available," not "flat skew."
- **`getVolSignal` throws rather than returning a fabricated signal**
  when no usable quotes exist (e.g. no live orders carry `greeks` right
  now). Callers (the AI service, ultimately) should fall back to a
  cached `VolSignal` or skip the Thetanuts EGSI component for that
  cycle — inventing a zero/neutral signal here would silently corrupt
  EGSI rather than visibly degrade it.
- **`collectBestCandidate` never settles anything.** It decrypts
  whatever offers exist so far and returns the best per the same
  lowest-wins-for-BUY/highest-wins-for-SELL rule the on-chain reveal
  phase itself enforces (docs.thetanuts.finance's RFQ Lifecycle page) —
  but accepting an offer (`settleQuotationEarly`/`settleQuotation`) is
  Phase 5's autonomous-execution step, gated on ARCHITECTURE.md §8's
  hard risk policy, which lives outside this adapter entirely.
- **An offer this adapter can't decrypt is skipped, not fatal** —
  `collectBestCandidate` continues past decryption failures (wrong
  keypair, corrupted payload) rather than failing the whole lookup;
  other offers may still be usable.
- **RFQ collateral token is hard-coded to USDC** in `createHedgeRequest`
  (`WETH`/`cbBTC` are also valid per the SDK) — GASX's own settlement
  currency is USDC (ARCHITECTURE.md §5, §12), so hedges settling in the
  same currency avoids an extra conversion step. Revisit if a future
  hedge structure needs different collateral.
