import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import type { Candle, MarketSnapshot } from '../lib/api';
import { prepareOrder } from '../lib/api';
import { PriceChart, type ChartMode } from './Charts';

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

/**
 * Rounds to the nearest valid tick, then to the nearest integer.
 *
 * The gateway's checkOrderRisk rejects any price that is not a whole
 * integer AND a multiple of the market's tick size. The previous
 * default price came straight from quote.mid / forecast.expected --
 * both real numbers, e.g. 293.4 -- so the very first thing a trader saw
 * pre-filled in the price field was already invalid, and hitting submit
 * without touching it failed immediately. This is applied both to the
 * default price and on every edit, so a request that would be rejected
 * is corrected before it is ever sent rather than round-tripping to the
 * gateway to find out.
 */
export function snapToTick(value: number, tickSize: number): number {
  const tick = Number.isFinite(tickSize) && tickSize > 0 ? tickSize : 1;
  if (!Number.isFinite(value)) return tick;
  return Math.max(tick, Math.round(value / tick) * tick);
}

/**
 * quantity is a Move u64 on-chain -- a genuine whole number, not
 * something a redeploy-free frontend change can make fractional. 0.01
 * granularity is provided here as a scaling CONVENTION instead: one
 * raw on-chain unit is treated as 0.01 "contracts" in this UI. A
 * trader entering "0.25" sends the integer 25 as `quantity`; the
 * gateway and Move contract never see or need to know about the
 * convention, they just see a slightly larger integer than before.
 * MAX_ORDER_CONTRACTS and similar caps now apply to this same raw
 * integer, so they cap a correspondingly smaller real position than
 * their number alone suggests -- a safer, not a worse, outcome for a
 * testnet deployment.
 */
