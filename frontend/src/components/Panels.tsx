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
        <header><span>Forecast</span></header>
        <div className="body">
          <p className="empty">No forecast. The AI service has not cycled yet.</p>
        </div>
      </div>
    );
  }

  // Three distinct states, and they deserve different words. A learned
  // model that beat its baselines is one thing; the statistical
  // baseline is a legitimate forecast that measurement showed to be
  // MORE accurate than the learned model on this data; the hard-coded
  // fallback really is a placeholder.
  const isBaseline = forecast.model_version.startsWith('egsi-baseline');
  const isFallback = forecast.model_version.endsWith('-fallback');
  const band = stressBand(forecast.expected_egsi);

  return (
    <div className="panel">
      <header>
        <span>Forecast</span>
        <span>{forecast.market}</span>
      </header>
      <div className="body">

      {isFallback && <div className="msg warn">No forecast yet. Placeholder values.</div>}

      {isBaseline && (
        <div className="msg info">
          Statistical baseline. Gas is strongly mean-reverting, so the recent average
          predicts it better than the learned model does.
        </div>
      )}

      <dl className="kv" style={{ marginTop: isBaseline || isFallback ? '0.4rem' : 0 }}>
        <dt>Expected</dt>
        <dd style={{ color: bandColorVar(band) }}>{forecast.expected_egsi.toFixed(1)}</dd>
        <dt>Confidence</dt>
        <dd>{formatConfidence(forecast.confidence)}</dd>
        <dt>P(&gt;500)</dt>
        <dd>{formatConfidence(forecast.p_tail_500)}</dd>
        <dt>Method</dt>
        <dd>{isBaseline ? 'Recent mean' : forecast.model_version}</dd>
      </dl>
      </div>
    </div>
  );
}

export function MarketPanel({ market, nowMs }: { market: MarketState; nowMs: number }) {
  const remaining = timeToExpiry(market.expiryMs, nowMs);

  return (
    <div className="panel">
      <header>
        <span>Contract</span>
        <span>{market.marketId.slice(0, 10)}…</span>
      </header>
      <div className="body">

      {market.devMode && (
        <div className="notice warn" style={{ marginBottom: '1rem' }}>
          Dev market: the gasx contracts are not deployed yet, so this market is simulated
          by the gateway. Orders are disabled until they are (see blockchain/sui/README.md).
        </div>
      )}
      {market.settled && <div className="msg info">Settled at {market.settlementPrice ?? '—'}. Closed.</div>}
      {market.paused && !market.settled && <div className="msg warn">Trading paused.</div>}
      {!market.oracle.isFreshApprox && !market.settled && (
        <div className="msg warn">Oracle stale. Settlement blocked.</div>
      )}

      <dl className="kv">
        <dt>Underlying</dt>
        <dd>{market.underlying}</dd>
        <dt>Oracle</dt>
        <dd>{market.oracle.hasPrice ? market.oracle.price : 'unpublished'}</dd>
        <dt>{market.settled ? 'Expired' : 'Expiry'}</dt>
        <dd>{remaining ?? 'expired'}</dd>
        <dt>Mult</dt>
        <dd>×{market.contractMultiplier}</dd>
        <dt>Tick</dt>
        <dd>{market.tickSize}</dd>
        <dt>Margin</dt>
        <dd>{(market.marginRatioBps / 100).toFixed(1)}%</dd>
      </dl>
      </div>
    </div>
  );
}
