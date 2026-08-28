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
sui move test
```

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
