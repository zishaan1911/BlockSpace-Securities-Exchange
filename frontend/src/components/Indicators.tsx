/**
 * Technical readouts for the EGSI series.
 *
 * Worth stating plainly on screen as well as here: these indicators
 * were designed for traded prices, where volume and participants
 * produce the momentum and mean-reversion they detect. EGSI is a
 * computed congestion index. RSI on it is a legitimate normalised
 * momentum measure, but "overbought" carries none of its usual meaning
 * because nobody is buying anything — so the panel labels the reading
 * rather than implying a trade.
 */
import { macd, rsi, sma, summarise } from '../lib/indicators';

function last<T>(series: (T | null)[]): T | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i] as T;
  }
  return null;
}

export function Indicators({ closes }: { closes: number[] }) {
  if (closes.length < 30) {
    return (
      <div className="card">
        <h2>Technicals</h2>
        <div className="inner">
          <p className="empty">Needs about 30 candles. Collecting.</p>
        </div>
      </div>
    );
  }

  const r = last(rsi(closes, 14));
  const { macd: macdLine, signal, histogram } = macd(closes);
  const m = last(macdLine);
  const sig = last(signal);
  const hist = last(histogram);
  const ma20 = last(sma(closes, 20));
  const ma50 = last(sma(closes, 50));
  const verdict = summarise(closes);
  const price = closes[closes.length - 1]!;

  const rsiTone = r === null ? 'muted' : r > 70 ? 'down' : r < 30 ? 'up' : '';
  const rsiColor = r === null ? 'var(--muted)' : r > 70 ? 'var(--down)' : r < 30 ? 'var(--up)' : 'var(--gold)';

  return (
    <div className="card">
      <h2>
        Technicals
        <span className="tag">EGSI · 14/12-26-9/20</span>
      </h2>
      <div className="inner">
        <div
          style={{
            fontWeight: 600,
            marginBottom: '0.6rem',
            color:
              verdict.tone === 'up' ? 'var(--up)' : verdict.tone === 'down' ? 'var(--down)' : 'var(--muted)',
          }}
        >
          {verdict.label}
        </div>

        <div className="readings">
          <div className="reading">
            <div className="k">RSI 14</div>
            <div className={`v ${rsiTone}`}>{r === null ? '—' : r.toFixed(1)}</div>
            <div className="meter">
              <span style={{ width: `${r ?? 0}%`, background: rsiColor }} />
            </div>
          </div>

          <div className="reading">
            <div className="k">MACD</div>
            <div className={`v ${m !== null && m > 0 ? 'up' : m !== null ? 'down' : ''}`}>
              {m === null ? '—' : m.toFixed(2)}
            </div>
          </div>

          <div className="reading">
            <div className="k">Signal</div>
            <div className="v">{sig === null ? '—' : sig.toFixed(2)}</div>
          </div>

          <div className="reading">
            <div className="k">Histogram</div>
            <div className={`v ${hist !== null && hist > 0 ? 'up' : hist !== null ? 'down' : ''}`}>
              {hist === null ? '—' : hist.toFixed(2)}
            </div>
          </div>

          <div className="reading">
            <div className="k">MA 20</div>
            <div className={`v ${ma20 !== null && price > ma20 ? 'up' : 'down'}`}>
              {ma20 === null ? '—' : ma20.toFixed(1)}
            </div>
          </div>

          <div className="reading">
            <div className="k">MA 50</div>
            <div className={`v ${ma50 !== null && price > ma50 ? 'up' : 'down'}`}>
              {ma50 === null ? '—' : ma50.toFixed(1)}
            </div>
          </div>
        </div>

        <p className="note">
          Standard indicators on a congestion index, not a traded price. Momentum is real;
          "overbought" is not — nobody is buying EGSI itself.
        </p>
      </div>
    </div>
  );
}
