// src/components/ChartPanel.tsx
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { toChartSymbol } from '../lib/prices';

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  ticker: string;
  name: string;
}

async function fetchCandles(yahooSym: string): Promise<Candle[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1y`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens: number[] = quote.open ?? [];
    const highs: number[] = quote.high ?? [];
    const lows: number[] = quote.low ?? [];
    const closes: number[] = quote.close ?? [];
    return timestamps
      .map((ts, i) => ({
        time: new Date(ts * 1000).toISOString().slice(0, 10) as string,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
      }))
      .filter((c) => c.open != null && c.high != null && c.low != null && c.close != null && isFinite(c.close))
      .sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return [];
  }
}

export default function ChartPanel({ ticker, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const sym = toChartSymbol(ticker);
    if (!sym) return;

    let cancelled = false;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d', timeVisible: true },
      rightPriceScale: { borderColor: '#30363d' },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#cf222e',
      downColor: '#1f6feb',
      borderUpColor: '#cf222e',
      borderDownColor: '#1f6feb',
      wickUpColor: '#cf222e',
      wickDownColor: '#1f6feb',
    });

    fetchCandles(sym).then((candles) => {
      if (cancelled) return;
      if (candles.length === 0) { setError(true); setLoading(false); return; }
      series.setData(candles);
      chart.timeScale().fitContent();
      setLoading(false);
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        if (w > 0) chart.applyOptions({ width: w });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      cancelled = true;
      chart.remove();
      ro.disconnect();
    };
  }, [ticker]);

  return (
    <div style={{ padding: '12px 14px 16px', background: '#0d1117', borderTop: '1px solid #21262d' }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
        {name} — 1년 일봉
      </div>
      {loading && !error && <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>차트 로딩 중...</div>}
      {error && <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>차트 데이터를 불러올 수 없습니다.</div>}
      <div ref={containerRef} style={{ display: loading || error ? 'none' : 'block' }} />
    </div>
  );
}
