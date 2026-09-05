import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import type { Candle, MarketSnapshot } from '../lib/api';
import { prepareOrder } from '../lib/api';
import { CandleChart } from './Charts';

export interface SessionTrade {
  digest: string;
  side: 'long' | 'short';
  quantity: number;
  price: number;
  time: number;
}

function txDigest(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const root = result as Record<string, unknown>;
  const direct = root.digest;
  if (typeof direct === 'string') return direct;
  const tx = root.Transaction;
  if (tx && typeof tx === 'object' && typeof (tx as Record<string, unknown>).digest === 'string') return String((tx as Record<string, unknown>).digest);
  return '';
}

const TIMEFRAMES = [
  { label: '1m', seconds: 60 },
  { label: '5m', seconds: 300 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
  { label: '1d', seconds: 86400 },
] as const;

export function TradePage({ snapshot, candles, intervalSeconds, onIntervalChange, onTrade }: {
  snapshot: MarketSnapshot | null;
  candles: Candle[];
  intervalSeconds: number;
  onIntervalChange: (seconds: number) => void;
  onTrade: (trade: SessionTrade) => void;
}) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [quantity, setQuantity] = useState(5);
  const defaultPrice = snapshot?.quote.mid ?? snapshot?.forecast.expected ?? snapshot?.egsi.score ?? 0;
  const [price, setPrice] = useState<number>(defaultPrice);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const market = snapshot?.market;
  const multiplier = Number.isFinite(market?.contractMultiplier) ? market!.contractMultiplier! : 1;
  const marginRate = Number.isFinite(market?.marginRate) ? market!.marginRate! : 0.2;
  const effectivePrice = price || defaultPrice;
  const notional = Math.abs(effectivePrice * quantity * multiplier);
  const margin = notional * marginRate;
  const asks = snapshot?.orderbook.asks ?? [];
  const bids = snapshot?.orderbook.bids ?? [];
  const canSubmit = Boolean(account && accountId && quantity > 0 && effectivePrice > 0 && !market?.devMode && !busy);
  const lastCandle = candles.at(-1);
  const firstCandle = candles[0];
  const change = firstCandle && lastCandle && firstCandle.close ? ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100 : null;

  const bookRows = useMemo(() => ({
    asks: asks.slice(0, 5).reverse(),
    bids: bids.slice(0, 5),
  }), [asks, bids]);

  async function submit() {
    if (!account || !market) return;
    setBusy(true);
    setMessage('Preparing transaction through GASX risk checks…');
    try {
      const prepared = await prepareOrder({
        marketId: market.id,
        accountId,
        owner: account.address,
        side,
        price: effectivePrice,
        quantity,
      });
      setMessage('Approved. Confirm the transaction in your Sui wallet…');
      const result = await dAppKit.signAndExecuteTransaction({ transaction: prepared.transaction });
      const digest = txDigest(result);
      if (!digest) throw new Error('Transaction returned without a digest. Check wallet/network response.');
      onTrade({ digest, side, quantity, price: effectivePrice, time: Date.now() });
      setMessage(`Order executed on Sui · ${digest.slice(0, 12)}…`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="trade-page">
      {market?.devMode && <div className="dev-banner"><b>DEV MARKET</b> The gateway is serving a synthetic market, so transaction preparation is disabled until Sui contracts are deployed.</div>}
      <div className="trade-grid">
        <section className="card order-ticket-card">
          <div className="card-heading"><div><span className="section-kicker">SUI FUTURES</span><h2>Place Order</h2></div></div>
          <div className="side-switch"><button className={side === 'long' ? 'long active' : ''} onClick={() => setSide('long')}>Long</button><button className={side === 'short' ? 'short active' : ''} onClick={() => setSide('short')}>Short</button></div>
          <label className="field"><span>Contract</span><div className="field-static">{market?.label ?? 'EGSI-1H'} <small>1 hour</small></div></label>
          <label className="field"><span>Order Type</span><div className="field-static">Limit <small>on-chain</small></div></label>
          <label className="field"><span>Limit Price <small>EGSI points</small></span><input type="number" value={price || ''} onChange={(e: ChangeEvent<HTMLInputElement>) => setPrice(Number(e.target.value))} placeholder={defaultPrice.toFixed(1)} /></label>
          <label className="field"><span>Size <small>contracts</small></span><input type="number" min="1" step="1" value={quantity} onChange={(e: ChangeEvent<HTMLInputElement>) => setQuantity(Math.max(1, Number(e.target.value) || 1))} /></label>
          <label className="field"><span>Margin Account ID</span><input value={accountId} onChange={(e: ChangeEvent<HTMLInputElement>) => setAccountId(e.target.value)} placeholder="0x…" /></label>
          <div className="order-summary"><div><span>Notional Value</span><b>${notional.toFixed(2)}</b></div><div><span>Est. Margin</span><b>${margin.toFixed(2)}</b></div><div><span>Collateral</span><b>USDC</b></div></div>
          <button className={`button order-button ${side === 'short' ? 'short-button' : 'button-primary'}`} disabled={!canSubmit} onClick={() => void submit()}>{!account ? 'Connect wallet to trade' : market?.devMode ? 'Deploy Sui market to trade' : busy ? 'Processing…' : 'Review & Sign  ◇'}</button>
          {message && <div className={message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? 'inline-error' : 'inline-message'}>{message}</div>}
        </section>

        <section className="card price-chart-card">
          <div className="card-heading chart-heading"><div><span className="section-kicker">EGSI MARKET</span><h2>Price Chart</h2></div><div className="timeframes">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.seconds}
                className={tf.seconds === intervalSeconds ? 'active' : ''}
                onClick={() => onIntervalChange(tf.seconds)}
              >
                {tf.label}
              </button>
            ))}
          </div></div>
          <div className="main-candle-chart">{candles.length ? <CandleChart candles={candles} /> : <div className="chart-empty">Waiting for candle history…</div>}</div>
          <div className="chart-metrics">
            <div><strong>{lastCandle ? lastCandle.close.toFixed(1) : defaultPrice.toFixed(1)}</strong><span>Last EGSI</span></div>
            <div><strong className={change !== null && change < 0 ? 'negative-text' : 'positive-text'}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</strong><span>24h Change</span></div>
            <div><strong>{snapshot?.forecast.expected.toFixed(1) ?? '—'}</strong><span>AI Forecast</span></div>
            <div><strong>{snapshot ? `${Math.round(snapshot.forecast.confidence * 100)}%` : '—'}</strong><span>Confidence</span></div>
          </div>
        </section>

        <section className="card orderbook-card">
          <div className="card-heading"><div><h2>Order Book</h2><span className="section-note">Indicative</span></div></div>
          <div className="book-head"><span>Price</span><span>Size</span></div>
          <div className="book-rows asks">{bookRows.asks.length ? bookRows.asks.map((row, i) => <div key={`${row.price}-${i}`}><span>{row.price.toFixed(2)}</span><b>{row.size}</b></div>) : <div className="book-empty">No asks</div>}</div>
          <div className="book-mid"><strong>{(snapshot?.quote.mid ?? defaultPrice).toFixed(2)}</strong><span>AI-derived fair level</span></div>
          <div className="book-rows bids">{bookRows.bids.length ? bookRows.bids.map((row, i) => <div key={`${row.price}-${i}`}><span>{row.price.toFixed(2)}</span><b>{row.size}</b></div>) : <div className="book-empty">No bids</div>}</div>
          <div className="indicative-note">Indicative depth is generated from quoting logic, not indexed resting orders.</div>
        </section>
      </div>
    </div>
  );
}
