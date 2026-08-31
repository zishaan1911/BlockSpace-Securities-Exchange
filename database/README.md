# GASX database (MySQL)

Durable state for the API gateway. Per ARCHITECTURE.md §2, the gateway
is the **only** service that talks to the database — the AI service
never connects, and the frontend reaches history through the gateway's
REST API like everything else.

> **Note on ARCHITECTURE.md**: §1, §2, §12 and §11 all say PostgreSQL.
> MySQL was chosen instead as a deliberate, later decision. Nothing in
> the schema or the gateway depends on anything Postgres-specific, so
> the swap is contained — but the architecture doc's own wording has
> been updated to match rather than left contradicting the code.

## Apply the schema

```bash
sudo service mariadb start          # or: sudo service mysql start
sudo mysql -e "CREATE DATABASE IF NOT EXISTS gasx;
               CREATE USER IF NOT EXISTS 'gasx'@'localhost' IDENTIFIED BY 'gasx';
               GRANT ALL ON gasx.* TO 'gasx'@'localhost';"
mysql -u gasx -pgasx gasx < database/migrations/001_initial_schema.sql
```

Then point the gateway at it, in `api/.env`:

```
GASX_API_DATABASE_URL=mysql://gasx:gasx@localhost:3306/gasx
```

**The database is optional.** With `GASX_API_DATABASE_URL` unset, the
gateway runs exactly as before — it just keeps no durable state. That
keeps the dev-market path (no Sui deployment, no MySQL install) working
for anyone who just wants the stack up.

Migrations are plain `.sql` files applied in filename order. There is no
migration runner: with a single migration and a hackathon timeline, one
would be more machinery than the problem needs. If a second migration
lands, revisit that.

## Tables

| Table | Written by | Status |
|---|---|---|
| `egsi_snapshot` | `GET /api/v1/market`, every time a new EGSI reading is seen | **live** |
| `forecast` | same request, when the AI service returns one | **live** |
| `hedge_evaluation` | `POST /api/v1/hedge/evaluate`, on every exit path | **live** |
| `prepared_order` | `POST /api/v1/orders/prepare`, both accepted and rejected | **live** |
| `trade_event` | nothing yet — needs the indexer | *pending* |
| `position_snapshot` | nothing yet — needs the indexer | *pending* |

The two pending tables exist because ARCHITECTURE.md §2 assigns
"indexing" to the gateway and §9 has an indexer feeding position
updates, but `indexer/` is still an empty scaffold. Their schema is
defined so that work has a target to write into — **do not mistake the
tables existing for them having data**.

## Why these tables

- **`egsi_snapshot` is the one that unblocks something concrete.**
  `ai/inference/train.py` can currently only train on synthetic data,
  because EGSI history lived in memory (`ai/main.py`'s `EgsiHistory`,
  capped at 200 entries, lost on restart) and was never written down.
  Persisting every reading is what makes a genuinely trained model
  possible instead of a pipeline demonstration.
- **`hedge_evaluation` is an accountability record.** ARCHITECTURE.md §8
  promises the AI can request an action but cannot bypass policy. A
  guarantee that leaves no trace is hard to verify after the fact, so
  every evaluation is recorded — including rejections, and specifically
  which limit caused them.
- **`prepared_order` records rejections too**, for the same reason: how
  often a risk rule fires, and which one, is impossible to reconstruct
  later if it was never written down.

## Design notes

- **Collation is `utf8mb4_unicode_ci`, not MySQL 8's default
  `utf8mb4_0900_ai_ci`** — the latter does not exist in MariaDB, which
  is what Ubuntu's `mysql-server` package actually installs. The chosen
  collation works on MySQL 5.7+, MySQL 8 and MariaDB alike, and nothing
  here depends on the newer one's behaviour.
- **Protocol timestamps stay as unix-millisecond `BIGINT`s**, exactly as
  Sui and the AI service report them, rather than being converted to
  `DATETIME`. Converting loses the source's own notion of time and makes
  staleness comparisons against on-chain values subtly wrong. The
  database's own insert time is a separate `recorded_at` column.
- **Ratios and money use `DECIMAL`, never `FLOAT`.** Binary floats lose
  cents, and several of these columns are notionals.
- **`thetanuts_iv` is nullable, and null means something.** Null is "no
  live Thetanuts signal for that cycle"; `0` is "signal present, read as
  calm". The AI service is careful about that distinction and the schema
  preserves it rather than collapsing both to zero.
- **`egsi_snapshot` has a unique key on `(market, block_number)`** and
  writes use `ON DUPLICATE KEY UPDATE`. The gateway polls faster than
  Ethereum produces blocks, so re-seeing the same block is the normal
  case, not an error.
- **`hedge_evaluation.approved` is nullable on purpose.** Null means the
  evaluation stopped before a final decision was reachable (exposure
  within threshold, or no market-maker offers arrived) — genuinely
  different from an explicit `false`.
- **`hedge_evaluation.executed` is always 0 in this build.** The gateway
  stops at the approval step and never settles a quotation. The column
  exists so that if execution is ever added, the audit trail can
  distinguish "approved" from "actually traded" without a migration.
- **Writes are best-effort and never fail a request.** A trader should
  not get a 500 because an audit table was briefly unreachable; the
  request's real work has already succeeded by the time persistence is
  attempted. Reads propagate errors normally.

## Tests

`api/tests/db.test.ts` runs against a **real** MySQL/MariaDB server —
mocking a database would happily accept SQL a real server rejects, which
defeats the point. It skips automatically when
`GASX_TEST_DATABASE_URL` is unset, so the default `npm test` needs no
database.

```bash
mysql -e "CREATE DATABASE IF NOT EXISTS gasx_test;"
mysql gasx_test < database/migrations/001_initial_schema.sql
cd api && GASX_TEST_DATABASE_URL=mysql://gasx:gasx@127.0.0.1:3306/gasx_test npm test
```

All 14 of these were run against a real MariaDB 10.11 server while the
schema was being written — including the idempotency, null-versus-zero,
signed-value and foreign-key behaviours described above.
