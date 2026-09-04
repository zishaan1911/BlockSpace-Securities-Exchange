import type { Candle, MarketSnapshot } from '../lib/api';
import {
  bandLabel,
  formatComponent,
  formatConfidence,
  stressBand,
  timeToExpiry,
} from '../lib/egsi';
import { TrendChart } from './Charts';
import { EgsiGauge } from './EgsiGauge';

function driverLabel(key: string) {
  return key
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function ForecastSlope({ current, expected }: { current: number; expected: number }) {
  const width = 420;
  const height = 120;
  const horizontalPadding = 16;
  const verticalPadding = 18;

  const difference = expected - current;
  const extraRange = Math.max(Math.abs(difference) * 0.4, 35);
  const domainMin = Math.min(current, expected) - extraRange;
  const domainMax = Math.max(current, expected) + extraRange;
  const domainRange = Math.max(1, domainMax - domainMin);

  const yFor = (value: number) =>
    verticalPadding +
    ((domainMax - value) / domainRange) *
      (height - verticalPadding * 2);

  const startX = horizontalPadding;
  const endX = width - horizontalPadding;
  const startY = yFor(current);
  const endY = yFor(expected);

  // Smooth interpolation only communicates direction between the two
  // model values. It is not presented as extra model observations.
  const controlOneX = width * 0.36;
  const controlTwoX = width * 0.68;

  const linePath = [
    `M ${startX} ${startY}`,
    `C ${controlOneX} ${startY},`,
    `${controlTwoX} ${endY},`,
    `${endX} ${endY}`,
  ].join(' ');

  const areaPath = `${linePath} L ${endX} ${height} L ${startX} ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#83a7ff" stopOpacity=".26" />
          <stop offset="1" stopColor="#83a7ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <line
        x1={startX}
        y1={startY}
        x2={endX}
        y2={startY}
        stroke="#243443"
        strokeWidth="1"
        strokeDasharray="5 6"
      />

      <path d={areaPath} fill="url(#forecastFill)" />
      <path
        d={linePath}
        fill="none"
        stroke="#86a7ff"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <circle cx={startX} cy={startY} r="4" fill="#9bb7ff" />
      <circle cx={endX} cy={endY} r="5" fill="#eef5ff" stroke="#6f9eff" strokeWidth="2" />
    </svg>
  );
}

export function MarketDashboard({
  snapshot,
  candles,
  loading,
  error,
  onTrade,
}: {
  snapshot: MarketSnapshot | null;
  candles: Candle[];
  loading: boolean;
  error: string;
  onTrade: () => void;
}) {
  if (!snapshot) {
    return (
      <div className="screen-state card">
        {loading ? 'Loading live market…' : error || 'No market data available.'}
      </div>
    );
  }

  const { egsi, forecast, market, quote } = snapshot;
  const band = stressBand(egsi.score);

  const drivers = Object.entries(egsi.components)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const closes = candles.map((candle) => candle.close);
  const firstClose = closes[0];
  const latestClose = closes.at(-1);

  const dayChange =
    closes.length > 1 &&
    firstClose !== undefined &&
    firstClose !== 0 &&
    latestClose !== undefined
      ? ((latestClose - firstClose) / firstClose) * 100
      : null;

  const expiry = market.expiryMs ? timeToExpiry(market.expiryMs) : null;
  const price = quote.mid ?? forecast.expected;

  const forecastDelta = forecast.expected - egsi.score;
  const forecastDeltaRounded = Math.round(forecastDelta);

  const forecastDirection: 'up' | 'down' | 'flat' =
    forecastDelta > 0.5
      ? 'up'
      : forecastDelta < -0.5
        ? 'down'
        : 'flat';

  const forecastDeltaLabel =
    forecastDeltaRounded > 0
      ? `+${forecastDeltaRounded}`
      : `${forecastDeltaRounded}`;

  const forecastDirectionLabel =
    forecastDirection === 'up'
      ? 'Rising'
      : forecastDirection === 'down'
        ? 'Cooling'
        : 'Stable';

  return (
    <div className="dashboard-page">
      {market.devMode && (
        <div className="dev-banner">
          <b>DEV MARKET</b>
          Synthetic Sui market active. Live EGSI is available, but orders
          remain disabled until contracts are deployed.
        </div>
      )}

      <div className="dashboard-top-grid">
        <section className="card gauge-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">LIVE INDEX</span>
              <h2>Ethereum Gas Stress Index (EGSI)</h2>
            </div>

            <span className="live-badge">
              <i /> Live
            </span>
          </div>

          <EgsiGauge score={egsi.score} />
        </section>

        <section className="card trend-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">NETWORK</span>
              <h2>24h Trend</h2>
            </div>

            <span
              className={`trend-badge ${
                dayChange !== null && dayChange < 0 ? 'negative' : ''
              }`}
            >
              {dayChange === null
                ? '—'
                : `${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(1)}%`}
            </span>
          </div>

          <div className="trend-chart-wrap">
            {candles.length ? (
              <TrendChart candles={candles} />
            ) : (
              <div className="chart-empty">Waiting for EGSI history…</div>
            )}
          </div>

          <div className="metric-strip">
            <div>
              <strong
                className={
                  dayChange !== null && dayChange < 0
                    ? 'negative-text'
                    : 'positive-text'
                }
              >
                {dayChange === null
                  ? '—'
                  : `${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(1)}%`}
              </strong>
              <span>24h change</span>
            </div>

            <div>
              <strong>{formatConfidence(forecast.confidence)}</strong>
              <span>Forecast confidence</span>
            </div>

            <div>
              <strong>15s</strong>
              <span>Market refresh</span>
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="card drivers-card">
          <div className="card-heading">
            <h2>Key Drivers</h2>
          </div>

          <div className="driver-list">
            {drivers.length ? (
              drivers.map(([name, value]) => (
                <div className="driver" key={name}>
                  <div>
                    <span className="driver-icon">⌁</span>
                    <span>{driverLabel(name)}</span>
                    <b>{formatComponent(value)}</b>
                  </div>

                  <div className="driver-track">
                    <span
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(2, value * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="muted-empty">
                No component breakdown returned by the AI service.
              </div>
            )}
          </div>
        </section>

        <section className="card forecast-card">
          <div className="card-heading">
            <div>
              <span className="section-kicker">AI FORECAST</span>
              <h2>Next 1 Hour</h2>
            </div>

            {forecast.fallback && (
              <span className="warning-badge">Fallback</span>
            )}
          </div>

          {/* Important values are kept outside the chart so they stay readable. */}
          <div className="forecast-summary-row">
            <div className="forecast-stat-card">
              <span>Now</span>
              <strong>{Math.round(egsi.score)}</strong>
              <small>Live EGSI</small>
            </div>

            <div className="forecast-stat-card emphasis">
              <span>Expected</span>
              <strong>{Math.round(forecast.expected)}</strong>
              <small>In 1 hour</small>
            </div>

            <div className={`forecast-delta-pill ${forecastDirection}`}>
              <span>1H Change</span>
              <strong>{forecastDeltaLabel}</strong>
              <small>{forecastDirectionLabel}</small>
            </div>
          </div>

          <div className="forecast-visual">
            <ForecastSlope
              current={egsi.score}
              expected={forecast.expected}
            />
          </div>

          <div className="forecast-legend">
            <span>
              <i className="blue-dot" />
              Model {forecast.modelVersion}
            </span>

            <span>
              P(EGSI &gt; 500){' '}
              <b>{formatConfidence(forecast.tailProbability)}</b>
            </span>
          </div>
        </section>

        <section className="card market-overview-card">
          <div className="card-heading">
            <h2>Market Overview</h2>
          </div>

          <div className="overview-list">
            <div>
              <span>Market</span>
              <b>{market.label}</b>
            </div>

            <div>
              <span>Indicative price</span>
              <b>{Number.isFinite(price) ? price.toFixed(1) : '—'}</b>
            </div>

            <div>
              <span>Collateral</span>
              <b>USDC</b>
            </div>

            <div>
              <span>Expiry</span>
              <b>{expiry ?? '1-hour market'}</b>
            </div>

            <div>
              <span>Oracle</span>
              <b
                className={
                  market.oracleFresh ? 'positive-text' : 'negative-text'
                }
              >
                {market.oracleFresh ? 'Fresh' : 'Stale'}
              </b>
            </div>
          </div>

          <button
            className="button button-primary overview-action"
            onClick={onTrade}
          >
            Trade EGSI-1H →
          </button>
        </section>
      </div>

      <div className={`market-status-banner status-${band}`}>
        <div className="status-symbol">
          {band === 'nominal' ? '✓' : '!'}
        </div>

        <div>
          <b>Market is {bandLabel(band).toLowerCase()}</b>
          <span>
            {band === 'nominal'
              ? 'Gas conditions are stable. Monitor for changes in network activity.'
              : 'AI forecast and network drivers indicate elevated blockspace stress.'}
          </span>
        </div>

        <span className="status-score">EGSI {Math.round(egsi.score)}</span>
      </div>
    </div>
  );
}
