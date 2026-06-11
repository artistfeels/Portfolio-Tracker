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
}

export default function SparkLine({ ticker }: Props) {
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    if (ticker === 'CASH') return;
    fetchIntraday(ticker).then(setData);
  }, [ticker]);

  if (data.length < 2) return <div style={{ width: 100 }} />;

  const W = 100, H = 36;
  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || min * 0.001 || 1;

  const toX = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const toY = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);

  const pts = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? 'var(--up)' : 'var(--down)';

  // Find index of min/max for markers
  let minIdx = 0, maxIdx = 0;
  data.forEach((v, i) => {
    if (v < data[minIdx]) minIdx = i;
    if (v > data[maxIdx]) maxIdx = i;
  });
  const minX = toX(minIdx), minY = toY(data[minIdx]);
  const maxX = toX(maxIdx), maxY = toY(data[maxIdx]);

  // Format price label (short)
  const fmtLabel = (v: number) => v >= 1000 ? v.toFixed(0) : v.toFixed(2);

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      {/* baseline at open price */}
      <line
        x1={pad} y1={toY(data[0]).toFixed(1)}
        x2={W - pad} y2={toY(data[0]).toFixed(1)}
        stroke="var(--border-primary)" strokeWidth="0.5" strokeDasharray="2,2"
      />
      {/* main line */}
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* fill under the line */}
      <polygon
        points={`${pad},${H - pad} ${pts} ${toX(data.length - 1).toFixed(1)},${H - pad}`}
        fill={color}
        opacity="0.08"
      />
      {/* min/max dots */}
      <circle cx={minX.toFixed(1)} cy={minY.toFixed(1)} r="2.5" fill={color} opacity="0.9" />
      <circle cx={maxX.toFixed(1)} cy={maxY.toFixed(1)} r="2.5" fill={color} opacity="0.9" />
      {/* min label */}
      <text
        x={minX.toFixed(1)} y={(minY + 9).toFixed(1)}
        fontSize="7" fill="var(--text-secondary)" textAnchor="middle"
      >
        {fmtLabel(data[minIdx])}
      </text>
      {/* max label */}
      <text
        x={maxX.toFixed(1)} y={(maxY - 4).toFixed(1)}
        fontSize="7" fill="var(--text-secondary)" textAnchor="middle"
      >
        {fmtLabel(data[maxIdx])}
      </text>
    </svg>
  );
}
