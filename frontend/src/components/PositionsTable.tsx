import type { Position } from '../lib/types';

interface PositionsTableProps {
  positions: Position[];
}

export function PositionsTable({ positions }: PositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="card">
        <h2>Positions</h2>
        <p className="empty">
          No open positions. Place an order to start the demo narrative.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Positions</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Side</th>
            <th>Qty</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>Margin</th>
            <th>Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id}>
              <td>
                <span className={`side-pill ${p.side.toLowerCase()}`}>{p.side}</span>
              </td>
              <td className="mono">{p.qty}</td>
              <td className="mono">{p.entryPrice}</td>
              <td className="mono">{p.markPrice}</td>
              <td className="mono">{p.marginLocked.toFixed(2)}</td>
              <td className={`mono ${p.unrealizedPnl >= 0 ? 'pos' : 'neg'}`}>
                {p.unrealizedPnl >= 0 ? '+' : ''}
                {p.unrealizedPnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
