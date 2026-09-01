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
    <div className="panel action">
      <header>
        <span>ETH hedge</span>
        <span>Thetanuts · Base</span>
      </header>
      <div className="body">
        <div className="form">
          <label htmlFor="net">Net position · contracts (signed)</label>
          <input id="net" inputMode="numeric" value={netContracts} onChange={(e) => setNetContracts(e.target.value)} />
          <p className="indicative">No position feed yet — enter it manually.</p>

          <div className="sidebtns">
            <button className="fn" onClick={() => run('assess')} disabled={!ready || busy !== null}>
              {busy === 'assess' ? 'Checking…' : 'Assess'}
            </button>
            <button className="fn" onClick={() => run('evaluate')} disabled={!ready || busy !== null}>
              {busy === 'evaluate' ? 'Quoting…' : 'Request quotes'}
            </button>
          </div>
        </div>

        {!ready && <p className="empty" style={{ marginTop: '0.4rem' }}>Needs a live index reading.</p>}
        {error && <div className="msg err">{error}</div>}

        {exposure && (
          <dl className="kv" style={{ marginTop: '0.5rem' }}>
            <dt>Index notional</dt>
            <dd>{formatNotional(exposure.egsiNotional)}</dd>
            <dt>ETH beta</dt>
            <dd>{formatNotional(exposure.ethBetaNotional)}</dd>
            <dt>Hedge</dt>
            <dd style={{ color: exposure.breached ? 'var(--amber)' : 'var(--grey)' }}>
              {exposure.breached ? `BUY ${exposure.suggestedOptionType}` : 'Within limits'}
            </dd>
          </dl>
        )}

        {evaluation && <Verdict evaluation={evaluation} />}
      </div>
    </div>
  );
}

function Verdict({ evaluation }: { evaluation: HedgeEvaluation }) {
  if (!evaluation.exposure.breached) {
    return <div className="msg info">No hedge needed. No RFQ sent, no gas spent.</div>;
  }

  if (evaluation.approved === undefined) {
    return <div className="msg warn">{evaluation.reason ?? 'No quotes yet.'}</div>;
  }

  const approved = evaluation.approved;

  return (
    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--rule)' }}>
      <div style={{
        color: approved ? 'var(--up)' : 'var(--down)',
        fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>
        {approved ? 'Risk limits cleared' : 'Blocked by risk limits'}
      </div>

      <div className="checks">
        {evaluation.forecast && (
          <div className="check">
            <span className="check-mark" style={{ color: 'var(--up)' }}>
              ✓
            </span>
            <span>
              Model confidence {formatConfidence(evaluation.forecast.confidence)}, above the required floor
            </span>
          </div>
        )}
        {evaluation.candidate && evaluation.quotedNotional !== undefined && (
          <div className="check">
            <span className="check-mark" style={{ color: approved ? 'var(--up)' : 'var(--down)' }}>
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
        <div className="msg info">
          Nothing traded. This build stops at approval and does not place the options order.
        </div>
      )}
    </div>
  );
}
