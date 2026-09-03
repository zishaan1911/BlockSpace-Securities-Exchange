/**
 * MySQL access for the API gateway — the only service that talks to the
 * database (ARCHITECTURE.md §2: the gateway owns "indexing", and Storage
 * holds "durable state; live EGSI/orderbook cached in API memory").
 *
 * Two deliberate design points:
 *
 * 1. **Persistence never fails a request.** Every write here is
 *    best-effort: it logs and swallows on error rather than throwing.
 *    A trader placing an order, or an operator evaluating a hedge,
 *    should not get a 500 because the audit table was briefly
 *    unreachable. The request's own work has already succeeded by the
 *    time these are called. Reads are separate — those propagate, since
 *    a caller asking for history explicitly wants to know if it failed.
 *
 * 2. **The database is optional.** With no GASX_API_DATABASE_URL
 *    configured, `createDatabase` returns null and the gateway runs
 *    exactly as before, just without durable state. That keeps the
 *    dev-market path (blockchain/sui's devMarket.ts) working with no
 *    MySQL install at all.
 */
import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

export interface EgsiSnapshotRow {
  market: string;
  score: number;
  blockNumber: number;
  blockTimestamp: number;
  baseFee: number;
  utilization: number;
  mempoolPressure: number;
  feeMomentum: number;
  gasVolatility: number;
  dexActivity: number;
  thetanutsIv: number | null;
  thetanutsSkew: number | null;
}

/** One OHLC bar. `time` is the bucket's start, unix seconds — the unit
 * TradingView's lightweight-charts expects. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Readings in the bucket. EGSI has no traded volume, so this is
   * sample count — useful for spotting thin buckets, and honestly named
   * rather than dressed up as volume. */
  samples: number;
}

export interface ForecastRow {
  market: string;
  expectedEgsi: number;
  confidence: number;
  pTail500: number;
  modelVersion: string;
}

export interface HedgeEvaluationRow {
  netContracts: number;
  egsiLevel: number;
  egsiNotional: number;
  ethBetaNotional: number;
  breached: boolean;
  suggestedOptionType: 'CALL' | 'PUT' | null;
  modelConfidence: number | null;
  quotationId: string | null;
  rfqTxHash: string | null;
  offeror: string | null;
  pricePerContract: number | null;
  quotedNotional: number | null;
  approved: boolean | null;
  reason: string | null;
}

export interface PreparedOrderRow {
  trader: string;
  marginAccount: string;
  isBid: boolean;
  price: number;
  quantity: number;
  outcome: 'prepared' | 'rejected';
  rejectReason: string | null;
}

export interface Database {
  recordEgsiSnapshot(row: EgsiSnapshotRow): Promise<number | null>;
  recordForecast(row: ForecastRow, snapshotId: number | null): Promise<void>;
  recordHedgeEvaluation(row: HedgeEvaluationRow): Promise<void>;
  recordPreparedOrder(row: PreparedOrderRow): Promise<void>;
  /** Durable EGSI history, oldest first — what ai/inference/train.py
   * needs in order to train on real data rather than synthetic. */
  getEgsiHistory(market: string, limit: number): Promise<EgsiSnapshotRow[]>;
  /** EGSI aggregated into OHLC candles for charting. */
  getEgsiCandles(market: string, intervalSeconds: number, limit: number): Promise<Candle[]>;
  close(): Promise<void>;
}

type Logger = { error: (msg: string) => void };

export class MysqlDatabase implements Database {
  constructor(
    private readonly pool: Pool,
    private readonly log: Logger,
  ) {}

  /** Returns the row id so a forecast can be linked to it, or null if
   * the write failed (in which case the forecast is stored unlinked
   * rather than lost). */
  async recordEgsiSnapshot(row: EgsiSnapshotRow): Promise<number | null> {
    try {
      // ON DUPLICATE KEY: the gateway polls faster than the AI service
      // produces new blocks, so re-seeing the same block is the normal
      // case, not an error. Touching score keeps the row current if a
      // recomputation changed it.
      const [result] = await this.pool.execute(
        `INSERT INTO egsi_snapshot
           (market, score, block_number, block_timestamp, base_fee, utilization,
            mempool_pressure, fee_momentum, gas_volatility, dex_activity,
            thetanuts_iv, thetanuts_skew)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), score = VALUES(score)`,
        [
          row.market,
          row.score,
          row.blockNumber,
          row.blockTimestamp,
          row.baseFee,
          row.utilization,
          row.mempoolPressure,
          row.feeMomentum,
          row.gasVolatility,
          row.dexActivity,
          row.thetanutsIv,
          row.thetanutsSkew,
        ],
      );
      return (result as mysql.ResultSetHeader).insertId || null;
    } catch (err) {
      this.log.error(`failed to record EGSI snapshot: ${(err as Error).message}`);
      return null;
    }
  }

