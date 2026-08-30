import type { HedgeStatus } from '../lib/types';

const STEPS: { key: string; label: string }[] = [
  { key: 'evaluating', label: 'Evaluate exposure' },
  { key: 'proposed', label: 'Request Thetanuts quotes' },
  { key: 'approved', label: 'Risk policy approves' },
  { key: 'executed', label: 'Execute on Base mainnet' },
];

function stepIndex(state: string): number {
  if (state === 'idle') return -1;
  const i = STEPS.findIndex((s) => s.key === state);
  return i === -1 ? 0 : i;
}

interface HedgeViewProps {
  hedge: HedgeStatus;
}

export function HedgeView({ hedge }: HedgeViewProps) {
  const active = stepIndex(hedge.state);
  const exposurePct = Math.min(100, Math.round((hedge.exposure / hedge.threshold) * 100));

  return (
    <div className="card">
      <h2>Autonomous Hedge — Thetanuts</h2>

      <div className="forecast-row">
        <span>ETH-correlated exposure</span>
        <span className="mono">
          {hedge.exposure.toFixed(0)} / {hedge.threshold} USDC
        </span>
      </div>
      <div className="bar">
        <div
          className={`bar-fill ${exposurePct >= 100 ? 'danger' : ''}`}
          style={{ width: `${exposurePct}%` }}
        />
      </div>

      <ol className="hedge-steps">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={i < active ? 'done' : i === active ? 'active' : ''}
          >
            {s.label}
          </li>
        ))}
      </ol>

      {hedge.candidate && (
        <div className="hedge-candidate">
          <div className="cand-title">Best RFQ candidate</div>
          <dl className="meta-grid">
            <dt>Instrument</dt>
            <dd className="mono">{hedge.candidate.instrument} {hedge.candidate.strike}</dd>
            <dt>Expiry</dt>
            <dd className="mono">{hedge.candidate.expiry}</dd>
            <dt>Premium</dt>
            <dd className="mono">{hedge.candidate.premium.toFixed(2)} USDC</dd>
            <dt>Notional</dt>
            <dd className="mono">{hedge.candidate.notional.toFixed(0)} USDC</dd>
            <dt>Delta</dt>
            <dd className="mono">{hedge.candidate.delta}</dd>
            <dt>Venue</dt>
            <dd className="mono">{hedge.candidate.venue}</dd>
          </dl>
        </div>
      )}

      <p className="hedge-note">{hedge.explanation}</p>

      {hedge.txDigest && (
        <a
          className="tx-link"
          href={`https://basescan.org/tx/${hedge.txDigest}`}
          target="_blank"
          rel="noreferrer"
        >
          Base mainnet tx: {hedge.txDigest.slice(0, 10)}… ↗
        </a>
      )}
    </div>
  );
}
