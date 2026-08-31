import { describe, expect, it } from 'vitest';
import {
  bandLabel,
  formatComponent,
  formatConfidence,
  formatNotional,
  gaugeFraction,
  stressBand,
  timeToExpiry,
} from '../src/lib/egsi';

describe('stressBand', () => {
  it('reads a low index as nominal', () => {
    expect(stressBand(0)).toBe('nominal');
    expect(stressBand(499)).toBe('nominal');
  });

  it('reads 500 and up as elevated — the threshold the model forecasts against', () => {
    expect(stressBand(500)).toBe('elevated');
    expect(stressBand(749)).toBe('elevated');
  });

  it('reads 750 and up as critical', () => {
    expect(stressBand(750)).toBe('critical');
    expect(stressBand(1000)).toBe('critical');
  });
});

describe('bandLabel', () => {
  it('gives a plain-language label for every band', () => {
    expect(bandLabel('nominal')).toBe('Running clear');
    expect(bandLabel('elevated')).toBe('Congestion building');
    expect(bandLabel('critical')).toBe('Severe congestion');
  });
});

describe('gaugeFraction', () => {
  it('maps the index onto 0..1', () => {
    expect(gaugeFraction(0)).toBe(0);
    expect(gaugeFraction(500)).toBe(0.5);
    expect(gaugeFraction(1000)).toBe(1);
  });

  it('clamps a reading above the scale so the arc cannot overdraw', () => {
    expect(gaugeFraction(5000)).toBe(1);
  });

  it('clamps a negative reading to zero', () => {
    expect(gaugeFraction(-100)).toBe(0);
  });

  it('treats any non-finite reading as no reading, rather than drawing a misleading arc', () => {
    expect(gaugeFraction(Number.NaN)).toBe(0);
    // Infinity is garbage data, not "maximum stress" — showing an empty
    // gauge is safer than showing a full one.
    expect(gaugeFraction(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatComponent', () => {
  it('renders a 0..1 component score as a whole percentage', () => {
    expect(formatComponent(0)).toBe('0%');
    expect(formatComponent(0.457)).toBe('46%');
    expect(formatComponent(1)).toBe('100%');
  });
});

describe('formatConfidence', () => {
  it('renders confidence as a whole percentage', () => {
    expect(formatConfidence(0.91)).toBe('91%');
  });
});

describe('timeToExpiry', () => {
  const now = 1_700_000_000_000;

  it('renders minutes under an hour', () => {
    expect(timeToExpiry(now + 25 * 60_000, now)).toBe('25m');
  });

  it('renders hours and minutes past an hour', () => {
    expect(timeToExpiry(now + 95 * 60_000, now)).toBe('1h 35m');
  });

  it('returns null once expired, so the UI can say so explicitly', () => {
    expect(timeToExpiry(now - 1, now)).toBeNull();
    expect(timeToExpiry(now, now)).toBeNull();
  });
});

describe('formatNotional', () => {
  it('renders small amounts in whole dollars', () => {
    expect(formatNotional(750)).toBe('$750');
  });

  it('abbreviates thousands', () => {
    expect(formatNotional(25_000)).toBe('$25.0k');
  });

  it('abbreviates millions', () => {
    expect(formatNotional(3_400_000)).toBe('$3.40M');
  });

  it('keeps the sign on a short (negative) exposure', () => {
    expect(formatNotional(-25_000)).toBe('-$25.0k');
  });
});
