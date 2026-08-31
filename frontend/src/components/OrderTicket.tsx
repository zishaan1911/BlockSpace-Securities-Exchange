/**
 * ARCHITECTURE.md §9's Trade Flow, the user-facing half: the gateway
 * prepares a transaction (running its pre-trade risk checks first), the
 * wallet signs and executes it, and the digest comes back.
 *
 * This component never constructs a transaction itself — it sends the
 * order parameters to the gateway and hands whatever comes back to the
 * wallet. That keeps the risk checks unbypassable from the browser:
 * there is no client-side path that produces a signable transaction
 * without the gateway having approved it first.
 */
import { useState } from 'react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { api, ApiError, type MarketState } from '../lib/api';

interface Props {
  market: MarketState;
  onFilled: () => void;
}

export function OrderTicket({ market, onFilled }: Props) {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [isBid, setIsBid] = useState(true);
  const [price, setPrice] = useState('500');
  const [quantity, setQuantity] = useState('5');
  const [marginAccountId, setMarginAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);

  const tradingClosed = market.paused || market.settled;
  const canSubmit = Boolean(account) && Boolean(marginAccountId) && !busy && !tradingClosed;

  async function placeOrder() {
    if (!account) return;
    setBusy(true);
    setError(null);
    setDigest(null);
    try {
      const prepared = await api.prepareOrder({
        trader: account.address,
        marginAccountId,
        isBid,
        price: Number(price),
        quantity: Number(quantity),
      });
      // The gateway's serialized transaction goes straight to the
      // wallet — dapp-kit accepts the serialized form directly, so the
      // browser never rebuilds or alters what the gateway approved.
      const result = await dAppKit.signAndExecuteTransaction({
        transaction: prepared.transactionJson,
      });
      // The result is a tagged union; a successful execution carries the
      // transaction (and its digest) under the Transaction arm.
      setDigest(result.$kind === 'Transaction' ? result.Transaction.digest : null);
      onFilled();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        // A risk-policy rejection is a normal, expected answer — the
        // gateway explains exactly which limit stopped it, so show that
        // rather than a generic failure.
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'The wallet did not complete the transaction.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>Place an order</h2>
        <span className="panel-note">Signed in your wallet</span>
      </div>

      {!account && <p className="empty">Connect a wallet to trade.</p>}

      {account && (
        <>
          <div className="field">
            <span id="side-label" className="visually-hidden-label" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>
              Side
            </span>
            <div className="side-toggle" role="group" aria-labelledby="side-label">
              <button type="button" aria-pressed={isBid} onClick={() => setIsBid(true)}>
                Buy
              </button>
              <button type="button" aria-pressed={!isBid} onClick={() => setIsBid(false)}>
                Sell
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="price">Index price</label>
            <input
              id="price"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              aria-describedby="price-help"
            />
            <span id="price-help" className="panel-note">
              Must be a multiple of {market.tickSize}.
            </span>
          </div>

          <div className="field">
            <label htmlFor="quantity">Contracts</label>
            <input
              id="quantity"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="margin">Margin account</label>
            <input
              id="margin"
              placeholder="0x…"
              value={marginAccountId}
              onChange={(e) => setMarginAccountId(e.target.value)}
              aria-describedby="margin-help"
            />
            <span id="margin-help" className="panel-note">
              Your MarginAccount object on Sui. Open one first if you have not.
            </span>
          </div>

          <button className="primary" onClick={placeOrder} disabled={!canSubmit}>
            {busy ? 'Waiting for your wallet…' : `${isBid ? 'Buy' : 'Sell'} ${quantity || '0'} contracts`}
          </button>

          {tradingClosed && (
            <p className="panel-note" style={{ marginTop: '0.6rem' }}>
              {market.settled ? 'This market has settled.' : 'Trading is paused.'}
            </p>
          )}

          {error && (
            <div className="notice bad" style={{ marginTop: '1rem' }}>
              {error}
            </div>
          )}

          {digest && (
            <div className="notice good" style={{ marginTop: '1rem' }}>
              Order placed. Transaction <span className="tabular">{digest.slice(0, 16)}…</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
