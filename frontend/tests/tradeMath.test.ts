import { describe, expect, it } from 'vitest';
import { CONTRACT_SCALE, MIN_DISPLAY_QUANTITY, snapToTick } from '../src/components/TradePage';

describe('snapToTick', () => {
  it('rounds to the nearest multiple of the tick size', () => {
    expect(snapToTick(293.4, 1)).toBe(293);
    expect(snapToTick(295, 10)).toBe(300); // rounds up at the midpoint
    expect(snapToTick(294, 10)).toBe(290);
  });

  it('leaves an already-valid price unchanged', () => {
    expect(snapToTick(300, 10)).toBe(300);
    expect(snapToTick(5, 5)).toBe(5);
  });

  it('never returns below one tick, even for zero or negative input', () => {
    expect(snapToTick(0, 10)).toBe(10);
    expect(snapToTick(-50, 10)).toBe(10);
  });

  it('falls back to a tick of 1 when tickSize is not a usable positive number', () => {
    expect(snapToTick(293.7, 0)).toBe(294);
    expect(snapToTick(293.7, Number.NaN)).toBe(294);
    expect(snapToTick(293.7, -5)).toBe(294);
  });

  it('treats a non-finite value as needing at least one tick', () => {
    expect(snapToTick(Number.NaN, 10)).toBe(10);
  });

  it('is idempotent: snapping an already-snapped price is a no-op', () => {
    const once = snapToTick(293.4, 7);
    expect(snapToTick(once, 7)).toBe(once);
  });
});

describe('contract scaling convention', () => {
  it('the minimum display quantity is exactly 0.01 contracts', () => {
    expect(MIN_DISPLAY_QUANTITY).toBeCloseTo(0.01, 10);
    expect(CONTRACT_SCALE).toBe(100);
  });

  it('scales a fractional display quantity up to a whole on-chain integer', () => {
    const toOnChain = (display: number) => Math.max(1, Math.round(display * CONTRACT_SCALE));
    expect(toOnChain(0.01)).toBe(1);
    expect(toOnChain(0.05)).toBe(5);
    expect(toOnChain(1)).toBe(100);
    expect(toOnChain(2.5)).toBe(250);
  });

  it('never sends a zero or negative on-chain quantity even for tiny input', () => {
    const toOnChain = (display: number) => Math.max(1, Math.round(display * CONTRACT_SCALE));
    expect(toOnChain(0)).toBe(1);
    expect(toOnChain(0.001)).toBe(1);
  });
});
