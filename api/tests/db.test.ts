/**
 * Database integration tests.
 *
 * These run against a REAL MySQL/MariaDB server, not a mock — a mocked
 * database would happily accept SQL that a real server rejects, which
 * defeats the point of testing the schema at all. They are skipped
 * automatically when GASX_TEST_DATABASE_URL is unset, so the default
 * test run needs no database.
 *
 * To run them:
 *   mysql -e "CREATE DATABASE gasx_test;"
 *   mysql gasx_test < ../database/migrations/001_initial_schema.sql
 *   GASX_TEST_DATABASE_URL=mysql://root@localhost/gasx_test npm test
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { createDatabase, type Database } from '../src/db.js';

const url = process.env.GASX_TEST_DATABASE_URL;
const silentLog = { error: () => {} };

// describe.skipIf keeps this file harmless in environments without a
// database, rather than failing a run for an absent optional dependency.
describe.skipIf(!url)('MysqlDatabase (real server)', () => {
  const db: Database = createDatabase(url, silentLog)!;
  const raw = mysql.createPool({ uri: url!, decimalNumbers: true });

  beforeEach(async () => {
    // forecast references egsi_snapshot, so it goes first.
    await raw.query('DELETE FROM forecast');
    await raw.query('DELETE FROM egsi_snapshot');
    await raw.query('DELETE FROM hedge_evaluation');
    await raw.query('DELETE FROM prepared_order');
  });

  afterAll(async () => {
    await db.close();
    await raw.end();
  });

  function snapshot(overrides: Partial<Parameters<Database['recordEgsiSnapshot']>[0]> = {}) {
    return {
      market: 'EGSI-1H',
      score: 612,
      blockNumber: 21458332,
      blockTimestamp: 1_700_000_000,
      baseFee: 0.72,
      utilization: 0.88,
      mempoolPressure: 0.61,
      feeMomentum: 0.44,
      gasVolatility: 0.29,
      dexActivity: 0.53,
      thetanutsIv: null,
      thetanutsSkew: null,
      ...overrides,
    };
  }

  it('stores a snapshot and reads it back with values intact', async () => {
    await db.recordEgsiSnapshot(snapshot());
    const history = await db.getEgsiHistory('EGSI-1H', 10);

    expect(history).toHaveLength(1);
    expect(history[0]!.score).toBe(612);
    expect(history[0]!.blockNumber).toBe(21458332);
    expect(history[0]!.baseFee).toBeCloseTo(0.72, 5);
  });

  it('returns an id that a forecast can be linked to', async () => {
    const id = await db.recordEgsiSnapshot(snapshot());
    expect(id).toBeGreaterThan(0);

    await db.recordForecast(
      { market: 'EGSI-1H', expectedEgsi: 687.4, confidence: 0.83, pTail500: 0.79, modelVersion: 'egsi-v1' },
      id,
    );

    const [rows] = await raw.query('SELECT egsi_snapshot_id, confidence FROM forecast');
    const row = (rows as Record<string, unknown>[])[0]!;
    expect(Number(row.egsi_snapshot_id)).toBe(id);
    expect(Number(row.confidence)).toBeCloseTo(0.83, 4);
  });

  it('is idempotent on the same block, rather than duplicating rows', async () => {
    const first = await db.recordEgsiSnapshot(snapshot());
    const second = await db.recordEgsiSnapshot(snapshot());

    const history = await db.getEgsiHistory('EGSI-1H', 10);
    expect(history).toHaveLength(1);
    // The same row id comes back, so a forecast written on the second
    // pass still links to the right snapshot.
    expect(second).toBe(first);
  });

  it('updates the score when the same block is re-recorded with a new value', async () => {
    await db.recordEgsiSnapshot(snapshot({ score: 500 }));
    await db.recordEgsiSnapshot(snapshot({ score: 640 }));

    const history = await db.getEgsiHistory('EGSI-1H', 10);
    expect(history).toHaveLength(1);
    expect(history[0]!.score).toBe(640);
  });

  it('preserves a null Thetanuts signal as null, not zero', async () => {
    await db.recordEgsiSnapshot(snapshot({ thetanutsIv: null }));
    const history = await db.getEgsiHistory('EGSI-1H', 10);
    expect(history[0]!.thetanutsIv).toBeNull();
  });

  it('stores a present Thetanuts signal distinctly from an absent one', async () => {
    await db.recordEgsiSnapshot(snapshot({ blockNumber: 1, thetanutsIv: 0, thetanutsSkew: -0.05 }));
    await db.recordEgsiSnapshot(snapshot({ blockNumber: 2, thetanutsIv: null }));

    const history = await db.getEgsiHistory('EGSI-1H', 10);
    expect(history[0]!.thetanutsIv).toBe(0);
    expect(history[0]!.thetanutsSkew).toBeCloseTo(-0.05, 5);
    expect(history[1]!.thetanutsIv).toBeNull();
  });

  it('returns history oldest first, so it can be fed to a model in order', async () => {
    await db.recordEgsiSnapshot(snapshot({ blockNumber: 30, score: 300 }));
    await db.recordEgsiSnapshot(snapshot({ blockNumber: 10, score: 100 }));
    await db.recordEgsiSnapshot(snapshot({ blockNumber: 20, score: 200 }));

    const history = await db.getEgsiHistory('EGSI-1H', 10);
    expect(history.map((h) => h.score)).toEqual([100, 200, 300]);
  });

  it('separates markets', async () => {
    await db.recordEgsiSnapshot(snapshot({ market: 'EGSI-1H', blockNumber: 1 }));
    await db.recordEgsiSnapshot(snapshot({ market: 'OTHER', blockNumber: 1 }));

    expect(await db.getEgsiHistory('EGSI-1H', 10)).toHaveLength(1);
    expect(await db.getEgsiHistory('OTHER', 10)).toHaveLength(1);
  });

  it('records an approved hedge evaluation with its full decision trail', async () => {
    await db.recordHedgeEvaluation({
      netContracts: 10,
      egsiLevel: 500,
      egsiNotional: 50000,
      ethBetaNotional: 25000,
      breached: true,
      suggestedOptionType: 'PUT',
      modelConfidence: 0.83,
      quotationId: '42',
      rfqTxHash: '0xrfq',
      offeror: '0xmm',
      pricePerContract: 50,
      quotedNotional: 50,
      approved: true,
      reason: null,
    });

    const [rows] = await raw.query('SELECT * FROM hedge_evaluation');
    const row = (rows as Record<string, unknown>[])[0]!;
    expect(row.approved).toBe(1);
    expect(row.suggested_option_type).toBe('PUT');
    // Never executed: this build stops at approval.
    expect(row.executed).toBe(0);
  });

  it('records a rejected hedge with the rule that stopped it', async () => {
    await db.recordHedgeEvaluation({
      netContracts: 10,
      egsiLevel: 500,
      egsiNotional: 50000,
      ethBetaNotional: 25000,
      breached: true,
      suggestedOptionType: 'PUT',
      modelConfidence: 0.4,
      quotationId: null,
      rfqTxHash: null,
      offeror: null,
      pricePerContract: null,
      quotedNotional: null,
      approved: false,
      reason: 'model confidence (0.4) is below MIN_MODEL_CONFIDENCE (0.7)',
    });

    const [rows] = await raw.query('SELECT approved, reason FROM hedge_evaluation');
    const row = (rows as Record<string, unknown>[])[0]!;
    expect(row.approved).toBe(0);
    expect(String(row.reason)).toMatch(/MIN_MODEL_CONFIDENCE/);
  });

  it('distinguishes "no decision reached" from an explicit rejection', async () => {
    await db.recordHedgeEvaluation({
      netContracts: 1,
      egsiLevel: 500,
      egsiNotional: 500,
      ethBetaNotional: 250,
      breached: false,
      suggestedOptionType: null,
      modelConfidence: null,
      quotationId: null,
      rfqTxHash: null,
      offeror: null,
      pricePerContract: null,
      quotedNotional: null,
      approved: null,
      reason: 'within threshold',
    });

    const [rows] = await raw.query('SELECT approved FROM hedge_evaluation');
    expect((rows as Record<string, unknown>[])[0]!.approved).toBeNull();
  });

  it('records a negative (net short) exposure without losing the sign', async () => {
    await db.recordHedgeEvaluation({
      netContracts: -10,
      egsiLevel: 500,
      egsiNotional: -50000,
      ethBetaNotional: -25000,
      breached: true,
      suggestedOptionType: 'CALL',
      modelConfidence: 0.9,
      quotationId: null,
      rfqTxHash: null,
      offeror: null,
      pricePerContract: null,
      quotedNotional: null,
      approved: null,
      reason: null,
    });

    const [rows] = await raw.query('SELECT net_contracts, eth_beta_notional FROM hedge_evaluation');
    const row = (rows as Record<string, unknown>[])[0]!;
    expect(Number(row.net_contracts)).toBe(-10);
    expect(Number(row.eth_beta_notional)).toBe(-25000);
  });

  it('records both prepared and rejected orders', async () => {
    await db.recordPreparedOrder({
      trader: '0xt',
      marginAccount: '0xm',
      isBid: true,
      price: 500,
      quantity: 10,
      outcome: 'prepared',
      rejectReason: null,
    });
    await db.recordPreparedOrder({
      trader: '0xt',
      marginAccount: '0xm',
      isBid: false,
      price: 999,
      quantity: 9999,
      outcome: 'rejected',
      rejectReason: 'quantity exceeds MAX_ORDER_CONTRACTS (100)',
    });

    const [rows] = await raw.query('SELECT outcome, reject_reason FROM prepared_order ORDER BY id');
    const list = rows as Record<string, unknown>[];
    expect(list[0]!.outcome).toBe('prepared');
    expect(list[1]!.outcome).toBe('rejected');
    expect(String(list[1]!.reject_reason)).toMatch(/MAX_ORDER_CONTRACTS/);
  });

  it('caps an absurd history limit instead of trusting it', async () => {
    await db.recordEgsiSnapshot(snapshot());
    // Should not throw on a huge or fractional limit.
    await expect(db.getEgsiHistory('EGSI-1H', 10_000_000)).resolves.toHaveLength(1);
    await expect(db.getEgsiHistory('EGSI-1H', 2.7)).resolves.toHaveLength(1);
  });
});
