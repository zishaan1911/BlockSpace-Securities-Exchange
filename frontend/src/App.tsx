import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import './styles.css';
import {
  getCandles,
  getMarket,
  type Candle,
  type MarketSnapshot,
} from './lib/api';
import { AppHeader } from './components/AppHeader';
import { LandingPage } from './components/LandingPage';
import { WalletModal } from './components/WalletModal';
import { MarketDashboard } from './components/MarketDashboard';
import { TradePage, type SessionTrade } from './components/TradePage';
import { HedgePage } from './components/HedgePage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { ChatWidget } from './components/ChatWidget';

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
            Trades you execute in this session will appear here.
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
  const [walletOpen, setWalletOpen] = useState(false);

  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [apiCandles, setApiCandles] = useState<Candle[]>([]);
  const [sessionCandles, setSessionCandles] = useState<Candle[]>([]);
  // Timeframe (seconds). Previously the 1m/5m/1h/4h/1d buttons on the
  // Trade page were rendered with no onClick at all -- clicking any of
  // them did nothing. This is now real, shared state so choosing one
  // actually re-fetches candles at that bucket width.
  const [intervalSeconds, setIntervalSeconds] = useState(3600);

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
        getCandles(intervalSeconds),
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
  }, [intervalSeconds]);

  useEffect(() => {
    if (view !== 'app') return;

    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);

    return () => window.clearInterval(timer);
  }, [view, refresh]);

  // A change of timeframe should refetch immediately, not wait for the
  // next 15s poll -- and session-built candles (from live snapshots,
  // used as a fallback while the database has no saved history yet) are
  // bucketed at 1 minute, so they no longer make sense once the user
  // picks a different bucket width; refresh() will replace them with
  // real candles at the new width, or App falls back to an empty list
  // until the next live snapshot arrives.
  useEffect(() => {
    setSessionCandles([]);
  }, [intervalSeconds]);

  useEffect(() => {
    if (account && walletOpen) setWalletOpen(false);
  }, [account, walletOpen]);

  // Ensures the single Markets page is visible, then optionally scrolls
  // to one of its sections. Previously this switched WHICH page was
  // rendered (market/trade/hedge/analytics as separate views); now there
  // is only one page, so this only ever needs to reveal it and scroll.
  function goToMarkets(sectionId?: string) {
    setView('app');
    if (sectionId) {
      // Wait a tick for the app view to actually mount (coming from the
      // landing page) before trying to find the section to scroll to.
      requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  return (
    <>
      <AppHeader
        onMarkets={goToMarkets}
        onConnect={() => setWalletOpen(true)}
        onHome={() => setView('landing')}
      />

      {view === 'landing' ? (
        <LandingPage onLaunch={() => goToMarkets()} />
      ) : (
        <div className="app-shell">
          <main className="app-main">
            {marketError && (
              <div className="top-error">
                <b>Live API:</b> {marketError}
                <button onClick={() => void refresh()}>Retry</button>
              </div>
            )}

            {historyNotice && <div className="history-notice">{historyNotice}</div>}

            {/*
              All four sections render together on one page now, instead
              of behind separate tabs where only one was ever visible at
              a time. Each section keeps its own existing markup/classes
              completely unchanged -- only a scroll-target id wrapper is
              added around each, which does not affect layout (.app-main
              is a plain flex container, not a grid keyed to specific
              direct children).
            */}
            <div id="section-overview">
              <MarketDashboard
                snapshot={snapshot}
                loading={loading}
                error={marketError}
                onTrade={() => goToMarkets('section-trade')}
              />
            </div>

            <div id="section-trade">
              <TradePage
                snapshot={snapshot}
                candles={candles}
                intervalSeconds={intervalSeconds}
                onIntervalChange={setIntervalSeconds}
                onTrade={(trade) =>
                  setSessionTrades((current) => [trade, ...current])
                }
              />
              <SessionPositions trades={sessionTrades} />
            </div>

            <div id="section-hedge">
              <HedgePage snapshot={snapshot} />
            </div>

            <div id="section-analytics">
              <AnalyticsPage snapshot={snapshot} candles={candles} />
            </div>
          </main>

          <footer className="app-footer">
            <span>© 2026 GASX · AI-native Ethereum gas futures</span>
            <span>Trading on Sui · Hedging on Thetanuts / Base</span>
            <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
              Charts by TradingView
            </a>
          </footer>
        </div>
      )}

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />

      {/* Persistent floating assistant, not a nav destination -- reachable
          from the landing page or the app view alike. */}
      <ChatWidget />
    </>
  );
}
