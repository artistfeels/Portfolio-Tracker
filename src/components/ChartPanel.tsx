import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
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

type Scope = '3mo' | '6mo' | '1yr' | '2yr';

const SCOPE_MONTHS: Record<Scope, number> = { '3mo': 3, '6mo': 6, '1yr': 12, '2yr': 24 };

const MA_CONFIGS = [
  { period: 5,   color: '#f0e68c', label: 'MA5' },
  { period: 20,  color: '#ffa500', label: 'MA20' },
  { period: 60,  color: '#9370db', label: 'MA60' },
  { period: 120, color: '#20b2aa', label: 'MA120' },
];

function calcMA(closes: { time: string; value: number }[], period: number) {
  const result: { time: string; value: number }[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j].value;
    result.push({ time: closes[i].time, value: sum / period });
  }
  return result;
}

async function fetchCandles(yahooSym: string): Promise<Candle[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2y`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    return (timestamps as number[])
      .map((ts, i) => ({
        time: new Date(ts * 1000).toISOString().slice(0, 10),
        open: (quote.open as number[])[i],
        high: (quote.high as number[])[i],
        low: (quote.low as number[])[i],
        close: (quote.close as number[])[i],
      }))
      .filter(c => c.open != null && c.close != null && isFinite(c.close) && c.close > 0)
      .sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return [];
  }
}

function scopeFromDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export default function ChartPanel({ ticker, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeScope, setActiveScope] = useState<Scope>('6mo');

  function applyScope(scope: Scope) {
    setActiveScope(scope);
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().setVisibleRange({
      from: scopeFromDate(SCOPE_MONTHS[scope]) as never,
      to: new Date().toISOString().slice(0, 10) as never,
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const sym = toChartSymbol(ticker);
    if (!sym) return;

    let cancelled = false;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 340,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d', timeVisible: true },
      rightPriceScale: { borderColor: '#30363d' },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#cf222e',
      downColor: '#1f6feb',
      borderUpColor: '#cf222e',
      borderDownColor: '#1f6feb',
      wickUpColor: '#cf222e',
      wickDownColor: '#1f6feb',
    });

    const maSeries = MA_CONFIGS.map(cfg =>
      chart.addSeries(LineSeries, {
        color: cfg.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
    );

    fetchCandles(sym).then((candles) => {
      if (cancelled) return;
      if (candles.length === 0) { setError(true); setLoading(false); return; }

      candleSeries.setData(candles);

      const closes = candles.map(c => ({ time: c.time, value: c.close }));
      MA_CONFIGS.forEach((cfg, idx) => {
        maSeries[idx].setData(calcMA(closes, cfg.period));
      });

      chart.timeScale().setVisibleRange({
        from: scopeFromDate(SCOPE_MONTHS['6mo']) as never,
        to: new Date().toISOString().slice(0, 10) as never,
      });

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
      chartRef.current = null;
      chart.remove();
      ro.disconnect();
    };
  }, [ticker]);

  const scopeLabels: Record<Scope, string> = { '3mo': '3개월', '6mo': '6개월', '1yr': '1년', '2yr': '2년' };

  return (
    <div style={{ padding: '12px 16px 16px', background: '#0d1117', borderTop: '1px solid #21262d' }}>
      {/* 헤더: 종목명 + 스코프 버튼 + MA 범례 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: '#8b949e', fontWeight: 500 }}>{name} 일봉</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* MA 범례 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {MA_CONFIGS.map(cfg => (
              <div key={cfg.period} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: cfg.color }}>
                <div style={{ width: 14, height: 2, background: cfg.color, borderRadius: 1 }} />
                {cfg.label}
              </div>
            ))}
          </div>
          {/* 스코프 버튼 */}
          <div style={{ display: 'flex', gap: 2 }}>
            {(Object.keys(scopeLabels) as Scope[]).map(s => (
              <button
                key={s}
                onClick={() => applyScope(s)}
                style={{
                  background: activeScope === s ? '#1f6feb' : '#21262d',
                  border: '1px solid #30363d',
                  color: activeScope === s ? '#fff' : '#8b949e',
                  padding: '3px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                {scopeLabels[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !error && (
        <div style={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>
          차트 로딩 중...
        </div>
      )}
      {error && (
        <div style={{ height: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>
          차트 데이터를 불러올 수 없습니다.
        </div>
      )}
      <div ref={containerRef} style={{ display: loading || error ? 'none' : 'block' }} />
    </div>
  );
}
