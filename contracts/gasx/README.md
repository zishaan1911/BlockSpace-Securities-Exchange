# `gasx` Move package

On-chain Trading Plane for GASX: market configuration, order matching,
margin accounting, positions, oracle state, and settlement. See
`ARCHITECTURE.md` §§6, 8, 15–16 for the design this implements.

Phase 1 scope (`ARCHITECTURE.md` §40): a single deterministic manual trade —
`Market`, `Order`, `Margin`, `Position`, trade execution, `Settlement`. No
CLOB/DeepBook integration yet.

## Modules

| Module | Responsibility |
|---|---|
| `admin` | `AdminCap` — narrowly-scoped admin authority (§38) |
| `events` | Shared event structs emitted across modules |
| `risk` | Pure margin/PnL math, no on-chain state |
| `oracle` | Publisher-gated EGSI price feed with freshness checks |
| `market` | `Market` config object; create/pause (admin-gated) |
| `margin` | `MarginAccount<C>` — deposit/withdraw/lock/release collateral |
| `position` | `Position` object — open, adjust, realize PnL |
| `order` | `Order` object, cancellation, and deterministic two-order matching |
| `settlement` | Oracle-driven market settlement and PnL distribution |

## Build & test

Requires the [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install).

```bash
cd contracts/gasx
sui move build
sui move test      # 45 tests
```

## Deploy (Sui testnet)

Until deployed, the rest of the stack runs against a synthetic dev
market (see `blockchain/sui/README.md`) — nothing here is required for
local development.

1. Fund a testnet address (the CLI faucet redirects to
   https://faucet.sui.io) and publish:

   ```bash
   sui client switch --env testnet
   sui client publish
   ```

   Note the package ID. Publishing mints `gasx::admin::AdminCap` to the
   publisher address.
2. Create the oracle and the market — both are admin-gated public
   functions, callable via `sui client ptb` with the `AdminCap` object:

   ```text
   gasx::oracle::create_oracle(&AdminCap, initial_publisher, max_staleness_ms, max_price)
   gasx::market::create_market(&AdminCap, underlying, expiry_ms, contract_multiplier,
                               tick_size, margin_ratio_bps, oracle_id)
   ```

   (Alternatively, add a small helper module with `entry` wrappers.)
3. Fill the resulting object IDs into `blockchain/sui/.env`
   (`GASX_SUI_PACKAGE_ID` / `GASX_SUI_MARKET_ID` / `GASX_SUI_ORACLE_ID`
   + `GASX_SUI_COLLATERAL_COIN_TYPE`) and set `GASX_SUI_DEV_MARKET=false`.
4. The AI service can then publish EGSI updates to the oracle — give it
   a funded publisher key matching `create_oracle`'s `initial_publisher`
   (see `ai/.env.example`).

## Design notes

- Collateral is generic over a coin type `C` (`MarginAccount<C>`) rather than
  hardcoded to a specific USDC coin type, so the same code path works against
  Sui testnet USDC or a local test coin.
- The order book/matching engine is off-chain (C++, per `ARCHITECTURE.md`
  §16) and **not authoritative**. On-chain, `order::match_orders` is the
  single source of truth for a trade: it re-validates price/size
  compatibility and margin sufficiency itself rather than trusting the
  off-chain replica.
- Admin authority is capability-based (`AdminCap`), not address-based, and is
  scoped to pausing markets, updating risk parameters, and rotating the
  oracle publisher — it cannot move user funds (§38).
