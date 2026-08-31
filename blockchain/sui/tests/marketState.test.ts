import { describe, expect, it } from 'vitest';
import { parseMarketFields, parseOracleFields } from '../src/marketState.js';

describe('parseMarketFields', () => {
  const baseFields = {
    underlying: 'EGSI-1H',
    expiry_ms: '1700000000000',
    contract_multiplier: '10',
    tick_size: '1',
    margin_ratio_bps: '1000',
    paused: false,
    settled: false,
    settlement_price: '0',
    oracle_id: { id: '0xoracle123' },
  };

  it('parses all fields with u64s given as decimal strings', () => {
    const result = parseMarketFields(baseFields);
    expect(result.underlying).toBe('EGSI-1H');
    expect(result.expiryMs).toBe(1700000000000);
    expect(result.contractMultiplier).toBe(10);
    expect(result.tickSize).toBe(1);
    expect(result.marginRatioBps).toBe(1000);
    expect(result.paused).toBe(false);
    expect(result.settled).toBe(false);
    expect(result.oracleId).toBe('0xoracle123');
  });

  it('accepts u64s given as plain numbers too', () => {
    const result = parseMarketFields({ ...baseFields, expiry_ms: 1700000000000, contract_multiplier: 10 });
    expect(result.expiryMs).toBe(1700000000000);
    expect(result.contractMultiplier).toBe(10);
  });

  it('accepts oracle_id given as a bare string (not wrapped in {id})', () => {
    const result = parseMarketFields({ ...baseFields, oracle_id: '0xoracle123' });
    expect(result.oracleId).toBe('0xoracle123');
  });

  it('leaves settlementPrice null when the market is not settled', () => {
    const result = parseMarketFields({ ...baseFields, settled: false, settlement_price: '999' });
    expect(result.settlementPrice).toBeNull();
  });

  it('reads settlementPrice when the market is settled', () => {
    const result = parseMarketFields({ ...baseFields, settled: true, settlement_price: '487' });
    expect(result.settlementPrice).toBe(487);
  });

  it('throws with a clear message when a required field is missing', () => {
    const { underlying: _drop, ...withoutUnderlying } = baseFields;
    expect(() => parseMarketFields(withoutUnderlying)).toThrow(/underlying/);
  });

  it('throws when a bool field is given as a string instead', () => {
    expect(() => parseMarketFields({ ...baseFields, paused: 'false' })).toThrow(/paused/);
  });
});

describe('parseOracleFields', () => {
  const baseFields = {
    price: '441',
    has_price: true,
    last_update_ms: '1700000000000',
    max_staleness_ms: '60000',
  };

  it('parses all fields', () => {
    const result = parseOracleFields(baseFields, 1700000000000);
    expect(result.price).toBe(441);
    expect(result.hasPrice).toBe(true);
    expect(result.lastUpdateMs).toBe(1700000000000);
    expect(result.maxStalenessMs).toBe(60000);
  });

  it('reads isFreshApprox true when within the staleness window', () => {
    const result = parseOracleFields(baseFields, 1700000000000 + 30000); // 30s later, window is 60s
    expect(result.isFreshApprox).toBe(true);
  });

  it('reads isFreshApprox false when past the staleness window', () => {
    const result = parseOracleFields(baseFields, 1700000000000 + 90000); // 90s later, window is 60s
    expect(result.isFreshApprox).toBe(false);
  });

  it('reads isFreshApprox false when has_price is false regardless of timing', () => {
    const result = parseOracleFields({ ...baseFields, has_price: false }, 1700000000000);
    expect(result.isFreshApprox).toBe(false);
  });

  it('defaults nowMs to the real clock when omitted', () => {
    const recentFields = {
      ...baseFields,
      last_update_ms: String(Date.now()),
      max_staleness_ms: '3600000', // 1 hour
    };
    const result = parseOracleFields(recentFields);
    expect(result.isFreshApprox).toBe(true);
  });
});
