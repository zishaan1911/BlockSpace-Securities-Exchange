const MIN = 0;
const MAX = 1000;

const ZONES = [
  { from: 0, to: 300, color: 'var(--gauge-calm)' },
  { from: 300, to: 600, color: 'var(--gauge-mod)' },
  { from: 600, to: 800, color: 'var(--gauge-stress)' },
  { from: 800, to: 1000, color: 'var(--gauge-extreme)' },
];

function arcPath(cx: number, cy: number, r: number): string {
  const startX = cx - r;
  const endX = cx + r;
  return `M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`;
}

interface EGSIGaugeProps {
  value: number;
}

export function EGSIGauge({ value }: EGSIGaugeProps) {
  const cx = 120;
  const cy = 100;
  const r = 78;
  const clamped = Math.min(MAX, Math.max(MIN, value));

  // Needle: 0 → pointing left (180°), 1000 → pointing right (0°).
  const angleDeg = 180 - (clamped / MAX) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  const needleLen = r - 12;
  const nx = cx + needleLen * Math.cos(angleRad);
  const ny = cy - needleLen * Math.sin(angleRad);

  const tick = (v: number) => {
    const a = ((180 - (v / MAX) * 180) * Math.PI) / 180;
    return {
      x: cx + (r + 14) * Math.cos(a),
      y: cy - (r + 14) * Math.sin(a) + 4,
    };
  };

  return (
    <svg viewBox="0 0 240 150" className="gauge-svg" role="img" aria-label={`EGSI ${value}`}>
      <path d={arcPath(cx, cy, r)} className="gauge-track" pathLength={1000} />
      {ZONES.map((z) => {
        const from = z.from / MAX;
        const len = (z.to - z.from) / MAX;
        return (
          <path
            key={z.to}
            d={arcPath(cx, cy, r)}
            pathLength={1000}
            className="gauge-zone"
            stroke={z.color}
            strokeDasharray={`${len * 1000} ${1000}`}
            strokeDashoffset={-from * 1000}
          />
        );
      })}
      <path
        d={arcPath(cx, cy, r)}
        pathLength={1000}
        className="gauge-value"
        strokeDasharray={`${clamped} ${MAX - clamped}`}
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} className="gauge-needle" />
      <circle cx={cx} cy={cy} r={5} className="gauge-hub" />
      {[0, 250, 500, 750, 1000].map((v) => {
        const p = tick(v);
        return (
          <text key={v} x={p.x} y={p.y} className="gauge-tick" textAnchor="middle">
            {v}
          </text>
        );
      })}
      <text x={cx} y={cy + 22} className="gauge-reading" textAnchor="middle">
        {Math.round(value)}
      </text>
      <text x={cx} y={cy + 38} className="gauge-caption" textAnchor="middle">
        EGSI
      </text>
    </svg>
  );
}
