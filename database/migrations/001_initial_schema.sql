-- GASX schema, MySQL 8.
--
-- Scope follows ARCHITECTURE.md §2: the API gateway is the only client
-- ("Storage | Durable state; live EGSI/orderbook cached in API memory"),
-- and the gateway also owns "indexing", so indexed chain events live
-- here too.
--
-- Not every table below is populated yet. The ones fed by an existing
-- data source are marked LIVE; the ones waiting on the unbuilt indexer
-- are marked PENDING. They are created together so the schema is one
-- coherent artifact rather than something that grows a table at a time,
-- but do not mistake a PENDING table's existence for it having data.
--
-- Conventions:
--   * InnoDB + utf8mb4 throughout, with utf8mb4_unicode_ci rather than
--     MySQL 8's default utf8mb4_0900_ai_ci: the latter does not exist in
--     MariaDB, which is what `apt install mysql-server` gives you on some
--     distributions. utf8mb4_unicode_ci works on MySQL 5.7+, MySQL 8 and
--     MariaDB alike, and nothing here depends on the newer collation's
--     behaviour.
--   * Chain/protocol timestamps are stored as unix-millisecond
--     BIGINTs, exactly as Sui and the AI service report them — not
--     converted to DATETIME, because converting loses the source's own
--     notion of time and makes staleness comparisons against on-chain
--     values subtly wrong.
--   * `recorded_at` is this database's own wall-clock insert time, kept
--     separate from those protocol timestamps for the same reason.
--   * Money-ish and ratio values use DECIMAL, never FLOAT — binary
--     floats silently lose cents.

