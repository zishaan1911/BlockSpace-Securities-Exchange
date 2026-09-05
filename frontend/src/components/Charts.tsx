import { useEffect, useRef } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../lib/api';

const CHART_BG = '#111922';
const GRID = '#1b2833';
const TEXT = '#748392';
const GREEN = '#5af37d';
const RED = '#ff5f68';

function resizeObserver(target: HTMLDivElement, resize: (width: number, height: number) => void) {
  const observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect;
    if (box) resize(Math.max(10, box.width), Math.max(10, box.height));
  });
  observer.observe(target);
  return observer;
}

export function TrendChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const chartApiRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Chart creation runs ONCE (empty deps), not on every `candles` change.
  // The previous version depended on [candles], and since App.tsx builds a
  // brand-new candles array on every 15s poll, the entire chart -- axes,
  // crosshair, the user's zoom/pan -- was destroyed and recreated from
  // scratch every 15 seconds. Data updates now go through a separate
  // effect that only calls setData() on the existing series.
  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: TEXT, fontFamily: 'Inter, sans-serif' },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#384858' }, horzLine: { color: '#384858' } },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: GREEN,
      topColor: 'rgba(90,243,125,.20)',
      bottomColor: 'rgba(90,243,125,0)',
      lineWidth: 2,
    });
    seriesRef.current = series;
    chartApiRef.current = chart;
    const observer = resizeObserver(container, (width, height) => chart.applyOptions({ width, height }));
    return () => { observer.disconnect(); chart.remove(); seriesRef.current = null; chartApiRef.current = null; };
  }, []);

  const hasFitRef = useRef(false);
  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    // Auto-fit only the FIRST time real data arrives, not on every 15s
    // poll -- otherwise a manual zoom/pan gets silently reset each
    // refresh, which is exactly the problem this whole refactor exists
    // to fix.
    if (!hasFitRef.current && candles.length > 0) {
      hasFitRef.current = true;
      chartApiRef.current?.timeScale().fitContent();
    }
  }, [candles]);

  return <div className="chart-surface" ref={ref} />;
}

export function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const volumeSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Same fix as TrendChart above: create once, update data separately, so
  // a 15s poll does not blow away the chart (and the user's zoom/pan)
  // every refresh. The volume series is created lazily on first data
  // update rather than at chart-creation time, since whether any candle
  // actually carries volume is only known once real data arrives.
  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: CHART_BG }, textColor: TEXT, fontFamily: 'Inter, sans-serif' },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#384858' }, horzLine: { color: '#384858' } },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: GREEN, downColor: RED, borderVisible: false, wickUpColor: GREEN, wickDownColor: RED,
    });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    const observer = resizeObserver(container, (width, height) => chart.applyOptions({ width, height }));
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  const hasFitRef = useRef(false);
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    candleSeries.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));

    if (candles.some((c) => Number.isFinite(c.volume))) {
      if (!volumeSeriesRef.current) {
        const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
        volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
        volumeSeriesRef.current = volume;
      }
      volumeSeriesRef.current.setData(candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(90,243,125,.35)' : 'rgba(255,95,104,.35)',
      })));
    }

    // Auto-fit only once, on the first real data arrival -- see
    // TrendChart's identical comment for why.
    if (!hasFitRef.current && candles.length > 0) {
      hasFitRef.current = true;
      chart.timeScale().fitContent();
    }
  }, [candles]);

  return <div className="chart-surface" ref={ref} />;
}
