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
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
    chart.timeScale().fitContent();
    const observer = resizeObserver(container, (width, height) => chart.applyOptions({ width, height }));
    return () => { observer.disconnect(); chart.remove(); };
  }, [candles]);
  return <div className="chart-surface" ref={ref} />;
}

export function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement>(null);
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
    candleSeries.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    if (candles.some((c) => Number.isFinite(c.volume))) {
      const volume = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
      volume.setData(candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume ?? 0,
        color: c.close >= c.open ? 'rgba(90,243,125,.35)' : 'rgba(255,95,104,.35)',
      })));
    }
    chart.timeScale().fitContent();
    const observer = resizeObserver(container, (width, height) => chart.applyOptions({ width, height }));
    return () => { observer.disconnect(); chart.remove(); };
  }, [candles]);
  return <div className="chart-surface" ref={ref} />;
}
