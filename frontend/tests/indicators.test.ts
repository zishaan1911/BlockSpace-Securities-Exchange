import { describe, expect, it } from 'vitest';
import { bollinger, ema, macd, percentChange, rsi, sma, summarise } from '../src/lib/indicators';

/**
 * Wilder's RSI example series, to 2dp.
 *
 * The expected 70.46 is derived by hand from these exact closes rather
 * than copied from a reference: the 14 changes give gains summing to
 * 3.34 and losses to 1.40, so avgGain 0.238571, avgLoss 0.100,
 * RS 2.38571, and RSI = 100 - 100/(1+RS) = 70.464.
 *
 * Worth recording because the commonly quoted figure for "Wilder's
 * example" is 70.53, which comes from a longer version of the series.
 * Asserting that number here would have failed against a correct
 * implementation.
 */
const WILDER = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42,
  45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
];

describe('sma', () => {
  it('is null until the window is full', () => {
    expect(sma([1, 2, 3, 4], 3).slice(0, 2)).toEqual([null, null]);
  });

  it('averages the trailing window', () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it('rejects a period below one', () => {
    expect(() => sma([1, 2], 0)).toThrow();
  });
});

describe('ema', () => {
  it('seeds with the SMA of the first period, as charting packages do', () => {
    const result = ema([1, 2, 3, 4, 5], 3);
    expect(result[2]).toBeCloseTo(2, 10); // (1+2+3)/3
  });

  it('weights recent values more heavily than an SMA does', () => {
    const rising = [1, 1, 1, 1, 10];
    const e = ema(rising, 3)!;
    const s = sma(rising, 3)!;
    expect(e[4]!).toBeGreaterThan(s[4]!);
  });

  it('returns all nulls when there is less data than the period', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });
});

describe('rsi', () => {
  it("matches Wilder's own worked example", () => {
    const result = rsi(WILDER, 14);
    expect(result[14]).toBeCloseTo(70.46, 2);
  });

  it('is null before the period has elapsed', () => {
    expect(rsi(WILDER, 14).slice(0, 14).every((v) => v === null)).toBe(true);
  });

  it('reads 100 when every change is a gain', () => {
    const result = rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(result[15]).toBe(100);
  });

  it('stays within 0 and 100', () => {
    const noisy = Array.from({ length: 80 }, (_, i) => 300 + Math.sin(i / 3) * 90);
    for (const v of rsi(noisy, 14)) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('macd', () => {
  const rising = Array.from({ length: 80 }, (_, i) => 100 + i * 2);

  it('is positive when a fast EMA leads a rising series', () => {
    const { macd: line } = macd(rising);
    expect(line[79]).toBeGreaterThan(0);
  });

  it('is negative on a falling series', () => {
    const falling = [...rising].reverse();
    const { macd: line } = macd(falling);
    expect(line[79]).toBeLessThan(0);
  });

  it('keeps histogram equal to macd minus signal', () => {
    const { macd: line, signal, histogram } = macd(rising);
    const i = 79;
    expect(histogram[i]).toBeCloseTo(line[i]! - signal[i]!, 10);
  });

  it('does not let leading nulls drag the signal toward zero', () => {
    // The signal EMA runs only over the defined MACD values; feeding
    // nulls in as zeros would bias it low.
    const { macd: line, signal } = macd(rising);
    const firstDefined = signal.findIndex((v) => v !== null);
    expect(line[firstDefined]).not.toBeNull();
    expect(signal[firstDefined]).toBeGreaterThan(0);
  });
});

describe('bollinger', () => {
  it('collapses the bands onto the mean for a flat series', () => {
    const flat = new Array(30).fill(400);
    const { upper, middle, lower } = bollinger(flat, 20);
    expect(middle[29]).toBe(400);
    expect(upper[29]).toBeCloseTo(400, 10);
    expect(lower[29]).toBeCloseTo(400, 10);
  });

  it('brackets the middle band symmetrically', () => {
    const noisy = Array.from({ length: 60 }, (_, i) => 300 + Math.sin(i) * 50);
    const { upper, middle, lower } = bollinger(noisy, 20);
    const i = 59;
    expect(upper[i]!).toBeGreaterThan(middle[i]!);
    expect(lower[i]!).toBeLessThan(middle[i]!);
    expect(upper[i]! - middle[i]!).toBeCloseTo(middle[i]! - lower[i]!, 8);
  });
});

describe('percentChange', () => {
  it('computes a rise', () => {
    expect(percentChange([100, 150])).toBeCloseTo(50, 10);
  });

  it('computes a fall', () => {
    expect(percentChange([200, 150])).toBeCloseTo(-25, 10);
  });

  it('returns null rather than dividing by zero', () => {
    expect(percentChange([0, 50])).toBeNull();
    expect(percentChange([100])).toBeNull();
  });
});

describe('summarise', () => {
  it('refuses to read anything from too little history', () => {
    expect(summarise([1, 2, 3]).label).toBe('Insufficient history');
  });

  it('reads a strong uptrend as congestion rising', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 4);
    expect(summarise(rising).tone).toBe('up');
  });

  it('reads a sustained downtrend as easing', () => {
    const falling = Array.from({ length: 60 }, (_, i) => 400 - i * 4);
    expect(summarise(falling).tone).toBe('down');
  });

  it('reads a flat series as range-bound', () => {
    const flat = Array.from({ length: 60 }, (_, i) => 300 + (i % 2));
    expect(summarise(flat).tone).toBe('flat');
  });
});
