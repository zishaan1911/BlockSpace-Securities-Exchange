# GASX Sui adapter

TypeScript adapter implementing ARCHITECTURE.md §9's "prepare, don't
sign" half of the Trade Flow: reads `Market`/`OracleState`
(`contracts/gasx`), and builds+serializes (never signs) transactions for
margin accounts and orders. Signing always happens in the trader's own
wallet, in the frontend — this adapter's `PreparedTransaction.transactionJson`
is exactly what a wallet's `Transaction.from(json)` consumes.

One `ChainAdapter`-style interface (`types.ts`), mirroring
`blockchain/thetanuts`'s convention: `@mysten/sui`'s own types never
leak past `client.ts`/`chainAdapter.ts`.

## Modules

| module | responsibility |
|---|---|
| `types` | GASX-facing types — `MarketState`, `OracleState`, `PreparedTransaction`, the `ChainAdapter` interface |
| `config` | environment-driven config (RPC URL, package/market/oracle IDs, collateral coin type, dev-market flag) |
| `client` | real `SuiJsonRpcClient` factory (see "A note on the SDK" below) |
| `marketState` | `parseMarketFields`/`parseOracleFields` (pure) + `fetchMarketState` (reads Market + OracleState) |
| `devMarket` | `fetchDevMarketState` — the synthetic market served in dev-market mode |
| `orderTx` | `prepareOpenAccount`/`prepareDeposit`/`preparePlaceOrder`/`prepareCancelOrder` — build and serialize, never sign |
| `chainAdapter` | `SuiChainAdapter` — the concrete `ChainAdapter`, composing the above |

## Run

```bash
cd blockchain/sui
npm install
cp .env.example .env   # see "Dev-market mode" — empty IDs work out of the box
npm run typecheck
npm test               # 14 tests: parsing fixtures + dev-market behavior
```

## Dev-market mode (default until deployed)

Until `contracts/gasx` is published on Sui, leave the four deployed-ID
variables empty: the adapter then serves a **synthetic EGSI-1H market**
(`devMarket.ts`) so the whole stack — AI service → API gateway →
frontend — runs with zero deployment. The synthetic market mirrors the
real on-chain terms (hourly expiry, multiplier 1, tick 1, unpaused,
unsettled, oracle never published) and is flagged `devMode: true` so the
frontend can label it honestly.

In dev mode, `prepare*` **refuses** to build transactions
(`DevMarketUnavailableError` — there is no on-chain market to sign for).
The gateway maps that to a clear 503 message in the UI.

- `GASX_SUI_DEV_MARKET=true` — force dev mode
- `GASX_SUI_DEV_MARKET=false` — force real mode; missing IDs are a hard startup error
- unset — auto: dev mode when any ID is missing

## Going live (post-deployment)

1. `sui client publish` in `contracts/gasx` → package ID.
2. Create the market and oracle (`gasx::market::create_market` /
   `gasx::oracle::create_oracle` — admin-gated via the `AdminCap` minted
   on publish; callable with `sui client ptb`).
3. Fill `GASX_SUI_PACKAGE_ID`, `GASX_SUI_MARKET_ID`, `GASX_SUI_ORACLE_ID`,
   `GASX_SUI_COLLATERAL_COIN_TYPE` in `.env`, set
   `GASX_SUI_DEV_MARKET=false`.
4. Confirm a `prepareOpenAccount`/`preparePlaceOrder` response
   deserializes and signs cleanly in a real wallet before trusting it.

## Verification status

- **Tested here**: `parseMarketFields`/`parseOracleFields` against
  synthetic `MoveStruct` fixtures shaped like a real `getObject`
  response (u64-as-decimal-string, wrapped/bare ID encodings, settled
  vs. not), plus dev-market mode. Typecheck, tests (14) and build all
  clean against the installed `@mysten/sui@2.27.1`.
- **Not yet exercised against a live endpoint**: `fetchMarketState` and
  the four `prepare*` functions against Sui testnet with a real
  deployment — see "Going live" above.

**A note on the SDK**: this targets `@mysten/sui@2.27.1`'s JSON-RPC
client (`SuiJsonRpcClient`, from `@mysten/sui/jsonRpc`) — verified by
introspecting the installed package's `.d.ts` directly. Every JSON-RPC
export in that file carries an explicit `@deprecated` tag pointing at
`SuiGrpcClient` (`@mysten/sui/grpc`) or `SuiGraphQLClient`
(`@mysten/sui/graphql`) instead. This adapter deliberately still uses
the deprecated JSON-RPC path for v1: it's functionally complete
(deprecated, not removed), far better documented than the newer
gRPC-web path, and matches the testnet JSON-RPC endpoint `setup.md`
already has you configure via the Sui CLI. Migrating to `SuiGrpcClient`
is a reasonable follow-up; if `@mysten/sui`'s pinned version has moved
since this was written, re-verify against the installed `.d.ts` before
trusting anything here.

## Design notes

- **This adapter never signs anything.** Every `prepare*` function
  returns `{transactionJson, summary}` — a wallet deserializes
  (`Transaction.from(json)`) and signs; this adapter's private-key
  surface is exactly zero, by design (contrast with `blockchain/thetanuts`'s
  hedge wallet or the AI service's oracle publisher, both of which *do*
  hold a service-owned key for their own automated actions).
- **`toJSON()` is called with `{ client }`**, not bare — without a
  client, the SDK can't resolve `tx.object(id)`'s current shared-object
  version or auto-select a gas coin, so the "transaction" it'd produce
  wouldn't actually be ready to sign. This was a real bug caught while
  building this — worth remembering if this file gets refactored.
- **`fetchMarketState` cross-checks the market's on-chain `oracle_id`**
  against the configured `GASX_SUI_ORACLE_ID` and throws on mismatch,
  rather than silently trusting config — a stale `.env` pointing at the
  wrong oracle for a given market is exactly the kind of
  hard-to-notice bug worth failing loudly on.
- **`isFreshApprox` is explicitly not authoritative.** `oracle.move`'s
  own `is_fresh()` reads a live on-chain `Clock`; this field is computed
  client-side against wall-clock time at the moment of the read, purely
  for display. Settlement/margin logic must never trust it — only the
  Move contract's own freshness check matters there.
- **Collateral coin type is a required config value, not inferred** —
  `Market`/`MarginAccount<C>` are generic over `C` (contracts/gasx/README.md),
  so every `prepare*` call needs `GASX_SUI_COLLATERAL_COIN_TYPE` as a
  type argument. Wrong type argument = a transaction that will abort
  on-chain, not a silent wrong-token transfer — Move's type system
  catches this, but it's still worth getting right up front.
