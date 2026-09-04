export type NullableSeries = Array<number | null>;

function checkPeriod(period: number) {
  if (!Number.isInteger(period) || period < 1) throw new Error('period must be a positive integer');
}

export function sma(values: number[], period: number): NullableSeries {
  checkPeriod(period);
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): NullableSeries {
  checkPeriod(period);
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = seed;
  const k = 2 / (period + 1);
  let prev = seed;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(values: number[], period = 14): NullableSeries {
  checkPeriod(period);
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const d = values[i]! - values[i - 1]!;
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const calc = () => {
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  };
  out[period] = calc();
  for (let i = period + 1; i < values.length; i += 1) {
    const d = values[i]! - values[i - 1]!;
    const gain = Math.max(d, 0);
    const loss = Math.max(-d, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = calc();
  }
  return out;
}

function emaNullable(values: NullableSeries, period: number): NullableSeries {
  const out: NullableSeries = new Array(values.length).fill(null);
  const start = values.findIndex((v) => v !== null);
  if (start < 0) return out;
  const defined: number[] = [];
  const indices: number[] = [];
  for (let i = start; i < values.length; i += 1) {
    if (values[i] !== null) {
      defined.push(values[i]!);
      indices.push(i);
    }
  }
  const e = ema(defined, period);
  for (let j = 0; j < indices.length; j += 1) out[indices[j]!] = e[j]!;
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: NullableSeries = values.map((_, i) =>
    fastEma[i] === null || slowEma[i] === null ? null : fastEma[i]! - slowEma[i]!,
  );
  const signal = emaNullable(line, signalPeriod);
  const histogram: NullableSeries = values.map((_, i) =>
    line[i] === null || signal[i] === null ? null : line[i]! - signal[i]!,
  );
  return { macd: line, signal, histogram };
}

export function bollinger(values: number[], period = 20, deviations = 2) {
  checkPeriod(period);
  const middle = sma(values, period);
  const upper: NullableSeries = new Array(values.length).fill(null);
  const lower: NullableSeries = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i += 1) {
    const mean = middle[i]!;
    const window = values.slice(i - period + 1, i + 1);
    const variance = window.reduce((sum, x) => sum + (x - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + deviations * sd;
    lower[i] = mean - deviations * sd;
  }
  return { upper, middle, lower };
}

export function percentChange(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (first === 0) return null;
  return ((last - first) / first) * 100;
}

export function summarise(values: number[]) {
  if (values.length < 20) return { tone: 'flat' as const, label: 'Insufficient history' };
  const recent = values.slice(-20);
  const change = percentChange(recent) ?? 0;
  const fast = ema(values, 8).at(-1);
  const slow = ema(values, 20).at(-1);
  if (change > 4 || (fast !== null && slow !== null && fast! > slow! * 1.015)) {
    return { tone: 'up' as const, label: 'Congestion rising' };
  }
  if (change < -4 || (fast !== null && slow !== null && fast! < slow! * 0.985)) {
    return { tone: 'down' as const, label: 'Congestion easing' };
  }
  return { tone: 'flat' as const, label: 'Range-bound' };
}
