import type { Candle, MarketSnapshot } from '../lib/api';
import { rsi, macd, sma, summarise } from '../lib/indicators';
import { CandleChart } from './Charts';

export function AnalyticsPage({ snapshot, candles }: { snapshot: MarketSnapshot | null; candles: Candle[] }) {
  const closes = candles.map((c) => c.close);
  const rsi14 = rsi(closes, 14).at(-1);
  const m = macd(closes);
  const macdNow = m.macd.at(-1);
  const ma20 = sma(closes, 20).at(-1);
  const summary = summarise(closes);
  return (
    <div className="analytics-page">
      <section className="card analytics-hero-card">
        <div className="card-heading"><div><span className="section-kicker">EGSI ANALYTICS</span><h2>Network Momentum</h2></div><span className={`analysis-tone tone-${summary.tone}`}>{summary.label}</span></div>
        <div className="analytics-chart">{candles.length ? <CandleChart candles={candles} /> : <div className="chart-empty">Waiting for history…</div>}</div>
      </section>
      <div className="analytics-metrics">
        <section className="card"><span>Current EGSI</span><strong>{Math.round(snapshot?.egsi.score ?? 0)}</strong><small>0–1000 stress index</small></section>
        <section className="card"><span>RSI 14</span><strong>{rsi14 === null || rsi14 === undefined ? '—' : rsi14.toFixed(1)}</strong><small>Momentum only — not “overbought”</small></section>
        <section className="card"><span>MACD</span><strong>{macdNow === null || macdNow === undefined ? '—' : macdNow.toFixed(2)}</strong><small>EMA momentum spread</small></section>
        <section className="card"><span>SMA 20</span><strong>{ma20 === null || ma20 === undefined ? '—' : ma20.toFixed(1)}</strong><small>Trailing EGSI average</small></section>
      </div>
      <div className="analytics-note">Technical indicators here are applied to EGSI, a computed congestion index—not a traded spot asset—so conventional “overbought/oversold” interpretations should not be used.</div>
    </div>
  );
}
