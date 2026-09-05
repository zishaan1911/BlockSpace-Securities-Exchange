import {
  useState,
  type ChangeEvent,
} from 'react';

import type { MarketSnapshot } from '../lib/api';

import {
  assessHedge,
  evaluateHedge,
  pickBoolean,
  pickNumber,
  pickText,
} from '../lib/api';

/**
 * Extract a small list of primitive fields from
 * the backend response for debugging/display.
 */
function compactObject(
  value: unknown,
): Array<[string, string | number | boolean]> {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return [];
  }

  return Object.entries(
    value as Record<string, unknown>,
  )
    .filter(
      (
        entry,
      ): entry is [
        string,
        string | number | boolean,
      ] => {
        const valueType =
          typeof entry[1];

        return (
          valueType === 'string' ||
          valueType === 'number' ||
          valueType === 'boolean'
        );
      },
    )
    .slice(0, 8);
}

export function HedgePage({
  snapshot,
}: {
  snapshot: MarketSnapshot | null;
}) {
  // Keep the input as a raw string so the user can clear and type freely
  // (Number('') coerces to 0 mid-edit, which made the old box jump around).
  // The number is derived only when assess/evaluate actually needs it.
  const [positionInput, setPositionInput] =
    useState('5');

  const position = Number(positionInput) || 0;

  const [
    assessment,
    setAssessment,
  ] = useState<unknown>(null);

  const [
    evaluation,
    setEvaluation,
  ] = useState<unknown>(null);

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState('');

  /**
   * Prefer the final hedge evaluation.
   * If one has not been made yet,
   * show the risk assessment.
   */
  const latest =
    evaluation ?? assessment;

  /**
   * Important:
   * `latest` is `unknown`, so do not
   * use `{latest && (...)}` directly
   * in JSX.
   */
  const hasLatest =
    latest !== null &&
    latest !== undefined;

  /**
   * Extract common backend fields.
   */
  const approved = pickBoolean(
    latest,
    [
      'approved',
      'allow',
      'passes_policy',
    ],
    false,
  );

  const reason = pickText(
    latest,
    [
      'reason',
      'explanation',
      'message',
      'error',
      'decision_reason',
    ],
    approved
      ? 'All risk checks passed for the quoted premium.'
      : assessment !== null
        ? 'Risk assessment returned by GASX.'
        : 'Enter your net EGSI position and request a live assessment.',
  );

  const confidence = pickNumber(
    latest,
    [
      'confidence',
      'model_confidence',
    ],
    snapshot?.forecast.confidence ??
      Number.NaN,
  );

  const notional = pickNumber(
    latest,
    [
      'quotedNotional',
      'notional',
      'hedge_notional',
      'recommended_notional',
    ],
    Number.NaN,
  );

  // The real /hedge/evaluate response has no strategy/instrument/
  // recommendation/option field at all -- it never existed on the
  // backend, so this always fell through to one of the two hardcoded
  // defaults regardless of what actually happened. In particular, a
  // REJECTED evaluation (a real decision, with a real reason already
  // returned) still showed "Waiting for policy decision" as if nothing
  // had been decided yet. Derived from the fields that actually exist
  // instead: approved, reason, and whether an evaluate call has run
  // (evaluation !== null) versus only an assess (assessment only).
  const hasEvaluated = evaluation !== null;
  const strategy = approved
    ? 'Approved -- within all risk limits'
    : hasEvaluated
      ? 'Rejected by risk policy'
      : hasLatest
        ? 'Exposure assessed -- request a quote for a policy decision'
        : 'No assessment yet';

  const execution = pickText(
    latest,
    [
      'tx_hash',
      'transaction_hash',
      'digest',
      'execution_tx',
    ],
    '',
  );

  /**
   * Ask GASX to assess the current
   * EGSI exposure.
   */
  async function assess() {
    // The real gateway needs the CURRENT EGSI level to compute exposure
    // (it multiplies position * contract size * this level), not the
    // market id -- there is only one market, so the id was never
    // meaningful to send. Refusing without a live EGSI reading is
    // better than sending a stale or fabricated level.
    const egsiLevel = snapshot?.egsi.score;
    if (!Number.isFinite(egsiLevel)) {
      setError('No live EGSI reading yet -- wait for the market to load before assessing.');
      return;
    }

    setBusy(true);
    setError('');
    setEvaluation(null);

    try {
      const result = await assessHedge(position, egsiLevel!);
      setAssessment(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Hedge assessment failed',
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Run the hedge through GASX's
   * hard risk policy.
   */
  async function evaluate() {
    // evaluate() recomputes exposure itself from netContracts/egsiLevel;
    // it never accepted a previous assessment as input, so that value
    // was always discarded server-side even before the request-shape fix.
    const egsiLevel = snapshot?.egsi.score;
    if (!Number.isFinite(egsiLevel)) {
      setError('No live EGSI reading yet -- wait for the market to load before evaluating.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const result = await evaluateHedge(position, egsiLevel!);
      setEvaluation(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Hedge evaluation failed',
      );
    } finally {
      setBusy(false);
    }
  }

  const detailPairs =
    compactObject(latest);

  return (
    <div className="hedge-page">
      <div className="hedge-grid">
        {/* ================================= */}
        {/* AI HEDGE ASSISTANT                */}
        {/* ================================= */}

        <section className="card ai-assistant-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">
                THETANUTS
              </span>

              <h2>
                AI Hedge Assistant

                <small className="beta-badge">
                  Beta
                </small>
              </h2>

              <p>
                Live ETH options
                opportunities with hard,
                non-bypassable risk
                controls.
              </p>
            </div>
          </div>

          {/* AI conversation */}

          <div className="assistant-thread">
            <div className="assistant-avatar">
              ✦
            </div>

            <div className="assistant-bubble">
              <p>{reason}</p>

              {/* FIXED:
                  hasLatest is boolean,
                  rather than rendering
                  `unknown && JSX`
              */}

              {hasLatest && (
                <div
                  className={`recommendation-card ${
                    approved
                      ? 'approved'
                      : 'rejected'
                  }`}
                >
                  <span className="recommendation-label">
                    {approved
                      ? 'POLICY APPROVED'
                      : 'POLICY RESULT'}
                  </span>

                  <h3>{strategy}</h3>

                  {/* Hedge statistics */}

                  <div className="recommendation-stats">
                    <div>
                      <span>
                        Net Position
                      </span>

                      <strong>
                        {position}{' '}
                        contracts
                      </strong>
                    </div>

                    <div>
                      <span>
                        Confidence
                      </span>

                      <strong>
                        {Number.isFinite(
                          confidence,
                        )
                          ? `${Math.round(
                              confidence *
                                100,
                            )}%`
                          : '—'}
                      </strong>
                    </div>

                    <div>
                      <span>
                        Hedge Notional
                      </span>

                      <strong>
                        {Number.isFinite(
                          notional,
                        )
                          ? `$${notional.toFixed(
                              2,
                            )}`
                          : 'Backend decides'}
                      </strong>
                    </div>
                  </div>

                  {/* Policy explanation */}

                  <ul>
                    <li>
                      <i>✓</i>

                      AI request is checked
                      outside the model
                    </li>

                    <li>
                      <i>✓</i>

                      Maximum slippage is
                      capped at 1%
                    </li>

                    <li>
                      <i>✓</i>

                      Minimum model
                      confidence is 70%
                    </li>

                    <li>
                      <i>
                        {execution
                          ? '✓'
                          : '•'}
                      </i>

                      {execution
                        ? `On-chain execution returned: ${execution.slice(
                            0,
                            18,
                          )}…`
                        : 'No execution is shown unless the backend returns on-chain evidence'}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* ================================= */}
          {/* CONTROLS                          */}
          {/* ================================= */}

          <div className="assistant-controls">
            <label>
              <span>
                Net EGSI position
              </span>

              <input
                type="number"
                value={positionInput}
                onChange={(
                  event: ChangeEvent<HTMLInputElement>,
                ) => setPositionInput(event.target.value)}
              />
            </label>

            <button
              className="button button-ghost"
              disabled={busy}
              onClick={() =>
                void assess()
              }
            >
              {busy
                ? 'Checking…'
                : 'Assess Risk'}
            </button>

            <button
              className="button button-primary"
              disabled={
                busy ||
                assessment === null ||
                assessment === undefined
              }
              onClick={() =>
                void evaluate()
              }
            >
              Evaluate Hedge →
            </button>
          </div>

          {error && (
            <div className="inline-error">
              {error}
            </div>
          )}
        </section>

        {/* ================================= */}
        {/* RIGHT SIDEBAR                     */}
        {/* ================================= */}

        <aside className="hedge-side-column">
          {/* Risk policy */}

          <section className="card risk-limits-card">
            <div className="card-heading">
              <h2>
                Your Risk Limits
              </h2>

              <span className="locked-badge">
                Locked
              </span>
            </div>

            <div className="limit-list">
              <div>
                <span>
                  Max Order Contracts
                </span>

                <b>Policy cap</b>
              </div>

              <div>
                <span>
                  Max Position
                </span>

                <b>Policy cap</b>
              </div>

              <div>
                <span>
                  Min Confidence
                </span>

                <b>70%</b>
              </div>

              <div>
                <span>
                  Max Slippage
                </span>

                <b>1%</b>
              </div>

              <div>
                <span>
                  Hedge Wallet
                </span>

                <b>Isolated</b>
              </div>
            </div>
          </section>

          {/* ================================= */}
          {/* LATEST AI DECISION                */}
          {/* ================================= */}

          <section className="card actions-card">
            <div className="card-heading">
              <h2>
                Latest AI Decision
              </h2>
            </div>

            {!hasLatest ? (
              <div className="muted-empty">
                No hedge assessment in
                this session yet.
              </div>
            ) : (
              <div className="action-timeline">
                {/* MARKET ANALYSIS */}

                <div>
                  <i className="green-timeline" />

                  <span>
                    <b>
                      Market analysed
                    </b>

                    <small>
                      EGSI{' '}
                      {Math.round(
                        snapshot?.egsi
                          .score ?? 0,
                      )}
                      {' · '}
                      Forecast{' '}
                      {Math.round(
                        snapshot
                          ?.forecast
                          .expected ?? 0,
                      )}
                    </small>
                  </span>
                </div>

                {/* POLICY */}

                <div>
                  <i
                    className={
                      approved
                        ? 'green-timeline'
                        : 'red-timeline'
                    }
                  />

                  <span>
                    <b>
                      {approved
                        ? 'Policy approved'
                        : 'Policy evaluated'}
                    </b>

                    <small>
                      {reason}
                    </small>
                  </span>
                </div>

                {/* EXECUTION */}

                {execution.length >
                  0 && (
                  <div>
                    <i className="blue-timeline" />

                    <span>
                      <b>
                        Execution
                        evidence returned
                      </b>

                      <small>
                        {execution}
                      </small>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Raw backend fields */}

            {detailPairs.length >
              0 && (
              <details className="raw-details">
                <summary>
                  Backend fields
                </summary>

                {detailPairs.map(
                  ([key, value]) => (
                    <div key={key}>
                      <span>
                        {key}
                      </span>

                      <b>
                        {String(
                          value,
                        )}
                      </b>
                    </div>
                  ),
                )}
              </details>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}