export const CONTRACT_SCALE = 100;
export const MIN_DISPLAY_QUANTITY = 1 / CONTRACT_SCALE;

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
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [chartMode, setChartMode] = useState<ChartMode>('candle');
  // Plain number inputs: keep the raw strings so clearing/typing is
  // natural, and derive the number only where it's used.
  const [sizeInput, setSizeInput] = useState('0.05');
  const displayQuantity = Number(sizeInput) || 0;
  const market = snapshot?.market;
  const tickSize = Number.isFinite(market?.tickSize) ? market!.tickSize! : 1;

  // The best available reference price, used both as the Limit
  // field's starting point and as Market orders' fixed price -- the
  // freshest real number wins: a live, fresh oracle price is realer
  // than an indicative engine quote, which is realer than the AI
  // forecast's own prediction.
  // Must mirror api/src/routes/orders.ts's OWN gate exactly:
  // `referencePrice = market.oracle.hasPrice ? market.oracle.price :
  // undefined` -- the backend's slippage check keys on hasPrice alone,
  // NOT freshness. Gating this on oracleFresh instead (as an earlier
  // version of this file did) meant the frontend priced Market orders,
  // and pre-filled Limit orders, against a completely different number
  // (quote.mid / forecast.expected / egsi.score) whenever the oracle had
  // a price but was not flagged fresh -- which then failed the
  // backend's MAX_SLIPPAGE check against the oracle price it actually
  // used, on every single order. Confirmed against a live report: an
  // order priced at the live EGSI score was rejected as "more than
  // MAX_SLIPPAGE (100 bps) from the reference price (165)" -- 165 being
  // the real oracle price the backend validated against, which this
  // component was not even using.
  const bestReferencePrice = market?.oracleHasPrice && Number.isFinite(market.oraclePrice)
    ? market.oraclePrice
    : (snapshot?.quote.mid ?? snapshot?.forecast.expected ?? snapshot?.egsi.score ?? 0);

  const [priceInput, setPriceInput] = useState<string>(() => String(snapToTick(bestReferencePrice, tickSize)));

  // Re-snap the Limit default whenever the reference price or tick size
  // changes AND the trader has not started typing their own price yet.
  const [priceTouched, setPriceTouched] = useState(false);
  useEffect(() => {
    if (!priceTouched) setPriceInput(String(snapToTick(bestReferencePrice, tickSize)));
  }, [bestReferencePrice, tickSize, priceTouched]);

  // Market orders always use the live reference price -- see the
  // honest caveat rendered near the order button below for exactly
  // what that does and does not guarantee on this contract.
  const price = Number(priceInput) || 0;
  const effectivePrice = orderType === 'market' ? snapToTick(bestReferencePrice, tickSize) : snapToTick(price, tickSize);

  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const multiplier = Number.isFinite(market?.contractMultiplier) ? market!.contractMultiplier! : 1;
  const marginRate = Number.isFinite(market?.marginRate) ? market!.marginRate! : 0.2;
  // Local math (notional, margin, everything shown on screen) uses the
  // fractional display quantity directly -- only the actual API
  // request converts to the scaled-up on-chain integer.
  const notional = Math.abs(effectivePrice * displayQuantity * multiplier);
  const margin = notional * marginRate;
  const asks = snapshot?.orderbook.asks ?? [];
  const bids = snapshot?.orderbook.bids ?? [];
  const canSubmit = Boolean(
    account && accountId && displayQuantity >= MIN_DISPLAY_QUANTITY && effectivePrice > 0 && !market?.devMode && !busy,
  );
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
    // The scaling convention lives entirely at this one boundary: what
    // the trader sees and edits is displayQuantity (e.g. 0.05); what
    // goes on-chain is this integer, and the gateway/Move contract never
    // know the display value existed.
    const onChainQuantity = Math.max(1, Math.round(displayQuantity * CONTRACT_SCALE));

    try {
      const prepared = await prepareOrder({
        marketId: market.id,
        accountId,
        owner: account.address,
        side,
        price: effectivePrice,
        quantity: onChainQuantity,
      });
      setMessage('Approved. Confirm the transaction in your Sui wallet…');
      const result = await dAppKit.signAndExecuteTransaction({ transaction: prepared.transaction });
      const digest = txDigest(result);
      if (!digest) throw new Error('Transaction returned without a digest. Check wallet/network response.');
      onTrade({ digest, side, quantity: displayQuantity, price: effectivePrice, time: Date.now() });
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
          <label className="field">
            <span>Order Type</span>
            <div className="side-switch">
              <button className={orderType === 'limit' ? 'active' : ''} onClick={() => setOrderType('limit')}>Limit</button>
              <button className={orderType === 'market' ? 'active' : ''} onClick={() => setOrderType('market')}>Market</button>
            </div>
          </label>
          {orderType === 'limit' ? (
            <label className="field">
              <span>Limit Price <small>EGSI points · tick {tickSize}</small></span>
              <input
                type="number"
                step={tickSize}
                value={priceInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  setPriceTouched(true);
                  setPriceInput(e.target.value);
                }}
              />
            </label>
          ) : (
            <label className="field">
              <span>Market Price <small>current reference</small></span>
              <div className="field-static">
                {effectivePrice.toFixed(0)}
                <small>
                  Fills at the current reference price. GASX's on-chain book matches orders in a
                  separate step, so this places the order at that price rather than guaranteeing
                  an instant fill.
                </small>
              </div>
            </label>
          )}
          <label className="field"><span>Size <small>contracts · min {MIN_DISPLAY_QUANTITY}</small></span><input type="number" min={MIN_DISPLAY_QUANTITY} step={MIN_DISPLAY_QUANTITY} value={sizeInput} onChange={(e: ChangeEvent<HTMLInputElement>) => setSizeInput(e.target.value)} /></label>
          <label className="field"><span>Margin Account ID</span><input value={accountId} onChange={(e: ChangeEvent<HTMLInputElement>) => setAccountId(e.target.value)} placeholder="0x…" /></label>
          <div className="order-summary"><div><span>Notional Value</span><b>${notional.toFixed(2)}</b></div><div><span>Est. Margin</span><b>${margin.toFixed(2)}</b></div><div><span>Collateral</span><b>USDC</b></div></div>
          <button className={`button order-button ${side === 'short' ? 'short-button' : 'button-primary'}`} disabled={!canSubmit} onClick={() => void submit()}>{!account ? 'Connect wallet to trade' : market?.devMode ? 'Deploy Sui market to trade' : busy ? 'Processing…' : 'Review & Sign  ◇'}</button>
          {message && <div className={message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? 'inline-error' : 'inline-message'}>{message}</div>}
        </section>

        <section className="card price-chart-card">
          <div className="card-heading chart-heading"><div><span className="section-kicker">EGSI MARKET</span><h2>Price Chart</h2></div><div className="chart-heading-controls">
            <div className="timeframes">
              <button className={chartMode === 'line' ? 'active' : ''} onClick={() => setChartMode('line')}>Line</button>
              <button className={chartMode === 'candle' ? 'active' : ''} onClick={() => setChartMode('candle')}>Candle</button>
            </div>
            <div className="timeframes">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.seconds}
                  className={tf.seconds === intervalSeconds ? 'active' : ''}
                  onClick={() => onIntervalChange(tf.seconds)}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div></div>
          <div className="main-candle-chart">{candles.length ? <PriceChart candles={candles} mode={chartMode} /> : <div className="chart-empty">Waiting for candle history…</div>}</div>
          <div className="chart-metrics">
            <div><strong>{lastCandle ? lastCandle.close.toFixed(1) : bestReferencePrice.toFixed(1)}</strong><span>Last EGSI</span></div>
            <div><strong className={change !== null && change < 0 ? 'negative-text' : 'positive-text'}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</strong><span>24h Change</span></div>
            <div><strong>{snapshot?.forecast.expected.toFixed(1) ?? '—'}</strong><span>AI Forecast</span></div>
            <div><strong>{snapshot ? `${Math.round(snapshot.forecast.confidence * 100)}%` : '—'}</strong><span>Confidence</span></div>
          </div>
        </section>

        <section className="card orderbook-card">
          <div className="card-heading"><div><h2>Order Book</h2><span className="section-note">Indicative</span></div></div>
          <div className="book-head"><span>Price</span><span>Size</span></div>
          <div className="book-rows asks">{bookRows.asks.length ? bookRows.asks.map((row, i) => <div key={`${row.price}-${i}`}><span>{row.price.toFixed(2)}</span><b>{row.size}</b></div>) : <div className="book-empty">No asks</div>}</div>
          <div className="book-mid"><strong>{(snapshot?.quote.mid ?? bestReferencePrice).toFixed(2)}</strong><span>AI-derived fair level</span></div>
          <div className="book-rows bids">{bookRows.bids.length ? bookRows.bids.map((row, i) => <div key={`${row.price}-${i}`}><span>{row.price.toFixed(2)}</span><b>{row.size}</b></div>) : <div className="book-empty">No bids</div>}</div>
          <div className="indicative-note">Indicative depth is generated from quoting logic, not indexed resting orders.</div>
        </section>
      </div>
    </div>
  );
}
