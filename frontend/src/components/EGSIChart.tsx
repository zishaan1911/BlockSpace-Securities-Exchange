import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EgsiSnapshot, Forecast } from '../lib/types';

interface ChartPoint {
  label: string;
  egsi: number | null;
  forecast: number | null;
}

const fmt = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour12: false });

function toPoints(history: EgsiSnapshot[], forecast: Forecast): ChartPoint[] {
  const pts: ChartPoint[] = history.map((h) => ({
    label: fmt(h.t),
    egsi: h.value,
    forecast: null,
  }));
  if (history.length > 0) {
    const last = history[history.length - 1];
    const step = 15_000;
    pts.push(
      {
        label: fmt(last.t + step),
        egsi: null,
        forecast: (last.value + forecast.expectedEgsi) / 2,
      },
      {
        label: fmt(last.t + step * 2),
        egsi: null,
        forecast: forecast.expectedEgsi,
      },
    );
  }
  return pts;
}

interface EGSIChartProps {
  history: EgsiSnapshot[];
  forecast: Forecast;
}

export function EGSIChart({ history, forecast }: EGSIChartProps) {
  const data = toPoints(history, forecast);
  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="egsiFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#7c5cff" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-dim)' }} minTickGap={48} />
          <YAxis
            domain={[0, 1000]}
            ticks={[0, 250, 500, 750, 1000]}
            tick={{ fontSize: 10, fill: 'var(--text-dim)' }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <ReferenceLine y={500} stroke="var(--text-dim)" strokeDasharray="4 4" />
          <Area
            type="monotone"
            dataKey="egsi"
            name="EGSI"
            stroke="#7c5cff"
            strokeWidth={2}
            fill="url(#egsiFill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            name="Forecast"
            stroke="#ffb454"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
