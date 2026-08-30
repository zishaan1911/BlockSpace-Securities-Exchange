import type { Forecast } from '../lib/types';

interface ForecastCardProps {
  forecast: Forecast;
  current: number;
}

export function ForecastCard({ forecast, current }: ForecastCardProps) {
  const delta = forecast.expectedEgsi - current;
  const deltaCls = delta >= 0 ? 'pos' : 'neg';
  const confidencePct = Math.round(forecast.confidence * 100);

  return (
    <div className="card">
      <h2>AI Forecast — next hour</h2>
      <div className="forecast-main">
        <div className="forecast-value">
          {Math.round(forecast.expectedEgsi)}
          <span className="forecast-unit">EGSI</span>
        </div>
        <span className={`forecast-delta ${deltaCls}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
        </span>
      </div>
      <div className="forecast-row">
        <span>Confidence</span>
        <div className="bar">
          <div className="bar-fill" style={{ width: `${confidencePct}%` }} />
        </div>
        <span className="mono">{confidencePct}%</span>
      </div>
      <div className="forecast-row">
        <span>P(EGSI &gt; 500) at expiry</span>
        <span className="mono">{Math.round(forecast.pTail500 * 100)}%</span>
      </div>
      <div className="forecast-foot">
        model <span className="mono">{forecast.modelVersion}</span>
      </div>
    </div>
  );
}
