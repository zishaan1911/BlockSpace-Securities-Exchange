import { useEffect, useRef } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/api';
import { useTheme } from '../theme';

const GREEN = '#5af37d';
const RED = '#ff5f68';

// Chart colors are keyed on the React theme (not read via getComputedStyle):
// reading CSS variables imperatively lags behind the `data-theme` attribute
// that the ThemeProvider applies in its own effect, so the chart would render
// with the previous theme's colors (e.g. white on a dark page).
const THEME_COLORS = {
  dark: { bg: '#111922', grid: '#1b2833', text: '#748392', crosshair: '#384858' },
  light: { bg: '#ffffff', grid: '#e5e9ee', text: '#55616c', crosshair: '#cdd5dc' },
} as const;

export type ChartMode = 'line' | 'candle';

function resizeObserver(target: HTMLDivElement, resize: (width: number, height: number) => void) {
  const observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box) resize(Math.max(10, box.width), Math.max(10, box.height));
  });
  observer.observe(target);
  return observer;
}

/**
 * The single EGSI price chart. `mode` switches between an area/line view
 * and a candlestick (with volume) view of the same candles.
 *
 * The chart is created once (recreated only when the theme changes) and the
 * series is swapped in place when the mode changes — recreating the whole
 * chart on every toggle left the container in a broken state. Data updates
 * go through a separate effect that only calls setData() on the live series.
 */
export function PriceChart({ candles, mode }: { candles: Candle[]; mode: ChartMode }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineRef = useRef<ISeriesApi<'Area'> | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const fitRef = useRef(false);
  const { theme } = useTheme();

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const colors = THEME_COLORS[theme];
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text, fontFamily: 'Inter, sans-serif' },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: colors.crosshair }, horzLine: { color: colors.crosshair } },
    });
    chartRef.current = chart;
    const observer = resizeObserver(container, (width, height) => chart.applyOptions({ width, height }));
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      lineRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (lineRef.current) {
      chart.removeSeries(lineRef.current);
      lineRef.current = null;
    }
    if (candleRef.current) {
      chart.removeSeries(candleRef.current);
      candleRef.current = null;
    }
    if (volumeRef.current) {
      chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }
    fitRef.current = false;

    if (mode === 'line') {
      lineRef.current = chart.addSeries(AreaSeries, {
        lineColor: GREEN,
        topColor: 'rgba(90,243,125,.20)',
        bottomColor: 'rgba(90,243,125,0)',
        lineWidth: 2,
      });
    } else {
      candleRef.current = chart.addSeries(CandlestickSeries, {
        upColor: GREEN, downColor: RED, borderVisible: false, wickUpColor: GREEN, wickDownColor: RED,
      });
    }
  }, [mode, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (mode === 'line') {
      lineRef.current?.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    } else {
      candleRef.current?.setData(candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })));

      if (candles.some((c) => Number.isFinite(c.volume))) {
        if (!volumeRef.current) {
          const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
          volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
          volumeRef.current = volume;
        }
        volumeRef.current.setData(candles.map((c) => ({
          time: c.time as UTCTimestamp,
          value: c.volume ?? 0,
          color: c.close >= c.open ? 'rgba(90,243,125,.35)' : 'rgba(255,95,104,.35)',
        })));
      }
    }

    // Auto-fit only once per chart lifetime, not on every poll — a manual
    // zoom/pan should survive refreshes.
    if (!fitRef.current && candles.length > 0) {
      fitRef.current = true;
      chart.timeScale().fitContent();
    }
  }, [candles, mode, theme]);

  return <div className="chart-surface" ref={ref} />;
}

