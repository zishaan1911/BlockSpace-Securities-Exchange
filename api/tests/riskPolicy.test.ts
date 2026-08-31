import { describe, expect, it } from 'vitest';
import { checkHedgeRisk, checkOrderRisk, type RiskPolicyConfig } from '../src/riskPolicy.js';

const policy: RiskPolicyConfig = {
  maxOrderContracts: 100,
  maxPositionContracts: 500,
  maxSlippageBps: 100, // 1%
  minModelConfidence: 0.7,
  maxHedgeNotional: 1000,
};

function baseOrder() {
  return {
    price: 500,
    quantity: 10,
    tickSize: 10,
    marketPaused: false,
    marketSettled: false,
  };
}

describe('checkOrderRisk', () => {
  it('accepts a valid order within all limits', () => {
    const result = checkOrderRisk(baseOrder(), policy);
    expect(result.accepted).toBe(true);
  });

  it('rejects when the market is paused', () => {
    const result = checkOrderRisk({ ...baseOrder(), marketPaused: true }, policy);
    expect(result).toEqual({ accepted: false, reason: 'market is paused' });
  });

  it('rejects when the market is already settled', () => {
    const result = checkOrderRisk({ ...baseOrder(), marketSettled: true }, policy);
    expect(result).toEqual({ accepted: false, reason: 'market is already settled' });
  });

  it('rejects a non-positive price', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 0 }, policy);
    expect(result.accepted).toBe(false);
  });

  it('rejects a non-integer price', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 500.5 }, policy);
    expect(result.accepted).toBe(false);
  });

  it('rejects a non-positive quantity', () => {
    const result = checkOrderRisk({ ...baseOrder(), quantity: -1 }, policy);
    expect(result.accepted).toBe(false);
  });

  it('rejects a price not aligned to the tick size', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 505, tickSize: 10 }, policy);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toMatch(/tick size/);
  });

  it('accepts a price that is exactly a multiple of the tick size', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 510, tickSize: 10 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('skips the tick check entirely when tickSize is 0', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 503, tickSize: 0 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('rejects quantity exceeding MAX_ORDER_CONTRACTS', () => {
    const result = checkOrderRisk({ ...baseOrder(), quantity: 101 }, policy);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toMatch(/MAX_ORDER_CONTRACTS/);
  });

  it('accepts quantity exactly at MAX_ORDER_CONTRACTS', () => {
    const result = checkOrderRisk({ ...baseOrder(), quantity: 100 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('rejects a price too far from the reference price (MAX_SLIPPAGE)', () => {
    // 1% max slippage; price 10% away from a 500 reference should fail.
    const result = checkOrderRisk({ ...baseOrder(), price: 550, referencePrice: 500 }, policy);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toMatch(/MAX_SLIPPAGE/);
  });

  it('accepts a price within MAX_SLIPPAGE of the reference price', () => {
    // 501 vs 500 reference is 20 bps, well under the 100 bps cap.
    const result = checkOrderRisk({ ...baseOrder(), price: 501, tickSize: 1, referencePrice: 500 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('skips the slippage check entirely when no reference price is supplied', () => {
    const result = checkOrderRisk({ ...baseOrder(), price: 900, tickSize: 1 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('skips the slippage check when maxSlippageBps is 0', () => {
    const noSlippageLimit: RiskPolicyConfig = { ...policy, maxSlippageBps: 0 };
    const result = checkOrderRisk({ ...baseOrder(), price: 900, tickSize: 1, referencePrice: 500 }, noSlippageLimit);
    expect(result.accepted).toBe(true);
  });

  it('rejects a non-positive reference price when one is supplied', () => {
    const result = checkOrderRisk({ ...baseOrder(), referencePrice: 0 }, policy);
    expect(result.accepted).toBe(false);
  });
});

describe('checkHedgeRisk', () => {
  it('accepts a hedge within confidence and notional limits', () => {
    const result = checkHedgeRisk({ notional: 500, modelConfidence: 0.85 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('rejects a non-positive notional', () => {
    const result = checkHedgeRisk({ notional: 0, modelConfidence: 0.9 }, policy);
    expect(result.accepted).toBe(false);
  });

  it('rejects confidence below MIN_MODEL_CONFIDENCE', () => {
    const result = checkHedgeRisk({ notional: 500, modelConfidence: 0.5 }, policy);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toMatch(/MIN_MODEL_CONFIDENCE/);
  });

  it('accepts confidence exactly at MIN_MODEL_CONFIDENCE', () => {
    const result = checkHedgeRisk({ notional: 500, modelConfidence: 0.7 }, policy);
    expect(result.accepted).toBe(true);
  });

  it('rejects notional exceeding MAX_HEDGE_NOTIONAL', () => {
    const result = checkHedgeRisk({ notional: 1001, modelConfidence: 0.9 }, policy);
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.reason).toMatch(/MAX_HEDGE_NOTIONAL/);
  });

  it('accepts notional exactly at MAX_HEDGE_NOTIONAL', () => {
    const result = checkHedgeRisk({ notional: 1000, modelConfidence: 0.9 }, policy);
    expect(result.accepted).toBe(true);
  });
});
