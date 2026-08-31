/**
 * The market screen. One page, because there is one market
 * (ARCHITECTURE.md §12: "Product: EGSI-1H futures, single market") —
 * navigation between screens would be chrome around a single view.
 *
 * Layout follows the read-then-act order a trader actually works in:
 * the index reading and what's driving it on the left, then forecast,
 * market terms, order ticket and hedge on the right.
 */
import { useCallback, useEffect, useState } from 'react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { api, ApiError, type MarketResponse } from './lib/api';
import { EgsiGauge } from './components/EgsiGauge';
import { DriverBars } from './components/DriverBars';
import { ForecastPanel, MarketPanel } from './components/Panels';
import { OrderTicket } from './components/OrderTicket';
import { HedgePanel } from './components/HedgePanel';

// The AI service auto-cycles on Ethereum's ~12s block time, so polling
// much faster than this cannot surface a new reading — there is no new
// block to have read. 5s keeps the screen within a few seconds of the
// chain without hammering the gateway for values that have not changed.
const POLL_MS = 5_000;

export default function App() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setData(await api.getMarket());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong loading the market.');
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => {
      void load();
      setNowMs(Date.now());
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          GASX<span>Ethereum gas futures</span>
        </h1>
        <ConnectButton />
      </header>

      {error && !data && (
        <div className="notice bad">
          {error} Start the gateway with <code>npm run dev</code> in <code>api/</code>, then reload.
        </div>
      )}

      {!error && !data && <p className="empty">Loading the market…</p>}

      {data && (
        <>
          {error && (
            <div className="notice warn" style={{ marginBottom: 'var(--gutter)' }}>
              {error} Showing the last reading received.
            </div>
          )}

          <div className="grid">
            <div className="stack">
              <div className="panel">
                <div className="panel-head">
                  <h2>Gas Stress Index</h2>
                  <span className="panel-note">
                    {data.egsi ? `block ${data.egsi.block_number}` : 'no reading'}
                  </span>
                </div>
                <EgsiGauge score={data.egsi?.score ?? null} />
              </div>

              <div className="panel">
                <div className="panel-head">
                  <h2>What's driving it</h2>
                </div>
                <DriverBars components={data.egsi?.components ?? null} />
              </div>
            </div>

            <div className="stack">
              <ForecastPanel forecast={data.forecast} />
              <MarketPanel market={data.market} nowMs={nowMs} />
              <OrderTicket market={data.market} onFilled={load} />
              <HedgePanel egsiLevel={data.egsi?.score ?? null} />
            </div>
          </div>
        </>
      )}

      <footer className="foot">
        Futures settle on Sui. Hedges trade on Thetanuts, on Base mainnet, with real funds.
      </footer>
    </div>
  );
}
