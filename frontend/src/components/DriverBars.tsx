/**
 * What's actually pushing the index — ARCHITECTURE.md §3's component
 * breakdown, which the AI service returns alongside every score
 * specifically so a reader can see *why* EGSI moved, not just that it
 * did. Bars are sorted by contribution so the dominant driver is at the
 * top rather than in a fixed schema order.
 */
import type { EgsiComponents } from '../lib/api';
import { formatComponent } from '../lib/egsi';

const LABELS: Record<keyof EgsiComponents, string> = {
  base_fee: 'Base fee',
  utilization: 'Block fullness',
  mempool_pressure: 'Mempool backlog',
  fee_momentum: 'Fee acceleration',
  gas_volatility: 'Fee volatility',
  dex_activity: 'DEX activity',
  thetanuts_iv: 'ETH option IV',
};

export function DriverBars({ components }: { components: EgsiComponents | null }) {
  if (!components) {
    return <p className="empty">No breakdown yet. It arrives with the first reading.</p>;
  }

  const entries = (Object.keys(LABELS) as (keyof EgsiComponents)[])
    .map((key) => ({ key, label: LABELS[key], value: components[key] }))
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

  return (
    <div className="bars">
      {entries.map(({ key, label, value }) => (
        <div className="bar-row" key={key}>
          <span className="bar-label">{label}</span>
          {value === null ? (
            <span className="bar-absent">no live signal</span>
          ) : (
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
            </span>
          )}
          <span className="bar-figure tabular">{value === null ? '—' : formatComponent(value)}</span>
        </div>
      ))}
    </div>
  );
}
