/**
 * ARCHITECTURE.md §10's Hedge Flow, made legible.
 *
 * The point of this panel is showing the *reasoning*, not just the
 * outcome — §8's whole premise is that the AI can request an action but
 * cannot bypass policy, and that guarantee is only worth something if a
 * person can see the policy being applied. So a rejection shows which
 * limit stopped it, and an approval is explicit that nothing was
 * actually traded.
 *
 * Two separate actions, because they cost very different things:
 *   Check exposure  — read-only, free, safe to press repeatedly
 *   Request quotes  — submits a real RFQ on Base mainnet, costs gas
 */
import { useState } from 'react';
import { api, ApiError, type Exposure, type HedgeEvaluation } from '../lib/api';
import { formatConfidence, formatNotional } from '../lib/egsi';

export function HedgePanel({ egsiLevel }: { egsiLevel: number | null }) {
  const [netContracts, setNetContracts] = useState('10');
  const [exposure, setExposure] = useState<Exposure | null>(null);
  const [evaluation, setEvaluation] = useState<HedgeEvaluation | null>(null);
  const [busy, setBusy] = useState<'assess' | 'evaluate' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = egsiLevel !== null;

  async function run(kind: 'assess' | 'evaluate') {
    if (!ready) return;
    setBusy(kind);
    setError(null);
    try {
      const input = { netContracts: Number(netContracts), egsiLevel };
      if (kind === 'assess') {
        const { exposure: result } = await api.assessHedge(input);
        setExposure(result);
        setEvaluation(null);
      } else {
        const result = await api.evaluateHedge(input);
        setEvaluation(result);
        setExposure(result.exposure);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the hedge engine.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>ETH-correlated risk</h2>
        <span className="panel-note">Thetanuts · Base mainnet</span>
      </div>

      <div className="field">
        <label htmlFor="net">Your net position, in contracts</label>
        <input
          id="net"
          inputMode="numeric"
          value={netContracts}
          onChange={(e) => setNetContracts(e.target.value)}
          aria-describedby="net-help"
        />
        <span id="net-help" className="panel-note">
          Positive if you are net long. There is no position feed yet, so enter it yourself.
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="secondary" onClick={() => run('assess')} disabled={!ready || busy !== null}>
          {busy === 'assess' ? 'Checking…' : 'Check exposure'}
        </button>
        <button className="secondary" onClick={() => run('evaluate')} disabled={!ready || busy !== null}>
          {busy === 'evaluate' ? 'Requesting…' : 'Request hedge quotes'}
        </button>
      </div>

      {!ready && (
        <p className="empty" style={{ marginTop: '0.8rem' }}>
          Needs a live index reading first.
        </p>
      )}

      {error && (
        <div className="notice bad" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}

      {exposure && (
        <dl className="rows" style={{ marginTop: '1.25rem' }}>
          <div className="row">
            <dt>Index exposure</dt>
            <dd className="tabular">{formatNotional(exposure.egsiNotional)}</dd>
          </div>
          <div className="row">
            <dt>ETH-correlated share</dt>
            <dd className="tabular">{formatNotional(exposure.ethBetaNotional)}</dd>
          </div>
          <div className="row">
            <dt>Hedge warranted</dt>
            <dd style={{ color: exposure.breached ? 'var(--elevated)' : 'var(--ink-dim)' }}>
              {exposure.breached ? `Yes — buy ${exposure.suggestedOptionType}s` : 'No, within limits'}
            </dd>
          </div>
        </dl>
      )}

      {evaluation && <Verdict evaluation={evaluation} />}
    </div>
  );
}

function Verdict({ evaluation }: { evaluation: HedgeEvaluation }) {
  if (!evaluation.exposure.breached) {
    return (
      <div className="notice" style={{ marginTop: '1rem' }}>
        No hedge needed. Nothing was requested, so no gas was spent.
      </div>
    );
  }

  if (evaluation.approved === undefined) {
    return (
      <div className="notice warn" style={{ marginTop: '1rem' }}>
        {evaluation.reason ?? 'No quotes yet.'}
      </div>
    );
  }

  const approved = evaluation.approved;

  return (
    <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--rule)' }}>
      <div className="verdict" style={{ color: approved ? 'var(--nominal)' : 'var(--critical)' }}>
        {approved ? 'Risk limits cleared' : 'Blocked by risk limits'}
      </div>

      <div className="checks">
        {evaluation.forecast && (
          <div className="check">
            <span className="check-mark" style={{ color: 'var(--nominal)' }}>
              ✓
            </span>
            <span>
              Model confidence {formatConfidence(evaluation.forecast.confidence)}, above the required floor
            </span>
          </div>
        )}
        {evaluation.candidate && evaluation.quotedNotional !== undefined && (
          <div className="check">
            <span className="check-mark" style={{ color: approved ? 'var(--nominal)' : 'var(--critical)' }}>
              {approved ? '✓' : '✕'}
            </span>
            <span>
              Best quote {formatNotional(evaluation.quotedNotional)} from{' '}
              <span className="tabular">{evaluation.candidate.offeror.slice(0, 10)}…</span>
              {!approved && evaluation.reason ? ` — ${evaluation.reason}` : ''}
            </span>
          </div>
        )}
      </div>

      {approved && (
        <div className="notice" style={{ marginTop: '1rem' }}>
          Nothing has been traded. This build stops at the approval step and does not place the
          options order.
        </div>
      )}
    </div>
  );
}
