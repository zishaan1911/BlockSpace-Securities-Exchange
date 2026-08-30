import { useCurrentAccount, useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useEffect, useMemo, useState } from 'react';
import {
  GASX_PACKAGE_ID,
  NETWORK_CHAIN,
  buildPlaceOrderTx,
} from '../lib/sui';
import type { MarketState, OrderRequest, Side } from '../lib/types';

interface OrderFormProps {
  state: MarketState | null;
  mode: 'mock' | 'live';
  submitting: boolean;
  onSubmit: (order: OrderRequest) => Promise<{ ok: boolean; message: string; digest?: string }>;
}

export function OrderForm({ state, mode, submitting, onSubmit }: OrderFormProps) {
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [side, setSide] = useState<Side>('LONG');
  const [qty, setQty] = useState(5);
  const [price, setPrice] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string; digest?: string } | null>(null);

  const mid = state ? (state.orderBook.bids[0].price + state.orderBook.asks[0].price) / 2 : 0;
  const bestAsk = state?.orderBook.asks[0].price ?? 0;
  const bestBid = state?.orderBook.bids[0].price ?? 0;

  useEffect(() => {
    if (!price && bestAsk) setPrice(String(bestAsk));
  }, [bestAsk, price]);

  const priceNum = Number(price) || 0;
  const margin = useMemo(
    () => Math.round(priceNum * qty * (state?.meta.multiplier ?? 1) * 100) / 100,
    [priceNum, qty, state],
  );
  const payout = useMemo(
    () =>
      Math.round(
        ((state?.forecast.expectedEgsi ?? 0) - priceNum) * qty * (state?.meta.multiplier ?? 1) * 100,
      ) / 100,
    [state, priceNum, qty],
  );

  const canTradeOnChain = mode === 'live' && !!account && !!GASX_PACKAGE_ID;

  const handleSubmit = async () => {
    if (qty <= 0 || priceNum <= 0) {
      setFeedback({ ok: false, text: 'Enter a quantity and a valid price.' });
      return;
    }
    const order: OrderRequest = { side, qty, price: priceNum };

    if (canTradeOnChain) {
      const tx = buildPlaceOrderTx(order);
      if (!tx) {
        setFeedback({ ok: false, text: 'Transaction builder not ready (missing package id).' });
        return;
      }
      try {
        const result = await signAndExecute({ transaction: tx, chain: NETWORK_CHAIN });
        setFeedback({
          ok: true,
          text: 'Order executed on Sui.',
          digest: result.digest,
        });
      } catch (err) {
        setFeedback({
          ok: false,
          text: `Transaction failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    const result = await onSubmit(order);
    setFeedback({ ok: result.ok, text: result.message, digest: result.digest });
  };

  return (
    <div className="card">
      <h2>Place Order</h2>
      <div className="side-toggle">
        <button
          className={side === 'LONG' ? 'active long' : ''}
          onClick={() => setSide('LONG')}
          type="button"
        >
          LONG ▲
        </button>
        <button
          className={side === 'SHORT' ? 'active short' : ''}
          onClick={() => setSide('SHORT')}
          type="button"
        >
          SHORT ▼
        </button>
      </div>

      <label className="field">
        <span>Quantity (contracts)</span>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
        />
      </label>

      <label className="field">
        <span>Limit price</span>
        <div className="price-row">
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={String(Math.round(mid))}
          />
          <button type="button" className="chip" onClick={() => setPrice(String(bestBid))}>
            Bid {bestBid}
          </button>
          <button type="button" className="chip" onClick={() => setPrice(String(bestAsk))}>
            Ask {bestAsk}
          </button>
        </div>
      </label>

      <dl className="meta-grid">
        <dt>Margin (locked USDC)</dt>
        <dd className="mono">{margin.toFixed(2)}</dd>
        <dt>Est. payout if forecast hits</dt>
        <dd className={`mono ${payout >= 0 ? 'pos' : 'neg'}`}>
          {payout >= 0 ? '+' : ''}
          {payout.toFixed(2)} USDC
        </dd>
      </dl>

      <button className="primary" onClick={handleSubmit} disabled={submitting} type="button">
        {submitting ? 'Submitting…' : side === 'LONG' ? 'Buy (Long)' : 'Sell (Short)'}
      </button>

      {mode === 'live' && !account && (
        <div className="form-note">Connect a Sui wallet to trade on-chain.</div>
      )}
      {mode === 'live' && account && !GASX_PACKAGE_ID && (
        <div className="form-note">
          Gasx package not deployed yet (VITE_GASX_PACKAGE_ID empty) — order will be routed via the API.
        </div>
      )}
      {mode === 'mock' && (
        <div className="form-note">Simulated feed: orders fill locally, no chain involved.</div>
      )}

      {feedback && (
        <div className={`feedback ${feedback.ok ? 'ok' : 'err'}`}>
          {feedback.text}
          {feedback.digest && (
            <a
              className="tx-link"
              href={`https://suiscan.xyz/testnet/tx/${feedback.digest}`}
              target="_blank"
              rel="noreferrer"
            >
              view on Suiscan ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
