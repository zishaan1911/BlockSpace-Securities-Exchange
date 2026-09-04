import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import {
  getCandles,
  getMarket,
  type Candle,
  type MarketSnapshot,
} from './lib/api';
import { AppHeader, type AppTab } from './components/AppHeader';
import { LandingPage } from './components/LandingPage';
import { WalletModal } from './components/WalletModal';
import { MarketDashboard } from './components/MarketDashboard';
import { TradePage, type SessionTrade } from './components/TradePage';
import { HedgePage } from './components/HedgePage';
import { AnalyticsPage } from './components/AnalyticsPage';

function SessionPositions({ trades }: { trades: SessionTrade[] }) {
  return (
    <section className="card positions-card">
      <div className="card-heading">
        <div>
          <h2>Open Positions</h2>
          <span className="section-note">Session activity</span>
        </div>
      </div>

      {trades.length ? (
        <div className="positions-table-wrap">
          <table className="positions-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Side</th>
                <th>Size</th>
                <th>Entry Price</th>
                <th>Sui Digest</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => (
                <tr key={trade.digest}>
                  <td>EGSI-1H</td>
                  <td className={trade.side === 'long' ? 'positive-text' : 'negative-text'}>
                    {trade.side[0]!.toUpperCase() + trade.side.slice(1)}
                  </td>
                  <td>{trade.quantity}</td>
                  <td>{trade.price.toFixed(2)}</td>
                  <td title={trade.digest}>{trade.digest.slice(0, 14)}…</td>
                  <td>
                    <span className="session-chip">Executed</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="positions-empty">
          <b>No session trades yet.</b>
          <span>
            Your current repository does not have a position indexer, so GASX only shows trades
            executed in this browser session here.
          </span>
        </div>
      )}
    </section>
  );
}

function timestampToSeconds(timestamp: number | undefined): number | null {
  if (!Number.isFinite(timestamp)) return null;
  const value = timestamp!;
  return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

/**
 * Build real, session-local 1-minute OHLC candles from the live EGSI snapshots
 * the browser actually receives. This is only used when /api/v1/candles has no
 * saved history yet.
 */
function appendLiveSnapshot(
  current: Candle[],
  snapshot: MarketSnapshot,
): Candle[] {
  const observedAt = timestampToSeconds(snapshot.egsi.timestamp) ?? Math.floor(Date.now() / 1000);
  const bucket = Math.floor(observedAt / 60) * 60;
  const score = snapshot.egsi.score;

  if (!Number.isFinite(score)) return current;

  const next = [...current];
  const last = next.at(-1);

  if (last && last.time === bucket) {
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, score),
      low: Math.min(last.low, score),
      close: score,
    };
  } else if (!last || bucket > last.time) {
    next.push({
      time: bucket,
      open: score,
      high: score,
      low: score,
      close: score,
    });
  }

  return next.slice(-240);
}

function mergeCandles(apiCandles: Candle[], sessionCandles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of apiCandles) byTime.set(candle.time, candle);
  for (const candle of sessionCandles) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export default function App() {
  const account = useCurrentAccount();

  const [view, setView] = useState<'landing' | 'app'>('landing');
  const [tab, setTab] = useState<AppTab>('market');
  const [walletOpen, setWalletOpen] = useState(false);

  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [apiCandles, setApiCandles] = useState<Candle[]>([]);
  const [sessionCandles, setSessionCandles] = useState<Candle[]>([]);

  const [loading, setLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
  const [sessionTrades, setSessionTrades] = useState<SessionTrade[]>([]);

  const candles = useMemo(
    () => mergeCandles(apiCandles, sessionCandles),
    [apiCandles, sessionCandles],
  );

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const [marketResult, candleResult] = await Promise.allSettled([
        getMarket(),
        getCandles(),
      ]);

      if (marketResult.status === 'fulfilled') {
        const nextSnapshot = marketResult.value;
        setSnapshot(nextSnapshot);
        setMarketError('');
        setSessionCandles((current) => appendLiveSnapshot(current, nextSnapshot));
      } else {
        setMarketError(
          marketResult.reason instanceof Error
            ? marketResult.reason.message
            : 'Could not load live market',
        );
      }

      if (candleResult.status === 'fulfilled') {
        setApiCandles(candleResult.value);

        if (candleResult.value.length === 0) {
          setHistoryNotice(
            'No saved EGSI candles were returned yet. GASX is showing real session history as live snapshots arrive.',
          );
        } else {
          setHistoryNotice('');
        }
      } else {
        setHistoryNotice(
          `Historical candles are unavailable (${candleResult.reason instanceof Error ? candleResult.reason.message : 'request failed'}). GASX is showing real session history instead.`,
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== 'app') return;

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);

    return () => window.clearInterval(timer);
  }, [view, refresh]);

  useEffect(() => {
    if (account && walletOpen) setWalletOpen(false);
  }, [account, walletOpen]);

  function launch(tabTarget: AppTab = 'market') {
    setView('app');
    setTab(tabTarget);
  }

  return (
    <>
      {view === 'landing' ? (
        <LandingPage
          onLaunch={() => launch('market')}
          onConnect={() => setWalletOpen(true)}
        />
      ) : (
        <div className="app-shell">
          <AppHeader
            active={tab}
            onTab={setTab}
            onConnect={() => setWalletOpen(true)}
            onHome={() => setView('landing')}
          />

          <main className="app-main">
            {marketError && (
              <div className="top-error">
                <b>Live API:</b> {marketError}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            )}

            {historyNotice && <div className="history-notice">{historyNotice}</div>}

            {tab === 'market' && (
              <MarketDashboard
                snapshot={snapshot}
                candles={candles}
                loading={loading}
                error={marketError}
                onTrade={() => setTab('trade')}
              />
            )}

            {tab === 'trade' && (
              <>
                <TradePage
                  snapshot={snapshot}
                  candles={candles}
                  onTrade={(trade) =>
                    setSessionTrades((current) => [trade, ...current])
                  }
                />
                <SessionPositions trades={sessionTrades} />
              </>
            )}

            {tab === 'hedge' && <HedgePage snapshot={snapshot} />}
            {tab === 'analytics' && (
              <AnalyticsPage snapshot={snapshot} candles={candles} />
            )}
          </main>

          <footer className="app-footer">
            <span>GASX · AI-native Ethereum gas futures</span>
            <span>Trading on Sui · Hedging on Thetanuts / Base</span>
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              Charts by TradingView
            </a>
          </footer>
        </div>
      )}

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </>
  );
}
