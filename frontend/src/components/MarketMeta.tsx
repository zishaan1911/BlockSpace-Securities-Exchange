import { useEffect, useState } from 'react';
import type { MarketMeta } from '../lib/types';

function remaining(expiry: number): string {
  const diff = Math.max(0, expiry - Date.now());
  const s = Math.floor(diff / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface MarketMetaProps {
  meta: MarketMeta;
}

export function MarketMetaCard({ meta }: MarketMetaProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  void now;

  return (
    <div className="card">
      <h2>{meta.market}</h2>
      <dl className="meta-grid">
        <dt>Expiry</dt>
        <dd className="mono">{remaining(meta.expiry)}</dd>
        <dt>Contract</dt>
        <dd className="mono">{meta.multiplier} USDC / pt</dd>
        <dt>Tick</dt>
        <dd className="mono">{meta.tickSize}</dd>
        <dt>Oracle age</dt>
        <dd className="mono">{meta.oracleAgeSec}s</dd>
      </dl>
      <div className="meta-foot">{meta.cycleLabel}</div>
    </div>
  );
}