CREATE TABLE IF NOT EXISTS egsi_snapshot (
  -- LIVE: written by the gateway every time it reads a new EGSI value
  -- from the AI service. This is the durable history that
  -- ai/inference/train.py needs in order to train on anything other
  -- than synthetic data.
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  market          VARCHAR(32)     NOT NULL,
  score           SMALLINT UNSIGNED NOT NULL,
  block_number    BIGINT UNSIGNED NOT NULL,
  -- Source timestamp from the Ethereum block, unix SECONDS (the AI
  -- service reports it that way; see ai/schemas.py RawEthereumMetrics).
  block_timestamp BIGINT UNSIGNED NOT NULL,

  -- The six chain-derived components, each normalized 0..1
  -- (ARCHITECTURE.md §3). DECIMAL(6,5) holds 0.00000-9.99999, which
  -- covers the range with room to notice if something ever exceeds it.
  base_fee         DECIMAL(6,5) NOT NULL,
  utilization      DECIMAL(6,5) NOT NULL,
  mempool_pressure DECIMAL(6,5) NOT NULL,
  fee_momentum     DECIMAL(6,5) NOT NULL,
  gas_volatility   DECIMAL(6,5) NOT NULL,
  dex_activity     DECIMAL(6,5) NOT NULL,
  -- NULL when no live Thetanuts signal was available for that cycle.
  -- Distinct from 0.0, which means "signal present, read as calm" —
  -- the AI service is careful about this distinction and the schema
  -- preserves it rather than collapsing both to zero.
  thetanuts_iv     DECIMAL(6,5) NULL,
  -- Skew is not part of EGSI's own formula (§3 lists only IV) but is a
  -- forecast feature (§4), so it is stored alongside. Signed.
  thetanuts_skew   DECIMAL(7,5) NULL,

  recorded_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  -- The gateway polls on a timer and will re-read the same block
  -- repeatedly between AI cycles; this makes those writes idempotent
  -- instead of filling the table with duplicates.
  UNIQUE KEY uq_egsi_market_block (market, block_number),
  KEY idx_egsi_recorded (market, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS forecast (
  -- LIVE: written alongside each snapshot when the AI service returns
  -- a forecast. Kept in its own table rather than as columns on
  -- egsi_snapshot because a forecast can be absent (AI service down,
  -- no model loaded) while the snapshot is still perfectly good.
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  market         VARCHAR(32)  NOT NULL,
  expected_egsi  DECIMAL(7,2) NOT NULL,
  confidence     DECIMAL(5,4) NOT NULL,
  p_tail_500     DECIMAL(5,4) NOT NULL,
  model_version  VARCHAR(64)  NOT NULL,
  -- The snapshot this forecast was issued against, when one is known.
  -- ON DELETE SET NULL: pruning old snapshots should not silently
  -- delete the forecast record that referenced them.
  egsi_snapshot_id BIGINT UNSIGNED NULL,
  recorded_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_forecast_recorded (market, recorded_at),
  CONSTRAINT fk_forecast_snapshot FOREIGN KEY (egsi_snapshot_id)
    REFERENCES egsi_snapshot (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hedge_evaluation (
  -- LIVE: written by POST /api/v1/hedge/evaluate. This is the audit
  -- trail for ARCHITECTURE.md §8 — "AI can request an action. It
  -- cannot bypass policy." A policy guarantee that leaves no record is
  -- hard to verify after the fact, so every evaluation is recorded,
  -- including the ones that were rejected and especially why.
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,

  -- Inputs.
  net_contracts     INT          NOT NULL,
  egsi_level        SMALLINT UNSIGNED NOT NULL,
  egsi_notional     DECIMAL(20,2) NOT NULL,
  eth_beta_notional DECIMAL(20,2) NOT NULL,
  breached          TINYINT(1)   NOT NULL,
  suggested_option_type ENUM('CALL','PUT') NULL,

  -- The confidence reading the decision was made against, if one was
  -- available (a missing forecast fails the evaluation closed).
  model_confidence  DECIMAL(5,4) NULL,

  -- RFQ + best offer, when the evaluation got that far.
  quotation_id      VARCHAR(80)   NULL,
  rfq_tx_hash       VARCHAR(80)   NULL,
  offeror           VARCHAR(80)   NULL,
  price_per_contract DECIMAL(20,6) NULL,
  quoted_notional   DECIMAL(20,6) NULL,

  -- Outcome. `approved` NULL means the evaluation stopped before a
  -- final approve/reject decision was reachable (within threshold, or
  -- no offers arrived) — distinct from an explicit false.
  approved          TINYINT(1)   NULL,
  reason            VARCHAR(500) NULL,
  -- Always 0 in this build: the gateway stops at the approval step and
  -- never settles a quotation (see api/src/routes/hedge.ts). The column
  -- exists so that if execution is ever added, the audit trail can
  -- distinguish "approved" from "actually traded" without a migration.
  executed          TINYINT(1)   NOT NULL DEFAULT 0,

  recorded_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_hedge_recorded (recorded_at),
  KEY idx_hedge_quotation (quotation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS prepared_order (
  -- LIVE (partially): written by POST /api/v1/orders/prepare. The
  -- gateway knows what it prepared and whether its own risk checks
  -- passed, but NOT whether the user's wallet went on to sign and
  -- execute it — that only becomes knowable through the indexer. So
  -- `outcome` starts as 'prepared'/'rejected' and only ever reaches
  -- 'executed' once trade_event exists to confirm it.
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trader          VARCHAR(80)  NOT NULL,
  margin_account  VARCHAR(80)  NOT NULL,
  is_bid          TINYINT(1)   NOT NULL,
  price           BIGINT UNSIGNED NOT NULL,
  quantity        BIGINT UNSIGNED NOT NULL,
  outcome         ENUM('prepared','rejected','executed') NOT NULL,
  -- Which risk rule rejected it, when it was rejected.
  reject_reason   VARCHAR(500) NULL,
  recorded_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_prepared_trader (trader, recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_event (
  -- PENDING: no writer exists. ARCHITECTURE.md §9's "S-->>I: Trade
  -- events" step needs an indexer subscribing to Sui events, and
  -- indexer/ is still an empty scaffold. Schema is defined so the
  -- indexer has a target to write into.
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tx_digest     VARCHAR(80)  NOT NULL,
  event_seq     INT UNSIGNED NOT NULL,
  market_id     VARCHAR(80)  NOT NULL,
  maker         VARCHAR(80)  NOT NULL,
  taker         VARCHAR(80)  NOT NULL,
  price         BIGINT UNSIGNED NOT NULL,
  quantity      BIGINT UNSIGNED NOT NULL,
  chain_timestamp_ms BIGINT UNSIGNED NOT NULL,
  recorded_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  -- An indexer replaying from a checkpoint will re-deliver events; this
  -- makes reprocessing safe.
  UNIQUE KEY uq_trade_event (tx_digest, event_seq),
  KEY idx_trade_market (market_id, chain_timestamp_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS position_snapshot (
  -- PENDING: same reason as trade_event. Once populated this is what
  -- would let the hedge flow read a real net position instead of
  -- asking the user to type one (see api/src/exposure.ts's caveat 2).
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  market_id     VARCHAR(80)  NOT NULL,
  trader        VARCHAR(80)  NOT NULL,
  -- Signed: positive is net long, negative is net short.
  net_contracts BIGINT       NOT NULL,
  entry_price   BIGINT UNSIGNED NOT NULL,
  chain_timestamp_ms BIGINT UNSIGNED NOT NULL,
  recorded_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_position_market_trader (market_id, trader),
  KEY idx_position_trader (trader)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
