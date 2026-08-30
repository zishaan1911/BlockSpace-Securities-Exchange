import type { OrderBook as OrderBookType, OrderBookLevel } from '../lib/types';

function maxQty(levels: OrderBookLevel[]): number {
  return Math.max(1, ...levels.map((l) => l.qty));
}

interface OrderBookProps {
  book: OrderBookType;
}

export function OrderBook({ book }: OrderBookProps) {
  const max = maxQty([...book.bids, ...book.asks]);
  return (
    <div className="card">
      <h2>Order Book</h2>
      <div className="book">
        <div className="book-side">
          <div className="book-head">
            <span>Bid</span>
            <span>Qty</span>
          </div>
          {book.bids.map((l) => (
            <div key={`b${l.price}`} className="book-row">
              <span className="mono bid">{l.price}</span>
              <div className="depth">
                <div className="depth-fill bid" style={{ width: `${(l.qty / max) * 100}%` }} />
              </div>
              <span className="mono">{l.qty}</span>
            </div>
          ))}
        </div>
        <div className="book-side">
          <div className="book-head">
            <span>Ask</span>
            <span>Qty</span>
          </div>
          {book.asks.map((l) => (
            <div key={`a${l.price}`} className="book-row">
              <span className="mono ask">{l.price}</span>
              <div className="depth">
                <div className="depth-fill ask" style={{ width: `${(l.qty / max) * 100}%` }} />
              </div>
              <span className="mono">{l.qty}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
