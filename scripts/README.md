# scripts/

| script | does |
|---|---|
| `bootstrap.sh` | installs every dependency and builds the project on a fresh machine |
| `start.sh` | starts the whole stack from one terminal; `--lan` exposes it on the wifi |
| `test-all.sh` | runs every test suite: Move, C++, Python, and the three TypeScript packages |
| `deploy-sui.sh` | publishes contracts/gasx, creates the market + oracle, and turns dev-market mode off |
| `new-hedge-wallet.mjs` | generates a fresh, isolated wallet for autonomous hedging |
| `db-export.sh` | dumps the GASX database for transfer to another machine |
| `db-import.sh` | restores a dump, replacing or merging with what is already there |

## Running the stack

```bash
./scripts/start.sh              # everything, on localhost
./scripts/start.sh --lan        # also reachable from other devices on the wifi
./scripts/start.sh --no-db      # skip MySQL (no charts, no history)
```

Starts MySQL, the AI service, the gateway and the frontend, then waits.
Ctrl-C stops everything **it** started — anything already running is
detected by port and left alone, so this will not kill a database
someone else is using.

Logs stream to `logs/*.log` rather than interleaving on one screen, since
four services writing to one terminal is unreadable:

```bash
tail -f logs/api.log
```

### Reaching it from another device

`--lan` makes Vite bind `0.0.0.0` and prints the address to open on
another laptop or phone on the same wifi.

Only the frontend is exposed. Its dev-server proxy forwards `/api` to
`127.0.0.1:3000` on the host machine, so the gateway, AI service and
database stay bound to localhost and are never reachable from the
network. That is deliberate: the gateway has no authentication, so
exposing it directly would let anyone on the wifi prepare transactions
and request hedge quotes.

Vite also rejects requests whose `Host` header it does not recognise, so
`vite.config.ts` sets `allowedHosts: true` — without it another device
gets "Blocked request" rather than the app.

## Setting up a new machine

```bash
git clone https://github.com/zishaan1911/BlockSpace-Securities-Exchange.git
cd BlockSpace-Securities-Exchange
./scripts/bootstrap.sh
./scripts/test-all.sh
```

`bootstrap.sh` is safe to re-run; every step checks before installing. It
handles the things that actually broke on a real machine rather than the
things a generic setup script would guess at:

- **WSL PATH shadowing.** Windows directories on `PATH` make `npm`
  resolve to `npm.exe`, which runs postinstall scripts through `cmd.exe`,
  which cannot handle `\\wsl.localhost\...` UNC paths. The script detects
  this up front and prints the `/etc/wsl.conf` fix rather than letting
  `npm install` fail obscurely.
- **`python3-venv`** is not in Ubuntu's base image, so `python3 -m venv`
  fails with a message about `ensurepip`.
- **`libgomp1`** is LightGBM's OpenMP runtime. Without it `import
  lightgbm` fails at load with an opaque shared-library error.
- **MariaDB vs MySQL.** Ubuntu's `mysql-server` package sometimes
  installs MariaDB, so the service name differs; the script tries both.
- **MySQL socket permissions.** `/run/mysqld` is not always readable by
  an unprivileged user, which shows up as `Can't connect ... (13)`.
  Everything here connects over TCP to `127.0.0.1` instead.
- **Adapter build order.** `api/` depends on `blockchain/sui` and
  `blockchain/thetanuts` as local `file:` packages and needs their
  compiled `dist/` before it will typecheck, so those are built first.

The Sui CLI is **not** installed automatically — it is a large release
binary and only needed for the Move contracts. The script prints
instructions, including which stray binaries to delete from the tarball
so they do not pollute `git status`.

## Leaving dev-market mode

The Sui adapter serves a synthetic market until the contracts are
actually deployed — that is what `GASX_SUI_DEV_MARKET` controls. Setting
the flag alone does nothing useful: there is no package id, no `Market`
object and no `OracleState` to read, so every request would fail. The
switch is a *consequence* of deploying, not a substitute for it.

```bash
sui client switch --env testnet
sui client faucet                    # testnet gas is free
./scripts/deploy-sui.sh --dry-run    # see what it would do
./scripts/deploy-sui.sh
```

The script publishes the package, creates the oracle (authorising your
active address as its publisher) and the EGSI-1H market, then writes the
resulting ids into `blockchain/sui/.env` and `ai/.env` and sets
`GASX_SUI_DEV_MARKET=false`. Restart the gateway afterwards.

It refuses to run against mainnet without `--allow-mainnet`, since
publishing there costs real SUI, and it checks for gas up front rather
than failing halfway through.

