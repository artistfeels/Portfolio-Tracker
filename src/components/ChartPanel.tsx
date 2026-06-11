import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi } from 'lightweight-charts';
import { toChartSymbol } from '../lib/prices';

type CandleTime = string | number;

interface Candle {
  time: CandleTime;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  ticker: string;
  name: string;
}

type Interval = '1h' | '1d' | '1wk' | '1mo';

interface ScopeConfig {
  key: string;
  label: string;
  range: string;       // visible window (used to slice the displayed view)
  fetchRange: string;  // yahoo range param to fetch (>= range, for MA warmup + scroll)
}

// IMPORTANT: Yahoo silently downgrades granularity when range='max' is sent with a
// sub-quarterly interval (1d -> 1mo, 1h/1wk/1mo -> 3mo). That produced the "only a few
// candles" and "weekly-looking daily" bugs. We therefore NEVER send 'max' to Yahoo and
// instead use a large finite range that preserves the requested granularity. These cover
// the full history of any real instrument while keeping the correct interval.
const FETCH_MAX: Record<Interval, string> = {
  '1h': '2y',   // intraday is capped at ~730 days by Yahoo anyway
  '1d': '50y',
  '1wk': '50y',
  '1mo': '50y',
};

const SCOPES: Record<Interval, ScopeConfig[]> = {
  '1h': [
    { key: '1d',  label: '1일',   range: '1d',  fetchRange: '60d' },
    { key: '5d',  label: '5일',   range: '5d',  fetchRange: '60d' },
    { key: '14d', label: '2주',   range: '1mo', fetchRange: '60d' },
    { key: '30d', label: '1개월', range: '1mo', fetchRange: '60d' },
  ],
  '1d': [
    { key: '3mo', label: '3개월', range: '3mo', fetchRange: FETCH_MAX['1d'] },
    { key: '6mo', label: '6개월', range: '6mo', fetchRange: FETCH_MAX['1d'] },
    { key: '1yr', label: '1년',   range: '1y',  fetchRange: FETCH_MAX['1d'] },
    { key: '5yr', label: '5년',   range: '5y',  fetchRange: FETCH_MAX['1d'] },
    { key: 'max', label: '전체',  range: 'max', fetchRange: FETCH_MAX['1d'] },
  ],
  '1wk': [
    { key: '1yr',  label: '1년',  range: '1y',  fetchRange: FETCH_MAX['1wk'] },
    { key: '2yr',  label: '2년',  range: '2y',  fetchRange: FETCH_MAX['1wk'] },
    { key: '5yr',  label: '5년',  range: '5y',  fetchRange: FETCH_MAX['1wk'] },
    { key: '10yr', label: '10년', range: '10y', fetchRange: FETCH_MAX['1wk'] },
    { key: 'max',  label: '전체', range: 'max', fetchRange: FETCH_MAX['1wk'] },
  ],
  '1mo': [
    { key: '5yr',  label: '5년',  range: '5y',  fetchRange: FETCH_MAX['1mo'] },
    { key: '10yr', label: '10년', range: '10y', fetchRange: FETCH_MAX['1mo'] },
    { key: 'max',  label: '전체', range: 'max', fetchRange: FETCH_MAX['1mo'] },
  ],
};

const DEFAULT_SCOPE: Record<Interval, string> = {
  '1h': '5d', '1d': '6mo', '1wk': '2yr', '1mo': '10yr',
};

const INTERVAL_LABELS: Record<Interval, string> = {
  '1h': '1시간봉', '1d': '일봉', '1wk': '주봉', '1mo': '월봉',
};

const MA_CONFIGS = [
  { period: 5,   color: '#f0e68c', label: 'MA5' },
  { period: 20,  color: '#ffa500', label: 'MA20' },
  { period: 60,  color: '#9370db', label: 'MA60' },
  { period: 120, color: '#20b2aa', label: 'MA120' },
  { period: 200, color: '#e879f9', label: 'MA200' },
];

function calcMA(closes: { time: CandleTime; value: number }[], period: number) {
  const result: { time: CandleTime; value: number }[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += closes[i - j].value;
    result.push({ time: closes[i].time, value: sum / period });
  }
  return result;
}

function toSec(t: CandleTime): number {
  return typeof t === 'number'
    ? t
    : Math.floor(new Date(t + 'T00:00:00Z').getTime() / 1000);
}