  async recordForecast(row: ForecastRow, snapshotId: number | null): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO forecast
           (market, expected_egsi, confidence, p_tail_500, model_version, egsi_snapshot_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.market, row.expectedEgsi, row.confidence, row.pTail500, row.modelVersion, snapshotId],
      );
    } catch (err) {
      this.log.error(`failed to record forecast: ${(err as Error).message}`);
    }
  }

  async recordHedgeEvaluation(row: HedgeEvaluationRow): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO hedge_evaluation
           (net_contracts, egsi_level, egsi_notional, eth_beta_notional, breached,
            suggested_option_type, model_confidence, quotation_id, rfq_tx_hash, offeror,
            price_per_contract, quoted_notional, approved, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.netContracts,
          row.egsiLevel,
          row.egsiNotional,
          row.ethBetaNotional,
          row.breached ? 1 : 0,
          row.suggestedOptionType,
          row.modelConfidence,
          row.quotationId,
          row.rfqTxHash,
          row.offeror,
          row.pricePerContract,
          row.quotedNotional,
          row.approved === null ? null : row.approved ? 1 : 0,
          row.reason,
        ],
      );
    } catch (err) {
      this.log.error(`failed to record hedge evaluation: ${(err as Error).message}`);
    }
  }

  async recordPreparedOrder(row: PreparedOrderRow): Promise<void> {
    try {
      await this.pool.execute(
        `INSERT INTO prepared_order
           (trader, margin_account, is_bid, price, quantity, outcome, reject_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          row.trader,
          row.marginAccount,
          row.isBid ? 1 : 0,
          row.price,
          row.quantity,
          row.outcome,
          row.rejectReason,
        ],
      );
    } catch (err) {
      this.log.error(`failed to record prepared order: ${(err as Error).message}`);
    }
  }

  async getEgsiHistory(market: string, limit: number): Promise<EgsiSnapshotRow[]> {
    // LIMIT cannot be a bound parameter in a prepared statement, so it
    // is coerced to a bounded integer and interpolated. Every other
    // value here is still bound.
    const safeLimit = Math.max(1, Math.min(10_000, Math.trunc(limit)));
    const [rows] = await this.pool.query(
      `SELECT market, score, block_number, block_timestamp, base_fee, utilization,
              mempool_pressure, fee_momentum, gas_volatility, dex_activity,
              thetanuts_iv, thetanuts_skew
       FROM egsi_snapshot
       WHERE market = ?
       ORDER BY block_number ASC
       LIMIT ${safeLimit}`,
      [market],
    );
    return (rows as Record<string, unknown>[]).map((r) => ({
      market: String(r.market),
      score: Number(r.score),
      blockNumber: Number(r.block_number),
      blockTimestamp: Number(r.block_timestamp),
      baseFee: Number(r.base_fee),
      utilization: Number(r.utilization),
      mempoolPressure: Number(r.mempool_pressure),
      feeMomentum: Number(r.fee_momentum),
      gasVolatility: Number(r.gas_volatility),
      dexActivity: Number(r.dex_activity),
      thetanutsIv: r.thetanuts_iv === null ? null : Number(r.thetanuts_iv),
      thetanutsSkew: r.thetanuts_skew === null ? null : Number(r.thetanuts_skew),
    }));
  }

  /**
   * Buckets readings into fixed intervals and derives OHLC per bucket.
   *
   * Done in SQL rather than in JS because the alternative is shipping
   * every raw reading to the gateway just to fold it — at 12s cycles a
   * day of history is ~7,000 rows for maybe 100 candles.
   *
   * Open and close use MySQL window functions ordered by block_number,
   * so "first" and "last" mean first and last *by block*, not by
   * whichever row the engine happened to return first.
   */
  async getEgsiCandles(market: string, intervalSeconds: number, limit: number): Promise<Candle[]> {
    const interval = Math.max(1, Math.trunc(intervalSeconds));
    const safeLimit = Math.max(1, Math.min(5_000, Math.trunc(limit)));
    const [rows] = await this.pool.query(
      `SELECT bucket AS time,
              MIN(score) AS low,
              MAX(score) AS high,
              MIN(first_score) AS open,
              MIN(last_score)  AS close,
              COUNT(*) AS samples
       FROM (
         SELECT score,
                FLOOR(block_timestamp / ?) * ? AS bucket,
                FIRST_VALUE(score) OVER w AS first_score,
                LAST_VALUE(score)  OVER w AS last_score
         FROM egsi_snapshot
         WHERE market = ?
         WINDOW w AS (
           PARTITION BY FLOOR(block_timestamp / ?)
           ORDER BY block_number
           ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
         )
       ) AS bucketed
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT ${safeLimit}`,
      [interval, interval, market, interval],
    );
    // Query descending so LIMIT keeps the most RECENT candles, then
    // reverse: charts read oldest-first.
    return (rows as Record<string, unknown>[])
      .map((r) => ({
        time: Number(r.time),
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        samples: Number(r.samples),
      }))
      .reverse();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Returns null when no database is configured — the gateway then runs
 * without durable state rather than refusing to start. */
export function createDatabase(databaseUrl: string | undefined, log: Logger): Database | null {
  if (!databaseUrl) return null;
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    waitForConnections: true,
    // DECIMAL columns come back as strings by default to protect
    // precision. Every DECIMAL here is a ratio or a display figure well
    // within double's exact range, and the app's own types are numbers,
    // so converting at the driver boundary keeps one conversion in one
    // place instead of scattering Number() through the callers.
    decimalNumbers: true,
  });
  return new MysqlDatabase(pool, log);
}
