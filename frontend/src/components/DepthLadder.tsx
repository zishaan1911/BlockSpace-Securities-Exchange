/**
 * Depth ladder — the centre of any trading terminal.
 *
 * The data comes from the C++ engine's OrderBook via the gateway, and
 * is **indicative**: `contracts/gasx` owns the authoritative book, and
 * with no indexer there is nothing to read real resting orders from. So
 * these levels are GASX quoting to itself off the AI forecast, not
 * orders anyone placed.
 *
 * That caveat is rendered, not just commented. A depth ladder is about
 * the most executable-looking thing a screen can show, and letting
 * someone read these as real prices would be a genuine way to mislead
 * them. The header carries the label permanently rather than hiding it
 * in a tooltip.
 */
import type { IndicativeQuote, OrderBook } from '../lib/api';

interface Props {
  book: OrderBook | null;
  quote: IndicativeQuote | null;
}

export function DepthLadder({ book, quote }: Props) {
  const bid = book?.bestBid ?? null;
  const ask = book?.bestAsk ?? null;
  const spread = bid && ask ? ask.price - bid.price : null;
  const mid = bid && ask ? (ask.price + bid.price) / 2 : quote?.fairPrice ?? null;

  // Bars are scaled against the larger side so the two are comparable
  // rather than each filling its own row.
  const maxQty = Math.max(bid?.quantity ?? 0, ask?.quantity ?? 0, 1);
  const width = (qty: number) => `${Math.round((qty / maxQty) * 100)}%`;

  return (
    <div className="card">
      <h2>
        Order book
        <span className="tag">Indicative</span>
      </h2>
      <div className="inner">
        {!bid && !ask ? (
          <p className="empty">No quote — forecast is below the engine's confidence floor.</p>
        ) : (
          <table className="depth">
            <thead>
              <tr>
                <th>Price</th>
                <th>Size</th>
                <th>Side</th>
              </tr>
            </thead>
            <tbody>
              {ask && (
                <tr>
                  <td className="px ask">{ask.price}</td>
                  <td>
                    <span className="bar" style={{ width: width(ask.quantity), background: 'var(--down)' }} />
                    {ask.quantity}
                  </td>
                  <td className="muted">Ask</td>
                </tr>
              )}
              <tr className="mid">
                <td className="num">{mid !== null ? Math.round(mid) : '—'}</td>
                <td className="muted" style={{ fontWeight: 400, fontSize: 11 }}>
                  spread {spread ?? '—'}
                </td>
                <td />
              </tr>
              {bid && (
                <tr>
                  <td className="px bid">{bid.price}</td>
                  <td>
                    <span className="bar" style={{ width: width(bid.quantity), background: 'var(--up)' }} />
                    {bid.quantity}
                  </td>
                  <td className="muted">Bid</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {quote && (
          <dl className="kv" style={{ marginTop: '0.6rem' }}>
            <dt>Fair value</dt>
            <dd>{quote.fairPrice}</dd>
            <dt>Quote size</dt>
            <dd>{quote.size}</dd>
          </dl>
        )}

        <p className="note">
          Engine quote from the AI forecast, not resting orders. Settlement is on Sui.
        </p>
      </div>
    </div>
  );
}
