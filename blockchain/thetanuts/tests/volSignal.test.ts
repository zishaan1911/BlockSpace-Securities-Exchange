import { describe, expect, it } from 'vitest';
import type { OrderWithSignature } from '@thetanuts-finance/thetanuts-client';
import { computeVolSignal } from '../src/volSignal.js';

const ETH_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const BTC_FEED = '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F';
const NOW = 1_700_000_000;

function makeOrder(overrides: {
  priceFeed?: string;
  isCall?: boolean;
  strike?: number;
  expiry?: number;
  iv?: number;
  delta?: number;
  multiLeg?: boolean;
  noGreeks?: boolean;
}): OrderWithSignature {
  const {
    priceFeed = ETH_FEED,
    isCall = false,
    strike = 2000,
    expiry = NOW + 7 * 86400,
    iv = 0.65,
    delta = -0.25,
    multiLeg = false,
    noGreeks = false,
  } = overrides;

  return {
    order: {
      maker: '0x0000000000000000000000000000000000000001',
      taker: '0x0000000000000000000000000000000000000000',
      option: '',
      isBuyer: false,
      numContracts: 1n,
      price: 0n,
      expiry: BigInt(expiry),
      nonce: 0n,
    },
    signature: '0x',
    availableAmount: 1n,
    makerAddress: '0x0000000000000000000000000000000000000001',
    rawApiData: {
      collateral: '0x0000000000000000000000000000000000000002',
      priceFeed,
      implementation: '0x0000000000000000000000000000000000000003',
      strikes: multiLeg ? [String(strike * 1e8), String((strike + 100) * 1e8)] : [String(strike * 1e8)],
      isCall,
      isLong: false,
      orderExpiryTimestamp: expiry,
      extraOptionData: '0x',
      maxCollateralUsable: '0',
      greeks: noGreeks ? undefined : { delta, iv, gamma: 0, theta: 0, vega: 0 },
    },
  };
}

describe('computeVolSignal', () => {
  it('returns null when no orders are usable', () => {
    const result = computeVolSignal([], 'ETH', 2000, ETH_FEED, NOW);
    expect(result).toBeNull();
  });

  it('returns null when orders exist but none carry greeks', () => {
    const orders = [makeOrder({ noGreeks: true })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result).toBeNull();
  });

  it('ignores orders for a different underlying (price feed mismatch)', () => {
    const orders = [makeOrder({ priceFeed: BTC_FEED })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result).toBeNull();
  });

  it('ignores expired orders', () => {
    const orders = [makeOrder({ expiry: NOW - 100 })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result).toBeNull();
  });

  it('ignores multi-leg orders (spreads etc.)', () => {
    const orders = [makeOrder({ multiLeg: true })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result).toBeNull();
  });

  it('picks the ATM strike closest to the underlying price', () => {
    const orders = [
      makeOrder({ strike: 1500, iv: 0.5, delta: -0.1 }),
      makeOrder({ strike: 2000, iv: 0.6, delta: -0.5 }), // closest to spot=2050
      makeOrder({ strike: 3000, iv: 0.9, delta: -0.05 }),
    ];
    const result = computeVolSignal(orders, 'ETH', 2050, ETH_FEED, NOW);
    expect(result?.atmIv).toBe(0.6);
  });

  it('picks the nearest future expiry when multiple are present', () => {
    const nearExpiry = NOW + 3 * 86400;
    const farExpiry = NOW + 30 * 86400;
    const orders = [
      makeOrder({ expiry: nearExpiry, strike: 2000, iv: 0.55 }),
      makeOrder({ expiry: farExpiry, strike: 2000, iv: 0.75 }),
    ];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result?.expiry).toBe(nearExpiry);
    expect(result?.atmIv).toBe(0.55);
  });

  it('computes skew as put IV minus call IV at the closest-to-25-delta legs', () => {
    const orders = [
      makeOrder({ isCall: false, delta: -0.25, iv: 0.7, strike: 1800 }), // exact 25-delta put
      makeOrder({ isCall: true, delta: 0.25, iv: 0.6, strike: 2200 }), // exact 25-delta call
      makeOrder({ isCall: false, delta: -0.5, iv: 0.65, strike: 2000 }), // ATM-ish, ignored for skew
    ];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result?.skew25Delta).toBeCloseTo(0.7 - 0.6, 10);
  });

  it('picks the delta closest to the 25-delta target, not just any put/call', () => {
    const orders = [
      makeOrder({ isCall: false, delta: -0.5, iv: 0.8, strike: 2000 }), // far from -0.25
      makeOrder({ isCall: false, delta: -0.22, iv: 0.68, strike: 1900 }), // closer to -0.25
      makeOrder({ isCall: true, delta: 0.3, iv: 0.55, strike: 2100 }),
    ];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result?.skew25Delta).toBeCloseTo(0.68 - 0.55, 10);
  });

  it('returns skew of 0 when only puts (no calls) are available', () => {
    const orders = [makeOrder({ isCall: false, delta: -0.25, iv: 0.7, strike: 2000 })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result?.skew25Delta).toBe(0);
  });

  it('reports sampleSize as the count of usable orders at the chosen expiry', () => {
    const orders = [
      makeOrder({ strike: 1900 }),
      makeOrder({ strike: 2000 }),
      makeOrder({ strike: 2100 }),
    ];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED, NOW);
    expect(result?.sampleSize).toBe(3);
  });

  it('is case-insensitive when matching the price feed address', () => {
    const orders = [makeOrder({ priceFeed: ETH_FEED.toUpperCase() })];
    const result = computeVolSignal(orders, 'ETH', 2000, ETH_FEED.toLowerCase(), NOW);
    expect(result).not.toBeNull();
  });

  it('preserves the underlying and underlyingPrice passed in', () => {
    const orders = [makeOrder({})];
    const result = computeVolSignal(orders, 'ETH', 2345, ETH_FEED, NOW);
    expect(result?.underlying).toBe('ETH');
    expect(result?.underlyingPrice).toBe(2345);
  });
});