**Market economics.** `--multiplier`, `--tick` and `--margin-bps` set
what a single test order costs, since required margin scales with
`price × quantity × multiplier × margin_bps`. They default to `1`, `1`
and `100` (1%) — deliberately small, because on testnet the point is
exercising the flow cheaply rather than modelling a realistic contract.
At an EGSI of 300 that makes a 1-lot order cost 3 units of collateral
instead of the 300 the earlier defaults required.

Note this is *not* fractional quantity. `quantity` is a `u64` in the
Move contract, so the smallest order remains 1 — but with a small
multiplier, 1 is already a small position. True fractional lots would
need a scale factor in the contract and a redeploy.

**Collateral coin.** `Market<C>` and `MarginAccount<C>` are generic over
the collateral type, and `C` is fixed when the market is created —
changing it later means deploying a new market, not editing config. The
script defaults to `0x2::sui::SUI` because a faucet address already
holds it, so the full path works without first sourcing test USDC.
ARCHITECTURE.md §5 calls for USDC; to do it that way, pass the type
explicitly:

```bash
./scripts/deploy-sui.sh --collateral=0x...::usdc::USDC
```

**Every run publishes a fresh package.** The Move CLI records a publish
per-network in a local (never committed) `Published.toml` and refuses to
publish over an existing entry -- "Your package is already published."
Since this script exists to stand up a disposable test market each run,
it clears that record automatically before publishing rather than
requiring `sui client publish` to be told by hand each time.

**The market expires one hour after creation.** Re-run the script for a
fresh one if the demo is later than that; it is cheap on testnet.

The `AdminCap` minted on publish is deliberately **not** written to any
`.env`. Nothing in the running stack needs it — it gates pause and
settlement from the CLI — and it should not sit in a file the services
read.

## The hedge wallet

ARCHITECTURE.md §8 requires the hedge wallet be "isolated from user
funds; Base + [ETH, USDC] only". The tempting shortcut is to reuse an
existing wallet, and that quietly breaks the guarantee: an agent
authorised to spend from a wallet can spend everything in it, and
`MAX_HEDGE_NOTIONAL` is enforced by the gateway rather than by the
chain. A separate wallet holding only what a hedge needs is what makes
the cap real — the balance is the actual backstop.

```bash
node scripts/new-hedge-wallet.mjs
```

Generates a keypair and prints it once. It never touches the network,
never writes the key anywhere, and cannot fund anything. Put the key in
`blockchain/thetanuts/.env` and fund the address on Base mainnet.

Find out what a hedge actually costs before sending anything — a quote
request costs only gas, and no market maker is paid unless a quote is
settled, which this build never does:

```bash
curl -s -X POST localhost:3000/api/v1/hedge/evaluate \
  -H 'content-type: application/json' \
  -d '{"netContracts": 10, "egsiLevel": 300}'
```

The `quotedNotional` in the response is the real premium being asked.

Thetanuts has no testnet, so Base mainnet is the only option. This is
the one part of GASX that spends real money.

## Moving collected EGSI history between machines

The readings in `egsi_snapshot` are **irreplaceable**. Each one is
derived from live mempool and base-fee state at a moment in time, and
there is no way to re-fetch a past block's pending transaction count.
Losing them means starting collection again from zero — which, for a
model that needs hours of history, is a real cost.

On the machine that has the data:

```bash
./scripts/db-export.sh
# -> gasx-export-2026-09-01.sql.gz
```

Uses `--single-transaction`, so it takes a consistent snapshot without
locking anything. Safe to run while the stack is still collecting.

Copy the file across (scp, a USB stick, whatever), then:

```bash
./scripts/db-import.sh gasx-export-2026-09-01.sql.gz
```

That **replaces** the local database, and prompts first if it would
destroy existing readings. To combine two machines' histories instead:

```bash
./scripts/db-import.sh gasx-export-2026-09-01.sql.gz --merge
```

Merge loads the dump into a scratch database and copies rows across with
`INSERT IGNORE`, so the unique key on `(market, block_number)` drops
duplicates rather than aborting. Verified: merging a 300-row export into
a database already holding those same 300 rows plus 100 others leaves
exactly 400, not 700.

The `forecast` table is deliberately **not** merged — it references
`egsi_snapshot` by id, and those ids will not line up across machines.
The readings are what retraining needs; forecasts regenerate.

### What does not transfer

- **`.env` files.** Not in git, and they may hold keys. Copy them by
  hand, or let `bootstrap.sh` recreate them from the `.env.example`
  templates and fill in real values.
- **Trained models** (`ai/models/`). Gitignored by design. Regenerate
  with `python -m inference.train --from-gateway http://localhost:3000`
  once the history is imported — which is the point of transferring the
  history in the first place.
- **`node_modules/`, `dist/`, `venv/`, `engine/build/`.** All rebuilt by
  `bootstrap.sh`. Copying them across machines invites architecture
  mismatches.
