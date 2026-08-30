import { describe, expect, it } from 'vitest';
import { pickBestCandidate, pricePerContractFromOfferAmount } from '../src/rfqHedge.js';
import type { HedgeCandidate } from '../src/types.js';

function makeCandidate(pricePerContract: number, offeror = '0xoffer'): HedgeCandidate {
  return {
    quotationId: '1',
    offeror,
    pricePerContract,
    raw: { offerAmount: '0', nonce: '0' },
  };
}

describe('pickBestCandidate', () => {
  it('returns null for an empty list', () => {
    expect(pickBestCandidate([], 'BUY')).toBeNull();
  });

  it('returns the only candidate when there is one', () => {
    const only = makeCandidate(0.05);
    expect(pickBestCandidate([only], 'BUY')).toBe(only);
  });

  it('picks the lowest price for BUY (cheapest for the buyer)', () => {
    const cheap = makeCandidate(0.04, 'cheap-mm');
    const expensive = makeCandidate(0.06, 'expensive-mm');
    const result = pickBestCandidate([expensive, cheap], 'BUY');
    expect(result?.offeror).toBe('cheap-mm');
  });

  it('picks the highest price for SELL (most valuable for the seller)', () => {
    const low = makeCandidate(0.03, 'low-mm');
    const high = makeCandidate(0.05, 'high-mm');
    const result = pickBestCandidate([low, high], 'SELL');
    expect(result?.offeror).toBe('high-mm');
  });

  it('handles more than two candidates correctly for BUY', () => {
    const candidates = [makeCandidate(0.05), makeCandidate(0.02, 'winner'), makeCandidate(0.08)];
    const result = pickBestCandidate(candidates, 'BUY');
    expect(result?.offeror).toBe('winner');
  });

  it('handles more than two candidates correctly for SELL', () => {
    const candidates = [makeCandidate(0.05), makeCandidate(0.09, 'winner'), makeCandidate(0.02)];
    const result = pickBestCandidate(candidates, 'SELL');
    expect(result?.offeror).toBe('winner');
  });
});

describe('pricePerContractFromOfferAmount', () => {
  it('converts total USDC (6 decimals) to a per-contract price', () => {
    // 25 USDC total for 10 contracts -> 2.5 USDC/contract
    const result = pricePerContractFromOfferAmount(25_000000n, 10);
    expect(result).toBeCloseTo(2.5, 10);
  });

  it('handles fractional contract counts', () => {
    const result = pricePerContractFromOfferAmount(15_000000n, 1.5);
    expect(result).toBeCloseTo(10, 10);
  });

  it('returns the raw total when numContracts is 0 (avoids division by zero)', () => {
    const result = pricePerContractFromOfferAmount(5_000000n, 0);
    expect(result).toBe(5);
  });

  it('handles a single contract', () => {
    const result = pricePerContractFromOfferAmount(3_500000n, 1);
    expect(result).toBeCloseTo(3.5, 10);
  });
});
