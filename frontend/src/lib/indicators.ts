/**
 * Technical indicators, computed client-side from the candle series.
 *
 * These are the standard textbook definitions, not approximations —
 * Wilder's smoothing for RSI, EMA-based MACD, population standard
 * deviation for Bollinger. A trader reading "RSI 14" expects a specific
 * number, and quietly using a simpler formula would make the panel
 * subtly wrong in a way nobody would catch.
 *
 * Every function returns an array aligned index-for-index with its
 * input, using `null` for leading positions where the indicator is not
 * yet defined. That keeps charting straightforward — a null is a gap,
 * not a zero that would draw a misleading line to the axis.
 *
 * A caveat that matters for how these should be read here: indicators
 * were designed for traded prices, where volume and participants create
 * the mean-reversion and momentum they detect. EGSI is a computed
 * congestion index, not a traded price. RSI on it is still a legitimate
 * normalised momentum measure, but "overbought" carries none of its
 * usual meaning, because nobody is buying anything.
 */

export type Series = (number | null)[];

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  if (period < 1) throw new Error('period must be at least 1');
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first
 * `period` values — the conventional seeding, so results match what
 * charting packages produce. */
export function ema(values: number[], period: number): Series {
  if (period < 1) throw new Error('period must be at least 1');
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing (not a simple
 * average of gains and losses, which is the common shortcut and gives
 * visibly different values).
 */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    // Wilder's smoothing: a running average weighted 1/period.
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD: fast EMA minus slow EMA, with an EMA of that as the signal. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Series = values.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i]! - slowEma[i]! : null,
  );

  // The signal EMA runs over the MACD line's defined portion only,
  // then is mapped back to the original indices. Feeding nulls in as
  // zeros would drag the early signal toward zero and misdraw the
  // histogram.
  const defined = macdLine.filter((v): v is number => v !== null);
  const signalDefined = ema(defined, signalPeriod);
  const offset = macdLine.findIndex((v) => v !== null);

  const signal: Series = new Array(values.length).fill(null);
  if (offset >= 0) {
    for (let i = 0; i < signalDefined.length; i++) signal[offset + i] = signalDefined[i]!;
  }

  const histogram: Series = values.map((_, i) =>
    macdLine[i] !== null && signal[i] !== null ? macdLine[i]! - signal[i]! : null,
  );
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  middle: Series;
  upper: Series;
  lower: Series;
}

/** Bollinger Bands: SMA with population standard deviation bands. */
export function bollinger(values: number[], period = 20, deviations = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const variance = window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + deviations * sd;
    lower[i] = mean - deviations * sd;
  }
  return { middle, upper, lower };
}

/** Percent change between the first and last value, for a ticker. */
export function percentChange(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

/**
 * A plain-language read of the current indicator state.
 *
 * Deliberately conservative, and deliberately not called a
 * recommendation. It summarises where price sits relative to its own
 * moving averages and momentum; it is not a claim about what happens
 * next, and on a congestion index rather than a traded price the usual
 * interpretations are weaker still.
 */
export function summarise(values: number[]): { label: string; tone: 'up' | 'down' | 'flat' } {
  if (values.length < 30) return { label: 'Insufficient history', tone: 'flat' };

  const last = values[values.length - 1]!;
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const momentum = rsi(values, 14);

  // `?? null` because noUncheckedIndexedAccess makes an index read
  // possibly-undefined, which is a distinct case from the explicit null
  // these series use for "not yet defined".
  const f = fast[fast.length - 1] ?? null;
  const s = slow[slow.length - 1] ?? null;
  const r = momentum[momentum.length - 1] ?? null;
  if (f === null || s === null || r === null) return { label: 'Insufficient history', tone: 'flat' };

  const trendUp = f > s && last > s;
  const trendDown = f < s && last < s;

  if (trendUp && r > 55) return { label: 'Congestion trending up', tone: 'up' };
  if (trendDown && r < 45) return { label: 'Congestion easing', tone: 'down' };
  if (r > 70) return { label: 'Stretched high', tone: 'up' };
  if (r < 30) return { label: 'Stretched low', tone: 'down' };
  return { label: 'Range-bound', tone: 'flat' };
}
