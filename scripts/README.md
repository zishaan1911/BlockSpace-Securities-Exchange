# scripts/

| script | does |
|---|---|
| `bootstrap.sh` | installs every dependency and builds the project on a fresh machine |
| `test-all.sh` | runs every test suite: Move, C++, Python, and the three TypeScript packages |
| `db-export.sh` | dumps the GASX database for transfer to another machine |
| `db-import.sh` | restores a dump, replacing or merging with what is already there |

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
