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
    <div className="card">
      <h2>
        Order
        <span className="tag">{isBid ? 'Buy' : 'Sell'}</span>
      </h2>
      <div className="inner">
        {!account && <p className="empty">Connect a wallet to trade.</p>}

        {account && (
          <div className="form">
            <div className="tabs" role="group" aria-label="Side">
              <button type="button" data-side="buy" aria-pressed={isBid} onClick={() => setIsBid(true)}>
                Buy
              </button>
              <button type="button" data-side="sell" aria-pressed={!isBid} onClick={() => setIsBid(false)}>
                Sell
              </button>
            </div>

            <label htmlFor="price">Price · tick {market.tickSize}</label>
            <input id="price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />

            <label htmlFor="quantity">Contracts</label>
            <input
              id="quantity"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />

            <label htmlFor="margin">Margin account</label>
            <input
              id="margin"
              placeholder="0x…"
              value={marginAccountId}
              onChange={(e) => setMarginAccountId(e.target.value)}
            />

            <button className="primary" onClick={placeOrder} disabled={!canSubmit}>
              {busy ? 'Awaiting wallet…' : `${isBid ? 'Buy' : 'Sell'} ${quantity || '0'}`}
            </button>

            {tradingClosed && (
              <p className="note">{market.settled ? 'Market settled.' : 'Trading paused.'}</p>
            )}

            {error && <div className="msg err">{error}</div>}
            {digest && (
              <div className="msg ok">
                Filled · {digest.slice(0, 18)}…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
