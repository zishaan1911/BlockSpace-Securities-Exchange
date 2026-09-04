import { bandLabel, gaugeFraction, stressBand } from '../lib/egsi';

export function EgsiGauge({ score }: { score: number }) {
  const fraction = gaugeFraction(score);
  const band = stressBand(score);

  const cx = 100;
  const cy = 100;
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75;
  const progressLength = arcLength * fraction;

  // SVG angles increase clockwise because Y increases downward.
  // 135° = bottom-left, 405° = bottom-right.
  const angle = 135 + fraction * 270;
  const radians = (angle * Math.PI) / 180;
  const markerX = cx + Math.cos(radians) * radius;
  const markerY = cy + Math.sin(radians) * radius;

  return (
    <div className={`egsi-gauge gauge-${band}`}>
      <svg
        viewBox="0 0 200 160"
        role="img"
        aria-label={`Ethereum Gas Stress Index ${Math.round(score)} out of 1000`}
      >
        <defs>
          <linearGradient id="gaugeTrack" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#63ea83" />
            <stop offset="48%" stopColor="#c6ed63" />
            <stop offset="70%" stopColor="#ffcf55" />
            <stop offset="100%" stopColor="#ff665f" />
          </linearGradient>
        </defs>

        {/* 270° background track */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="#1b2833"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />

        {/* Live progress. This length changes whenever the EGSI score changes. */}
        <circle
          className="gauge-progress"
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="url(#gaugeTrack)"
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray={`${Math.max(progressLength, 0.01)} ${circumference}`}
          transform={`rotate(135 ${cx} ${cy})`}
        />

        {/* Small marker follows the live value without crossing the center text. */}
        <circle
          className="gauge-marker"
          cx={markerX}
          cy={markerY}
          r="5.5"
        />
      </svg>

      <div className="gauge-center">
        <strong>{Math.round(score)}</strong>
        <span>
          <i />
          {bandLabel(band)}
        </span>
      </div>

      <div className="gauge-scale" aria-hidden="true">
        <span>0</span>
        <span>1,000</span>
      </div>
    </div>
  );
}
