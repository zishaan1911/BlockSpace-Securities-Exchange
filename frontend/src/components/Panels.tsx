/**
 * The AI forecast (ARCHITECTURE.md §4) and the on-chain market's own
 * state (§5). Both are read-only readouts.
 *
 * The forecast panel is explicit about the fallback case: when the AI
 * service is serving its hard-coded fallback rather than a trained
 * model (model_version ends in "-fallback"), the reader is told so
 * plainly. A confidence number that looks like a real prediction but
 * isn't would be worse than no number.
 */
import type { Forecast, MarketState } from '../lib/api';
import { formatConfidence, stressBand, bandColorVar, timeToExpiry } from '../lib/egsi';

export function ForecastPanel({ forecast }: { forecast: Forecast | null }) {
  if (!forecast) {
    return (
      <div className="panel">
        <div className="panel-head">
          <h2>Forecast</h2>
        </div>
        <p className="empty">
          No forecast available. The AI service needs to run a cycle before it can predict.
        </p>
      </div>
    );
  }

  const isFallback = forecast.model_version.endsWith('-fallback');
  const band = stressBand(forecast.expected_egsi);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Forecast</h2>
        <span className="panel-note">{forecast.market}</span>
      </div>

      {isFallback && (
        <div className="notice warn" style={{ marginBottom: '1rem' }}>
          Showing the fallback forecast, not a trained model. Treat these numbers as placeholders.
        </div>
      )}

      <dl className="rows">
        <div className="row">
          <dt>Expected index</dt>
          <dd className="tabular" style={{ color: bandColorVar(band), fontWeight: 600 }}>
            {forecast.expected_egsi.toFixed(1)}
          </dd>
        </div>
        <div className="row">
          <dt>Confidence</dt>
          <dd className="tabular">{formatConfidence(forecast.confidence)}</dd>
        </div>
        <div className="row">
          <dt>Chance of passing 500</dt>
          <dd className="tabular">{formatConfidence(forecast.p_tail_500)}</dd>
        </div>
        <div className="row">
          <dt>Model</dt>
          <dd>{forecast.model_version}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MarketPanel({ market, nowMs }: { market: MarketState; nowMs: number }) {
  const remaining = timeToExpiry(market.expiryMs, nowMs);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>{market.underlying}</h2>
        <span className="panel-note">{market.marketId.slice(0, 10)}…</span>
      </div>

      {market.settled && (
        <div className="notice" style={{ marginBottom: '1rem' }}>
          Settled at {market.settlementPrice ?? '—'}. This market is closed to new orders.
        </div>
      )}
      {market.paused && !market.settled && (
        <div className="notice warn" style={{ marginBottom: '1rem' }}>
          Trading is paused. Orders cannot be placed right now.
        </div>
      )}
      {!market.oracle.isFreshApprox && !market.settled && (
        <div className="notice warn" style={{ marginBottom: '1rem' }}>
          The oracle price is stale. Settlement is blocked until it updates.
        </div>
      )}

      <dl className="rows">
        <div className="row">
          <dt>Oracle price</dt>
          <dd className="tabular">{market.oracle.hasPrice ? market.oracle.price : 'never published'}</dd>
        </div>
        <div className="row">
          <dt>{market.settled ? 'Expired' : 'Expires in'}</dt>
          <dd className="tabular">{remaining ?? 'expired'}</dd>
        </div>
        <div className="row">
          <dt>Contract size</dt>
          <dd className="tabular">×{market.contractMultiplier}</dd>
        </div>
        <div className="row">
          <dt>Tick</dt>
          <dd className="tabular">{market.tickSize}</dd>
        </div>
        <div className="row">
          <dt>Margin required</dt>
          <dd className="tabular">{(market.marginRatioBps / 100).toFixed(1)}%</dd>
        </div>
      </dl>
    </div>
  );
}
