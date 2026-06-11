import { useEffect, useState } from 'react';

interface MarketEntry {
  sym: string;
  label: string;
  fmt: (v: number) => string;
}

const MARKETS: MarketEntry[] = [
  { sym: 'KRW=X',  label: 'USD/KRW', fmt: v => v.toFixed(0) + '원' },
  { sym: '^GSPC',  label: 'S&P 500', fmt: v => v.toLocaleString('en', { maximumFractionDigits: 1 }) },
  { sym: '^IXIC',  label: 'NASDAQ',  fmt: v => v.toLocaleString('en', { maximumFractionDigits: 1 }) },
  { sym: '^DJI',   label: 'DOW',     fmt: v => v.toLocaleString('en', { maximumFractionDigits: 0 }) },
  { sym: '^KS11',  label: 'KOSPI',   fmt: v => v.toFixed(1) },
  { sym: '^KQ11',  label: 'KOSDAQ',  fmt: v => v.toFixed(2) },
  { sym: '^VIX',   label: 'VIX',     fmt: v => v.toFixed(2) },
];

interface MarketData {
  price: number;
  changePct: number | null;
  closes: number[];
}

const cache = new Map<string, { data: MarketData; at: number }>();
const TTL = 3 * 60 * 1000;

async function fetchMarket(sym: string): Promise<MarketData> {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`);
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return { price: 0, changePct: null, closes: [] };
    const price: number = result.meta?.regularMarketPrice ?? 0;
    const prevClose: number = result.meta?.previousClose ?? result.meta?.chartPreviousClose ?? 0;
    const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
    const raw: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const closes = raw.filter((v): v is number => v != null && isFinite(v) && v > 0);
    const data: MarketData = { price, changePct, closes };
    cache.set(sym, { data, at: Date.now() });
    return data;
  } catch {
    return { price: 0, changePct: null, closes: [] };
  }
}

function MiniSpark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 3) return <div style={{ width: 80, height: 28 }} />;
  const W = 80, H = 28, pad = 2;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || min * 0.001 || 1;
  const toX = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const toY = (v: number) => H - pad - ((v - min) / range) * (H - pad * 2);
  const pts = data.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
  const color = up ? '#cf222e' : '#1f6feb';
  const lastX = toX(data.length - 1).toFixed(1);
  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <line x1={pad} y1={toY(data[0]).toFixed(1)} x2={W - pad} y2={toY(data[0]).toFixed(1)}
        stroke="#30363d" strokeWidth="0.5" strokeDasharray="2,2" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
      <polygon points={`${pad},${H - pad} ${pts} ${lastX},${H - pad}`}
        fill={color} opacity="0.1" />
    </svg>
  );
}

interface Props {
  selected?: string;
  onSelect?: (sym: string, label: string) => void;
}

export default function MarketBar({ selected, onSelect }: Props) {
  const [data, setData] = useState<(MarketData | null)[]>(MARKETS.map(() => null));

  useEffect(() => {
    MARKETS.forEach(async ({ sym }, i) => {
      if (i > 0) await new Promise(r => setTimeout(r, i * 120));
      const d = await fetchMarket(sym);
      setData(prev => { const next = [...prev]; next[i] = d; return next; });
    });
  }, []);

  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, overflowX: 'auto', scrollbarWidth: 'none' }}>
      {MARKETS.map(({ sym, label, fmt }, i) => {
        const m = data[i];
        const pct = m?.changePct ?? null;
        const color = pct === null ? '#8b949e' : pct >= 0 ? '#cf222e' : '#1f6feb';
        const isUp = (pct ?? 0) >= 0;
        const isSelected = selected === sym;
        return (
          <div
            key={sym}
            onClick={() => onSelect?.(sym, label)}
            style={{
              background: isSelected ? '#1c2128' : '#161b22',
              border: '1px solid ' + (isSelected ? '#58a6ff' : '#30363d'),
              borderRadius: 8, padding: '10px 14px', minWidth: 148, flexShrink: 0,
              cursor: onSelect ? 'pointer' : 'default',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {m ? fmt(m.price) : <span style={{ color: '#8b949e' }}>...</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 12, color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {pct === null ? '-' : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'}
              </span>
              {m && m.closes.length > 3 && <MiniSpark data={m.closes} up={isUp} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