// Number of approx. trading days a visible range covers (used to pick the bar count
// for the visible logical window). For 'max' returns Infinity.
function rangeDays(range: string): number {
  if (range === 'max') return Number.POSITIVE_INFINITY;
  const m = /^(\d+)(d|mo|y)$/.exec(range);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'd' ? n : m[2] === 'mo' ? n * 30 : n * 365;
}

// Seconds-since-epoch cutoff for a visible range, or null for 'max'.
function rangeCutoffSec(range: string): number | null {
  const days = rangeDays(range);
  if (!isFinite(days)) return null;
  return Math.floor(Date.now() / 1000) - days * 86400;
}

async function fetchCandles(yahooSym: string, iv: Interval, fetchRange: string): Promise<Candle[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${iv}&range=${fetchRange}`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const seen = new Set<CandleTime>();
    return timestamps
      .map((ts, i) => ({
        time: (iv === '1h' ? ts : new Date(ts * 1000).toISOString().slice(0, 10)) as CandleTime,
        open:  (quote.open  as number[])[i],
        high:  (quote.high  as number[])[i],
        low:   (quote.low   as number[])[i],
        close: (quote.close as number[])[i],
      }))
      .filter(c => {
        if (c.open == null || c.close == null || !isFinite(c.close as number) || (c.close as number) <= 0) return false;
        if (seen.has(c.time)) return false;
        seen.add(c.time);
        if (typeof c.time === 'string') {
          const day = new Date(c.time + 'T12:00:00Z').getUTCDay();
          if (day === 0 || day === 6) return false;
        }
        return true;
      })
      .sort((a, b) =>
        typeof a.time === 'number' && typeof b.time === 'number'
          ? a.time - b.time
          : (a.time as string).localeCompare(b.time as string)
      );
  } catch {
    return [];
  }
}


export default function ChartPanel({ ticker, name }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleSerRef   = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maSeriesRef    = useRef<any[]>([]);
  const allCandlesRef  = useRef<Candle[]>([]);
  const fetchedRangeRef = useRef<string>('');

  const [loading, setLoading]         = useState(true);
  const [error,   setError]           = useState(false);
  const [iv,      setIv]              = useState<Interval>('1d');
  const [activeScope, setActiveScope] = useState<string>(DEFAULT_SCOPE['1d']);

  // Loads ALL fetched history into the chart, then sets the visible window.
  // Scope buttons only zoom the visible range — full history stays loaded so the
  // user can scroll/pan to older data.
  function paint(scope: ScopeConfig) {
    const chart = chartRef.current;
    const cs    = candleSerRef.current;
    if (!chart || !cs) return;

    const all = allCandlesRef.current;
    if (all.length === 0) return;

    // Full dataset is always set on the series — never pre-sliced.
    cs.setData(all as never);

    // MAs computed over the full history (correct warmup for MA200 etc.).
    const allCloses = all.map(c => ({ time: c.time, value: c.close }));
    MA_CONFIGS.forEach((cfg, idx) => {
      maSeriesRef.current[idx]?.setData(calcMA(allCloses, cfg.period) as never);
    });

    const ts = chart.timeScale();

    // 'max' (전체): show everything.
    if (scope.range === 'max') {
      ts.fitContent();
      return;
    }

    // Compute the first index inside the requested window and reveal [firstIdx .. end].
    const cutoffSec = rangeCutoffSec(scope.range);
    if (cutoffSec == null) { ts.fitContent(); return; }

    let firstIdx = all.findIndex(c => toSec(c.time) >= cutoffSec);
    if (firstIdx < 0) firstIdx = 0; // window older than all data -> show all
    const from = firstIdx - 0.5;
    const to   = (all.length - 1) + 0.5;

    // Defer so setData's render/measure pass completes before adjusting the range.
    setTimeout(() => {
      chartRef.current?.timeScale().setVisibleLogicalRange({ from, to });
    }, 0);
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const sym = toChartSymbol(ticker);
    if (!sym) return;

    const defKey   = DEFAULT_SCOPE[iv];
    const defScope = SCOPES[iv].find(s => s.key === defKey) ?? SCOPES[iv][0];
    setActiveScope(defKey);
    setLoading(true);
    setError(false);

    let cancelled = false;

    // Explicit width so the chart measures synchronously on mount. Never use autoSize.
    const w = containerRef.current.clientWidth || 800;
    const chart = createChart(containerRef.current, {
      width:  w,
      height: 340,
      layout:          { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid:            { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale:       { borderColor: '#30363d', timeVisible: iv === '1h' },
      rightPriceScale: { borderColor: '#30363d' },
      crosshair:       { mode: 1 },
    });
    chartRef.current = chart;

    const cs = chart.addSeries(CandlestickSeries, {
      upColor: '#cf222e', downColor: '#1f6feb',
      borderUpColor: '#cf222e', borderDownColor: '#1f6feb',
      wickUpColor: '#cf222e', wickDownColor: '#1f6feb',
    });
    candleSerRef.current = cs;

    maSeriesRef.current = MA_CONFIGS.map(cfg =>
      chart.addSeries(LineSeries, {
        color: cfg.color, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
    );

    allCandlesRef.current   = [];
    fetchedRangeRef.current = '';

    fetchCandles(sym, iv, defScope.fetchRange).then(candles => {
      if (cancelled) return;
      if (candles.length === 0) { setError(true); setLoading(false); return; }
      allCandlesRef.current   = candles;
      fetchedRangeRef.current = defScope.fetchRange;
      paint(defScope);
      setLoading(false);
    });

    const ro = new ResizeObserver(() => {
      if (!containerRef.current || !chartRef.current) return;
      const nw = containerRef.current.clientWidth;
      if (nw > 0) chartRef.current.applyOptions({ width: nw });
    });
    ro.observe(containerRef.current);

    return () => {
      cancelled = true;
      ro.disconnect();
      chartRef.current     = null;
      candleSerRef.current = null;
      maSeriesRef.current  = [];
      chart.remove();
    };
  }, [ticker, iv]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleScope(scopeKey: string) {
    setActiveScope(scopeKey);
    const scope = SCOPES[iv].find(s => s.key === scopeKey) ?? SCOPES[iv][0];

    // All non-intraday scopes share the same FETCH_MAX range, so once loaded we just
    // re-zoom. Re-fetch only when we don't yet have at least the requested coverage.
    const enough =
      allCandlesRef.current.length > 0 &&
      rangeDays(fetchedRangeRef.current) >= rangeDays(scope.fetchRange);

    if (enough) { paint(scope); return; }

    const sym = toChartSymbol(ticker);
    if (!sym) return;
    const ivSnap = iv;
    fetchCandles(sym, ivSnap, scope.fetchRange).then(candles => {
      if (ivSnap !== iv || candles.length === 0) return;
      allCandlesRef.current   = candles;
      fetchedRangeRef.current = scope.fetchRange;
      paint(scope);
    });
  }

  const scopes = SCOPES[iv];

  return (
    <div style={{ padding: '12px 16px 16px', background: '#0d1117', borderTop: '1px solid #21262d' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#8b949e', fontWeight: 500 }}>
          {name} {INTERVAL_LABELS[iv]}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {/* MA 범례 */}
          <div style={{ display: 'flex', gap: 8 }}>
            {MA_CONFIGS.map(cfg => (
              <div key={cfg.period} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: cfg.color }}>
                <div style={{ width: 14, height: 2, background: cfg.color, borderRadius: 1 }} />
                {cfg.label}
              </div>
            ))}
          </div>
          {/* 봉 유형 버튼 */}
          <div style={{ display: 'flex', gap: 2 }}>
            {(['1h', '1d', '1wk', '1mo'] as Interval[]).map(t => (
              <button key={t} onClick={() => setIv(t)} style={{
                background: iv === t ? '#30363d' : 'transparent',
                border: '1px solid ' + (iv === t ? '#58a6ff' : '#30363d'),
                color: iv === t ? '#58a6ff' : '#8b949e',
                padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              }}>
                {INTERVAL_LABELS[t]}
              </button>
            ))}
          </div>
          {/* 스코프 버튼 */}
          <div style={{ display: 'flex', gap: 2 }}>
            {scopes.map(s => (
              <button key={s.key} onClick={() => handleScope(s.key)} style={{
                background: activeScope === s.key ? '#1f6feb' : '#21262d',
                border: '1px solid #30363d',
                color: activeScope === s.key ? '#fff' : '#8b949e',
                padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Container is always in the DOM so clientWidth is readable on mount */}
        <div ref={containerRef} />
        {(loading || error) && (
          <div style={{
            position: 'absolute', inset: 0, height: 340,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#0d1117', color: '#8b949e', fontSize: 12,
          }}>
            {error ? '차트 데이터를 불러올 수 없습니다.' : '차트 로딩 중...'}
          </div>
        )}
      </div>
    </div>
  );
}
