/**
 * Exchange terminal.
 *
 * Chart-dominant, the way an exchange front-end is: the price series
 * gets the room, and everything else sits beside it. Left column is the
 * chart plus its technicals; centre is depth and drivers; right is the
 * things that act — order ticket and hedge.
 *
 * Two polling rates, because the underlying data moves at two speeds:
 * market state every 5s (EGSI updates on Ethereum's ~12s block time),
 * candles every 30s (a 5-minute bucket cannot change faster than that,
 * and refetching 300 bars every 5s is waste).
 */
import { useCallback, useEffect, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { api, ApiError, type Candle, type MarketResponse } from './lib/api';
import { CandleChart } from './components/CandleChart';
import { Indicators } from './components/Indicators';
import { DepthLadder } from './components/DepthLadder';
import { DriverBars } from './components/DriverBars';
import { ForecastPanel, MarketPanel } from './components/Panels';
import { OrderTicket } from './components/OrderTicket';
import { HedgePanel } from './components/HedgePanel';
import { percentChange } from './lib/indicators';
import { bandLabel, stressBand, timeToExpiry } from './lib/egsi';

const MARKET_POLL_MS = 5_000;
const CANDLE_POLL_MS = 30_000;

const INTERVALS = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
];

export default function App() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [interval, setIntervalSeconds] = useState(300);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showEmas, setShowEmas] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadMarket = useCallback(async () => {
    try {
      setData(await api.getMarket());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gateway unreachable.');
    }
  }, []);

  // Candles fail soft: the terminal is still usable without a chart, so
  // a missing database should not blank the screen.
  const loadCandles = useCallback(async () => {
    try {
      const { candles: bars } = await api.getCandles(interval, 300);
      setCandles(bars);
    } catch {
      /* keep whatever is already drawn */
    }
  }, [interval]);

  useEffect(() => {
    void loadMarket();
    const timer = setInterval(() => {
      void loadMarket();
      setNowMs(Date.now());
    }, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [loadMarket]);

  useEffect(() => {
    void loadCandles();
    const timer = setInterval(() => void loadCandles(), CANDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [loadCandles]);

  const market = data?.market ?? null;
  const egsi = data?.egsi ?? null;
  const closes = candles.map((c) => c.close);
  const change = percentChange(closes.slice(-Math.min(closes.length, 288)));
  const band = egsi ? stressBand(egsi.score) : null;
  const live = data !== null && error === null;

  return (
    <>
      <div className="topbar">
        <span className="brand">GASX</span>
        <span className="pair">EGSI-1H</span>

        <div className="stat">
          <span className="k">Index</span>
          <span
            className="v big num"
            style={{ color: change === null ? undefined : change >= 0 ? 'var(--up)' : 'var(--down)' }}
          >
            {egsi ? egsi.score : '—'}
          </span>
        </div>

        <div className="stat">
          <span className="k">24h change</span>
          <span className={`v num ${change === null ? '' : change >= 0 ? 'up' : 'down'}`}>
            {change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
          </span>
        </div>

        <div className="stat">
          <span className="k">State</span>
          <span className="v">{band ? bandLabel(band) : '—'}</span>
        </div>

        <div className="stat">
          <span className="k">Oracle</span>
          <span className="v num">
            {market?.oracle.hasPrice ? market.oracle.price : 'unpublished'}
          </span>
        </div>

        <div className="stat">
          <span className="k">Expiry</span>
          <span className="v num">
            {market ? (timeToExpiry(market.expiryMs, nowMs) ?? 'expired') : '—'}
          </span>
        </div>

        <span className="push" />
        <ConnectButton />
      </div>

      {error && !data && (
        <div className="msg err" style={{ margin: '8px' }}>
          {error} Start the gateway with <code>npm run dev</code> in <code>api/</code>.
        </div>
      )}

      {data && market && (
        <div className="layout">
          <div className="stack">
            <div className="card">
              <div className="toolbar">
                {INTERVALS.map((i) => (
                  <button
                    key={i.seconds}
                    className="chip"
                    aria-pressed={interval === i.seconds}
                    onClick={() => setIntervalSeconds(i.seconds)}
                  >
                    {i.label}
                  </button>
                ))}
                <span className="sep" />
                <button className="chip" aria-pressed={showEmas} onClick={() => setShowEmas((v) => !v)}>
                  EMA 12/26
                </button>
                <button
                  className="chip"
                  aria-pressed={showBollinger}
                  onClick={() => setShowBollinger((v) => !v)}
                >
                  Bollinger
                </button>
                <span className="push" />
                <span className="tag muted">{candles.length} bars</span>
              </div>
              {candles.length === 0 ? (
                <div className="inner">
                  <p className="empty">
                    No candles yet. They build from stored EGSI readings — check the database is
                    running.
                  </p>
                </div>
              ) : (
                <CandleChart candles={candles} showBollinger={showBollinger} showEmas={showEmas} />
              )}
            </div>

            <Indicators closes={closes} />
          </div>

          <div className="stack">
            <DepthLadder book={data.orderbook} quote={data.quote} />
            <div className="card">
              <h2>Index components</h2>
              <div className="inner">
                <DriverBars components={egsi?.components ?? null} />
              </div>
            </div>
            <MarketPanel market={market} nowMs={nowMs} />
          </div>

          <div className="stack">
            <ForecastPanel forecast={data.forecast} />
            <OrderTicket market={market} onFilled={loadMarket} />
            <HedgePanel egsiLevel={egsi?.score ?? null} />
          </div>
        </div>
      )}

      <div className="status">
        <span>
          <span className={live ? 'dot' : 'dot off'}>●</span> {live ? 'Live' : 'Disconnected'}
        </span>
        <span>Market {MARKET_POLL_MS / 1000}s</span>
        <span>Candles {CANDLE_POLL_MS / 1000}s</span>
        {market && <span>{market.settled ? 'Settled' : market.paused ? 'Paused' : 'Open'}</span>}
        {market && <span>Oracle {market.oracle.isFreshApprox ? 'fresh' : 'stale'}</span>}
        <span className="push">Settlement Sui · Hedge Thetanuts/Base</span>
      </div>
    </>
  );
}
