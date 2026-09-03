/**
 * EGSI candlestick chart with indicator overlays.
 *
 * Uses TradingView's lightweight-charts — the same engine behind most
 * exchange front-ends, which is why the interaction (crosshair, scroll,
 * zoom) feels right without reimplementing any of it.
 *
 * A note on what is being charted: these candles are aggregated from
 * EGSI readings, not from trades. Open/high/low/close are the first,
 * highest, lowest and last index values within each time bucket. There
 * is no traded volume, so the bar count is shown as "samples" rather
 * than dressed up as volume — a thin bucket means few readings landed
 * in it, which is worth seeing rather than hiding.
 */
import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import type { Candle } from '../lib/api';
import { bollinger, ema, type Series } from '../lib/indicators';

const UP = '#0ecb81';
const DOWN = '#f6465d';
const GRID = '#1f242d';
const TEXT = '#848e9c';

interface Props {
  candles: Candle[];
  showBollinger: boolean;
  showEmas: boolean;
  height?: number;
}

/** Maps an indicator series onto chart points, dropping the leading
 * nulls rather than plotting them as zeros. */
function toLineData(candles: Candle[], values: Series) {
  const points: { time: Time; value: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v !== null && v !== undefined) {
      points.push({ time: candles[i]!.time as Time, value: v });
    }
  }
  return points;
}

export function CandleChart({ candles, showBollinger, showEmas, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlaysRef = useRef<ISeriesApi<'Line'>[]>([]);

  // Create the chart once. Recreating it on every data update would
  // reset the user's pan and zoom on each 5s poll.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: { background: { color: 'transparent' }, textColor: TEXT, fontSize: 11 },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 0 },
    });

    candleSeriesRef.current = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    chartRef.current = chart;

    const resize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      overlaysRef.current = [];
    };
  }, [height]);

  // Update data and overlays whenever either changes.
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series || candles.length === 0) return;

    series.setData(
      candles.map((c) => ({
        time: c.time as Time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );

    // Overlays are rebuilt rather than mutated: which ones exist changes
    // with the toggles, and tracking that incrementally is more code
    // than it saves.
    for (const overlay of overlaysRef.current) chart.removeSeries(overlay);
    overlaysRef.current = [];

    const closes = candles.map((c) => c.close);

    if (showEmas) {
      for (const [period, color] of [
        [12, '#fcd535'],
        [26, '#7856ff'],
      ] as const) {
        const line = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(toLineData(candles, ema(closes, period)));
        overlaysRef.current.push(line);
      }
    }

    if (showBollinger) {
      const bands = bollinger(closes, 20, 2);
      for (const band of [bands.upper, bands.middle, bands.lower]) {
        const line = chart.addSeries(LineSeries, {
          color: '#4a5263',
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(toLineData(candles, band));
        overlaysRef.current.push(line);
      }
    }
  }, [candles, showBollinger, showEmas]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
