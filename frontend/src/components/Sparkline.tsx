/**
 * EGSI history as a sparkline. Terminals show a series, not a dial —
 * where a number has been is usually more informative than the number.
 *
 * Deliberately unlabelled beyond its endpoints: at this size, axes cost
 * more room than they return, and the exact values live in the readout
 * beside it.
 */
interface Props {
  scores: number[];
  /** Drawn as a horizontal reference line when supplied. */
  band?: number;
}

export function Sparkline({ scores, band = 500 }: Props) {
  if (scores.length < 2) {
    return <p className="empty">Collecting history…</p>;
  }

  const W = 300;
  const H = 46;
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  // Guard a flat series, which would otherwise divide by zero and
  // collapse the line onto one edge.
  const span = hi - lo || 1;

  const x = (i: number) => (i / (scores.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * (H - 4) - 2;

  const path = scores.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H} L0,${H} Z`;
  const last = scores[scores.length - 1]!;
  const first = scores[0]!;
  const rising = last >= first;
  const stroke = rising ? 'var(--up)' : 'var(--down)';

  const bandInRange = band >= lo && band <= hi;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`EGSI over the last ${scores.length} readings, ${first} to ${last}`}
    >
      {bandInRange && (
        <line x1="0" y1={y(band)} x2={W} y2={y(band)} stroke="var(--rule-bright)" strokeDasharray="3 3" />
      )}
      <path d={area} fill={stroke} opacity="0.12" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
      <circle cx={x(scores.length - 1)} cy={y(last)} r="2" fill={stroke} />
    </svg>
  );
}
