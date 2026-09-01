/**
 * EGSI as a numeric readout over a band scale.
 *
 * This replaces the arc gauge the earlier design used. A dial is
 * instrument-panel vernacular; a terminal shows the number large, the
 * level as a horizontal scale, and the recent series beside it. The
 * band boundaries (500 elevated, 750 critical) are drawn on the scale so
 * the reading can be judged against them without a legend.
 */
import { bandColorVar, bandLabel, gaugeFraction, stressBand, EGSI_MAX } from '../lib/egsi';
import { Sparkline } from './Sparkline';

interface Props {
  score: number | null;
  blockNumber: number | null;
  history: number[];
}

export function EgsiReadout({ score, blockNumber, history }: Props) {
  const has = score !== null;
  const band = has ? stressBand(score) : 'nominal';
  const colour = has ? bandColorVar(band) : 'var(--grey)';
  const previous = history.length > 1 ? history[history.length - 2]! : null;
  const change = has && previous !== null ? score - previous : null;

  return (
    <div className="panel">
      <header>
        <span>Gas Stress Index</span>
        <span>{blockNumber !== null ? `BLK ${blockNumber}` : '—'}</span>
      </header>
      <div className="body">
        <div className="readout">
          <span className="n" style={{ color: colour }}>
            {has ? score : '––'}
          </span>
          <span className="unit">/ {EGSI_MAX}</span>
          {change !== null && change !== 0 && (
            <span style={{ color: change > 0 ? 'var(--up)' : 'var(--down)', marginLeft: 'auto' }}>
              {change > 0 ? '▲' : '▼'} {Math.abs(change)}
            </span>
          )}
        </div>

        <div style={{ color: colour, letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: '10px' }}>
          {has ? bandLabel(band) : 'No reading'}
        </div>

        <div className="scale">
          <div className="scale-track">
            {has && (
              <>
                <span
                  className="scale-fill"
                  style={{ width: `${gaugeFraction(score) * 100}%`, background: colour }}
                />
                <span className="scale-marker" style={{ left: `${gaugeFraction(score) * 100}%` }} />
              </>
            )}
          </div>
          <div className="scale-legend">
            <span>0</span>
            <span>500 elevated</span>
            <span>750 critical</span>
            <span>{EGSI_MAX}</span>
          </div>
        </div>

        <div style={{ marginTop: '0.5rem' }}>
          <Sparkline scores={history} />
        </div>
      </div>
    </div>
  );
}
