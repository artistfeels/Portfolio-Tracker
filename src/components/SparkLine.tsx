import { useEffect, useState } from 'react';
import { toChartSymbol } from '../lib/prices';

const cache = new Map<string, { closes: number[]; at: number }>();
const TTL = 3 * 60 * 1000; // 3 min (intraday)

async function fetchIntraday(ticker: string): Promise<number[]> {
  const sym = toChartSymbol(ticker);
  if (!sym) return [];
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL) return hit.closes;
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`
    );
    const j = await res.json();
    const closes = (
      j?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    ) as (number | null)[];
    const valid = closes.filter((v): v is number => v != null && isFinite(v) && v > 0);
    cache.set(sym, { closes: valid, at: Date.now() });
    return valid;
  } catch {
    return [];
  }
}

interface Props {
  ticker: string;
  /** 전일 대비 등락률(%). 있으면 이 값으로 색상과 기준선을 결정한다. */
  dailyChangePct?: number | null;
}

export default function SparkLine({ ticker, dailyChangePct }: Props) {
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    if (ticker === 'CASH') return;
    fetchIntraday(ticker).then(setData);
  }, [ticker]);

  if (data.length < 2) return <div style={{ width: 100 }} />;

  const W = 100, H = 36;
  const pad = 3;

  // ── 색상: 전일종가 대비 등락을 우선 사용, 없으면 당일 시가 대비 폴백 ──
  const isUp = dailyChangePct !== null && dailyChangePct !== undefined
    ? dailyChangePct >= 0
    : data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--up)' : 'var(--down)';

  // ── 전일종가 계산 (네이티브 통화): 현재가 / (1 + 등락률/100) ──
  const lastPrice = data[data.length - 1];
  const prevClose = dailyChangePct !== null && dailyChangePct !== undefined && lastPrice > 0
    ? lastPrice / (1 + dailyChangePct / 100)
    : null;

  // y-range에 전일종가를 포함시켜 기준선이 차트 안에 그려지도록 한다
  const allValues = prevClose != null ? [...data, prevClose] : data;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || min * 0.001 || 1;

  const toX = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const toY = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);

  const pts = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  // min/max 도트 (데이터 범위 기준)
  let minIdx = 0, maxIdx = 0;
  data.forEach((v, i) => {
    if (v < data[minIdx]) minIdx = i;
    if (v > data[maxIdx]) maxIdx = i;
  });
  const minX = toX(minIdx), minY = toY(data[minIdx]);
  const maxX = toX(maxIdx), maxY = toY(data[maxIdx]);

  const fmtLabel = (v: number) => v >= 1000 ? v.toFixed(0) : v.toFixed(2);
  const prevCloseY = prevClose != null ? toY(prevClose) : null;

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* 전일종가 기준선 */}
      {prevCloseY != null && (
        <line
          x1={pad} y1={prevCloseY.toFixed(1)}
          x2={W - pad} y2={prevCloseY.toFixed(1)}
          stroke="var(--text-muted)"
          strokeWidth="0.8"
          strokeDasharray="3,2"
          opacity="0.8"
        />
      )}
      {/* 메인 라인 */}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* 라인 아래 채우기 */}
      <polygon
        points={`${pad},${H - pad} ${pts} ${toX(data.length - 1).toFixed(1)},${H - pad}`}
        fill={color}
        opacity="0.08"
      />
      {/* min/max 도트 */}
      <circle cx={minX.toFixed(1)} cy={minY.toFixed(1)} r="2.5" fill={color} opacity="0.9" />
      <circle cx={maxX.toFixed(1)} cy={maxY.toFixed(1)} r="2.5" fill={color} opacity="0.9" />
      {/* min 라벨 */}
      <text
        x={minX.toFixed(1)} y={(minY + 9).toFixed(1)}
        fontSize="7" fill="var(--text-secondary)" textAnchor="middle"
      >
        {fmtLabel(data[minIdx])}
      </text>
      {/* max 라벨 */}
      <text
        x={maxX.toFixed(1)} y={(maxY - 4).toFixed(1)}
        fontSize="7" fill="var(--text-secondary)" textAnchor="middle"
      >
        {fmtLabel(data[maxIdx])}
      </text>
    </svg>
  );
}
