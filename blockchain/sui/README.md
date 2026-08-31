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
| `config` | environment-driven config (RPC URL, package/market/oracle IDs, collateral coin type) |
| `client` | real `SuiJsonRpcClient` factory (see "A note on the SDK" below) |
| `marketState` | `parseMarketFields`/`parseOracleFields` (pure) + `fetchMarketState` (reads Market + OracleState) |
| `orderTx` | `prepareOpenAccount`/`prepareDeposit`/`preparePlaceOrder`/`prepareCancelOrder` — build and serialize, never sign |
| `chainAdapter` | `SuiChainAdapter` — the concrete `ChainAdapter`, composing the above |

## Run

```bash
cd blockchain/sui
npm install
cp .env.example .env   # fill in package/market/oracle IDs — see contracts/gasx/README.md
npm run typecheck
npm test
```

## What's actually verified in Claude's sandbox vs. what needs
## verification on your machine

Same split as `blockchain/thetanuts` and `ai/`, for the same reason: no
network egress to Sui RPC from that sandbox.

- **Fully tested, real, in-sandbox**: `parseMarketFields`/
  `parseOracleFields` (12 tests) against synthetic `MoveStruct`
  fixtures shaped like a real `getObject` response — including Sui's
  u64-as-decimal-string JSON-RPC convention, both wrapped (`{id: "0x.."}`)
  and bare-string encodings of `ID`/address fields, and the
  not-yet-settled vs. settled `settlementPrice` distinction. Also
  typechecks (`tsc --noEmit`) and builds cleanly against the actually-
  installed `@mysten/sui@2.27.1` package.
- **NOT exercised against a live endpoint**: `fetchMarketState` and all
  four `prepare*` functions, which call the real `SuiJsonRpcClient`
  against Sui testnet/mainnet. Needs verification on your machine —
  publish `contracts/gasx`, create a market + oracle, fill in `.env`,
  and confirm a `prepareOpenAccount`/`preparePlaceOrder` response
  actually deserializes and signs cleanly in a real wallet before
  trusting this.

**A note on the SDK**: this targets `@mysten/sui@2.27.1`'s JSON-RPC
client (`SuiJsonRpcClient`, from `@mysten/sui/jsonRpc`) — verified by
introspecting the installed package's `.d.ts` directly. Every JSON-RPC
export in that file carries an explicit `@deprecated` tag pointing at
`SuiGrpcClient` (`@mysten/sui/grpc`) or `SuiGraphQLClient`
(`@mysten/sui/graphql`) instead — none of which match what
`sdk.mystenlabs.com`'s own published examples show as of this writing
(they mostly still show the old `SuiClient`/`getFullnodeUrl` names,
which don't exist in this installed version at all — the real class is
`SuiJsonRpcClient`, the real URL helper is `getJsonRpcFullnodeUrl`).

This adapter deliberately still uses the deprecated JSON-RPC path for
v1: it's functionally complete (deprecated, not removed), far better
documented than the newer gRPC-web path, and matches the testnet
JSON-RPC endpoint `setup.md` already has you configure via the Sui CLI.
Migrating to `SuiGrpcClient` is a reasonable follow-up once there's time
to verify gRPC-web actually works cleanly from a Node.js server context
(it's primarily documented for browser use) — not attempted here to
keep this iteration's scope and risk bounded. If `@mysten/sui`'s pinned
version has moved since this was written, re-verify against the
installed `.d.ts` before trusting anything here — this exact SDK has
already renamed its main client class and URL helper at least once.

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
  building this (the `client` parameter was threaded through but not
  actually passed to `toJSON()` on the first pass) — worth remembering
  if this file gets refactored.
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
