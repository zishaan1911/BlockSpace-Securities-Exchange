/**
 * The signature element: EGSI drawn as a calibrated arc gauge.
 *
 * A 0-1000 stress index *is* a gauge reading, so this is the most
 * characteristic form the number can take — an instrument face rather
 * than a big-number-with-a-label stat block. The arc's color carries
 * the band state, which is the one place saturated color is allowed to
 * appear at this size.
 */
import { bandColorVar, bandLabel, gaugeFraction, stressBand, EGSI_MAX } from '../lib/egsi';

const SIZE = 240;
const STROKE = 14;
const RADIUS = (SIZE - STROKE) / 2;
/** 270° of arc, opening downward — the standard face of a pressure
 * gauge, and it leaves room under the needle for the readout. */
const SWEEP = 270;
const START_ANGLE = 135;
const ARC_LENGTH = (SWEEP / 360) * 2 * Math.PI * RADIUS;
const FULL_CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function polar(angleDeg: number, r: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: SIZE / 2 + r * Math.cos(rad), y: SIZE / 2 + r * Math.sin(rad) };
}

export function EgsiGauge({ score }: { score: number | null }) {
  const hasReading = score !== null;
  const fraction = hasReading ? gaugeFraction(score) : 0;
  const band = hasReading ? stressBand(score) : 'nominal';

  return (
    <div className="gauge-panel">
      <svg
        className="gauge"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={
          hasReading
            ? `Gas Stress Index ${score} out of ${EGSI_MAX}. ${bandLabel(band)}.`
            : 'Gas Stress Index: no reading yet.'
        }
      >
        <circle
          className="gauge-track"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH} ${FULL_CIRCUMFERENCE}`}
          transform={`rotate(${START_ANGLE} ${SIZE / 2} ${SIZE / 2})`}
        />
        {hasReading && (
          <circle
            className="gauge-value"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={bandColorVar(band)}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${ARC_LENGTH * fraction} ${FULL_CIRCUMFERENCE}`}
            transform={`rotate(${START_ANGLE} ${SIZE / 2} ${SIZE / 2})`}
          />
        )}

        {/* Scale marks at the band boundaries, so the reading can be
            judged against them without a legend. */}
        {[0, 250, 500, 750, 1000].map((tick) => {
          const angle = START_ANGLE + (tick / EGSI_MAX) * SWEEP;
          const p = polar(angle, RADIUS - STROKE - 8);
          return (
            <text
              key={tick}
              className="gauge-scale"
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {tick}
            </text>
          );
        })}

        <text
          className="gauge-readout tabular"
          x={SIZE / 2}
          y={SIZE / 2 + 6}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={hasReading ? 'var(--ink)' : 'var(--ink-faint)'}
        >
          {hasReading ? score : '—'}
        </text>
      </svg>

      <div className="state-line" style={{ color: hasReading ? bandColorVar(band) : 'var(--ink-faint)' }}>
        {hasReading ? bandLabel(band) : 'Waiting for a reading'}
      </div>
    </div>
  );
}
