/**
 * The terminal screen.
 *
 * Three columns, ordered the way a trader reads: what the index is
 * doing (left), what it is worth and where it trades (centre), what you
 * can do about it (right). One screen, because there is one market
 * (ARCHITECTURE.md §12) and navigation would be chrome around a single
 * view.
 *
 * Density is deliberate. A terminal is scanned for a number, not
 * browsed, so panels sit tight together and every value is on screen at
 * once rather than behind a tab.
 */
import { useCallback, useEffect, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { api, ApiError, type MarketResponse } from './lib/api';
import { EgsiReadout } from './components/EgsiReadout';
import { DepthLadder } from './components/DepthLadder';
import { DriverBars } from './components/DriverBars';
import { ForecastPanel, MarketPanel } from './components/Panels';
import { OrderTicket } from './components/OrderTicket';
import { HedgePanel } from './components/HedgePanel';
import { timeToExpiry } from './lib/egsi';

const POLL_MS = 5_000;
// Long enough to show a trend, short enough to stay legible at sparkline
// size.
const HISTORY_POINTS = 240;

export default function App() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api.getMarket());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gateway unreachable.');
    }
    // History fails soft: a terminal without a chart is still usable, so
    // a missing database should not blank the whole screen.
    try {
      const { history: points } = await api.getHistory(HISTORY_POINTS);
      setHistory(points.map((p) => p.score));
    } catch {
      /* leave the previous series in place */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
      setNowMs(Date.now());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const market = data?.market ?? null;
  const live = data !== null && error === null;
  const expiry = market ? timeToExpiry(market.expiryMs, nowMs) : null;

  return (
    <>
      <div className="cmdbar">
        <span className="ticker">GASX</span>
        <span className="field">EGSI-1H</span>
        <span className="field">Ethereum gas futures</span>
        {market && <span className="field">Exp {expiry ?? 'expired'}</span>}
        <span className="spacer" />
        <ConnectButton />
      </div>

      {error && !data && (
        <div className="msg err" style={{ margin: '0.4rem' }}>
          {error} Start it with <code>npm run dev</code> in <code>api/</code>.
        </div>
      )}

      {!error && !data && <p className="empty" style={{ padding: '0.6rem' }}>Connecting…</p>}

      {data && market && (
        <>
          {error && <div className="msg warn" style={{ margin: '0.4rem' }}>{error} Showing last values.</div>}

          <div className="screen">
            <div className="col">
              <EgsiReadout
                score={data.egsi?.score ?? null}
                blockNumber={data.egsi?.block_number ?? null}
                history={history}
              />
              <div className="panel">
                <header><span>Index components</span></header>
                <div className="body">
                  <DriverBars components={data.egsi?.components ?? null} />
                </div>
              </div>
            </div>

            <div className="col">
              <DepthLadder book={data.orderbook} quote={data.quote} />
              <ForecastPanel forecast={data.forecast} />
              <MarketPanel market={market} nowMs={nowMs} />
            </div>

            <div className="col">
              <OrderTicket market={market} onFilled={load} />
              <HedgePanel egsiLevel={data.egsi?.score ?? null} />
            </div>
          </div>
        </>
      )}

      <div className="statusbar">
        <span>
          <span className={live ? 'dot' : 'dot off'}>●</span> {live ? 'Live' : 'Stale'}
        </span>
        <span>Poll {POLL_MS / 1000}s</span>
        <span>History {history.length}</span>
        {market && <span>{market.settled ? 'Settled' : market.paused ? 'Paused' : 'Open'}</span>}
        {market && <span>Oracle {market.oracle.isFreshApprox ? 'fresh' : 'stale'}</span>}
        <span style={{ marginLeft: 'auto' }}>Settlement Sui · Hedge Thetanuts/Base</span>
      </div>
    </>
  );
}
