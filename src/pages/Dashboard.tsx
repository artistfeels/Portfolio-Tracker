import React, { useState, useMemo } from 'react';
import type { usePortfolio } from '../hooks/usePortfolio';
import ChartPanel from '../components/ChartPanel';
import SparkLine from '../components/SparkLine';
import MarketBar from '../components/MarketBar';
import StockLogo from '../components/StockLogo';
import { calcHoldingIrrs, calcPortfolioIrr } from '../lib/calc';
import { supabase } from '../lib/supabaseClient';

export const SECTOR_OPTIONS = [
  '기술', '반도체', '클라우드/SaaS', '인터넷/플랫폼', '게임/엔터',
  '헬스케어', '바이오/제약', '의료기기',
  '금융', '은행', '보험',
  '에너지', '원자재/상품', '금/귀금속',
  '소비재', '필수소비재', '의류/명품', '식음료',
  '산업재', '방위/항공우주', '물류/운송',
  '자동차/EV', '소재', '유틸리티', '통신', '부동산',
  '미디어/콘텐츠', 'ETF/인덱스', '암호화폐',
];

type PortfolioState = ReturnType<typeof usePortfolio>;

interface Props {
  portfolio: PortfolioState;
  theme?: 'light' | 'dark';
  isMobile?: boolean;
}

const PALETTE = ['#a78bfa','#60a5fa','#34d399','#f472b6','#fbbf24','#fb7185','#38bdf8','#4ade80','#c084fc','#f97316','#e879f9','#2dd4bf'];

// 해외 종목은 티커, 한국(6자리숫자) 종목은 이름
function displayLabel(ticker: string, name: string): string {
  return /^\d{6}$/.test(ticker) ? name : ticker;
}

// ── 공통 타입 ─────────────────────────────────────────
type TItem = { label: string; value: number; color: string };
type TRect = TItem & { x: number; y: number; w: number; h: number };

// ── 일간 등락률 → 히트맵 색상 (상승=빨강/하락=파랑, 한국 관습) ─
function heatColor(pct: number | null): string {
  if (pct === null) return 'rgba(120,120,120,0.45)';
  const c = Math.max(-6, Math.min(6, pct));
  if (c >= 0) return `rgba(207,34,46,${(0.25 + (c / 6) * 0.75).toFixed(2)})`;
  return `rgba(31,111,235,${(0.25 + (Math.abs(c) / 6) * 0.75).toFixed(2)})`;
}

// ── Binary-split treemap layout ──────────────────────
function buildTreemap(items: TItem[], x: number, y: number, w: number, h: number): TRect[] {
  if (items.length === 0) return [];
  if (items.length === 1) return [{ ...items[0], x, y, w, h }];
  const total = items.reduce((s, i) => s + i.value, 0);
  let acc = 0, split = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].value;
    split = i + 1;
    if (acc >= total / 2) break;
  }
  const first = items.slice(0, split), rest = items.slice(split);
  const ratio = first.reduce((s, i) => s + i.value, 0) / total;
  if (w >= h) {
    const w1 = w * ratio;
    return [...buildTreemap(first, x, y, w1, h), ...buildTreemap(rest, x + w1, y, w - w1, h)];
  } else {
    const h1 = h * ratio;
    return [...buildTreemap(first, x, y, w, h1), ...buildTreemap(rest, x, y + h1, w, h - h1)];
  }
}

// ── ① 개선된 도넛 — 범례 + 호버 상세 ───────────────────
function DonutWithLegend({ items, totalValue }: { items: TItem[]; totalValue: number }) {
  const [hov, setHov] = useState<number | null>(null);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return null;
  const cx = 72, cy = 72, R = 65, r = 38;
  let angle = -Math.PI / 2;
  const cp = (a: number, rr: number) => ({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
  const segments = items.map((item, idx) => {
    const pct = item.value / total;
    const sweep = pct * 2 * Math.PI;
    const sa = angle, ea = angle + sweep;
    angle = ea;
    const lg = sweep > Math.PI ? 1 : 0;
    const p1 = cp(sa, R), p2 = cp(ea, R), p3 = cp(ea, r), p4 = cp(sa, r);
    return { ...item, idx, pct, path: `M${p1.x} ${p1.y} A${R} ${R} 0 ${lg} 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${r} ${r} 0 ${lg} 0 ${p4.x} ${p4.y}Z` };
  });
  const active = hov !== null ? segments[hov] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
      <div style={{ flexShrink: 0 }}>
        <svg width="144" height="144" viewBox="0 0 144 144" style={{ display: 'block' }}>
          {segments.map(seg => (
            <path key={seg.idx} d={seg.path} fill={seg.color}
              opacity={hov !== null && hov !== seg.idx ? 0.28 : 1}
              style={{ cursor: 'pointer', transition: 'opacity 0.18s' }}
              onMouseEnter={() => setHov(seg.idx)} onMouseLeave={() => setHov(null)} />
          ))}
          <circle cx={cx} cy={cy} r={r - 1} fill="var(--bg-card)" />
          {active ? (
            <>
              <text x={cx} y={cy - 7} textAnchor="middle" dominantBaseline="middle" fill={active.color} fontSize={9} fontWeight={700}>
                {active.label.length > 7 ? active.label.slice(0, 6) + '…' : active.label}
              </text>
              <text x={cx} y={cy + 8} textAnchor="middle" dominantBaseline="middle" fill="var(--text-primary)" fontSize={15} fontWeight={800}>
                {(active.pct * 100).toFixed(1)}%
              </text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 7} textAnchor="middle" dominantBaseline="middle" fill="var(--text-secondary)" fontSize={8}>총 평가</text>
              <text x={cx} y={cy + 9} textAnchor="middle" dominantBaseline="middle" fill="var(--text-primary)" fontSize={10} fontWeight={700}>
                {(totalValue / 10000).toFixed(0)}만원
              </text>
            </>
          )}
        </svg>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        {segments.map(seg => (
          <div key={seg.idx}
            style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', opacity: hov !== null && hov !== seg.idx ? 0.28 : 1, transition: 'opacity 0.18s' }}
            onMouseEnter={() => setHov(seg.idx)} onMouseLeave={() => setHov(null)}>
            <div style={{ width: 9, height: 9, borderRadius: 3, background: seg.color, flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{seg.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{(seg.pct * 100).toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ② 히트맵 트리맵 — 등락률 색상 + 호버 툴팁 ──────────
type THeatItem = TItem & { dailyChangePct: number | null };

function HeatTreemap({ items }: { items: THeatItem[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; item: THeatItem; pct: number } | null>(null);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0);
  if (total === 0) return null;
  const W = 360, H = 210, G = 3;
  const rects = buildTreemap(sorted.map(i => ({ ...i, color: heatColor(i.dailyChangePct) })), 0, 0, W, H);
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}
        onMouseLeave={() => setTooltip(null)}>
        {rects.map((rect, i) => {
          const item = sorted[i] as THeatItem;
          const pct = rect.value / total;
          const rx = rect.x + G / 2, ry = rect.y + G / 2;
          const rw = rect.w - G, rh = rect.h - G;
          const showLabel = rw > 34 && rh > 20;
          const showDpct = rw > 50 && rh > 36;
          const fs = Math.min(12, Math.max(8, Math.min(rw * 0.17, rh * 0.28)));
          const dp = item.dailyChangePct;
          return (
            <g key={i} style={{ cursor: 'pointer' }}
              onMouseEnter={e => setTooltip({ x: e.clientX, y: e.clientY, item, pct })}
              onMouseMove={e => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}>
              <rect x={rx} y={ry} width={rw} height={rh} fill={rect.color} rx={8} />
              {showLabel && (
                <text x={rx + rw / 2} y={ry + rh / 2 + (showDpct ? -6 : 0)} textAnchor="middle" dominantBaseline="middle"
                  fill="rgba(255,255,255,0.95)" fontSize={fs} fontWeight={700} style={{ pointerEvents: 'none' }}>
                  {rect.label.length > 10 ? rect.label.slice(0, 9) + '…' : rect.label}
                </text>
              )}
              {showDpct && dp !== null && (
                <text x={rx + rw / 2} y={ry + rh / 2 + 9} textAnchor="middle" dominantBaseline="middle"
                  fill="rgba(255,255,255,0.88)" fontSize={9} style={{ pointerEvents: 'none' }}>
                  {dp >= 0 ? '+' : ''}{dp.toFixed(2)}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, justifyContent: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>-6%</span>
        <div style={{ width: 100, height: 5, borderRadius: 3, background: 'linear-gradient(to right, rgba(31,111,235,1), rgba(100,100,100,0.3), rgba(207,34,46,1))' }} />
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>+6%</span>
      </div>
      {tooltip && (
        <div style={{ position: 'fixed', left: tooltip.x + 12, top: tooltip.y - 50,
          background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8,
          padding: '8px 12px', fontSize: 12, lineHeight: 1.6,
          boxShadow: '0 4px 24px rgba(0,0,0,0.35)', zIndex: 9999, pointerEvents: 'none' }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{tooltip.item.label}</div>
          <div style={{ color: 'var(--text-secondary)' }}>{(tooltip.item.value / 10000).toFixed(0)}만원 · {(tooltip.pct * 100).toFixed(1)}%</div>
          {tooltip.item.dailyChangePct !== null && (
            <div style={{ fontWeight: 600, color: tooltip.item.dailyChangePct >= 0 ? 'var(--up)' : 'var(--down)' }}>
              일간 {tooltip.item.dailyChangePct >= 0 ? '+' : ''}{tooltip.item.dailyChangePct.toFixed(2)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ③ 버블 차트 — 누적수익률 × 일간등락 · 크기=비중 ──────
type TBubbleItem = { label: string; ticker: string; profitPct: number; dailyPct: number | null; value: number; color: string };

function BubbleChart({ items }: { items: TBubbleItem[] }) {
  const [hov, setHov] = useState<string | null>(null);
  const visible = items.filter(i => i.value > 0);
  if (visible.length < 2) return null;
  const W = 420, H = 210;
  const PAD = { l: 36, r: 12, t: 14, b: 30 };
  const cW = W - PAD.l - PAD.r, cH = H - PAD.t - PAD.b;
  const ps = visible.map(i => i.profitPct);
  const ds = visible.filter(i => i.dailyPct !== null).map(i => i.dailyPct as number);
  const rXMin = Math.min(...ps), rXMax = Math.max(...ps);
  const rYMin = ds.length ? Math.min(...ds) : -2;
  const rYMax = ds.length ? Math.max(...ds) : 2;
  const expand = (v: number, s: number) => Math.abs(v) * s + 3;
  const xMin = rXMin - expand(rXMin, 0.25), xMax = rXMax + expand(rXMax, 0.25);
  const yMin = rYMin - expand(rYMin, 0.35), yMax = rYMax + expand(rYMax, 0.35);
  const xS = (v: number) => PAD.l + ((v - xMin) / (xMax - xMin)) * cW;
  const yS = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * cH;
  const rS = (v: number) => 7 + Math.sqrt(v / Math.max(...visible.map(i => i.value))) * 24;
  const x0 = xS(0), y0 = yS(0);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}
      onMouseLeave={() => setHov(null)}>
      <rect x={PAD.l} y={PAD.t} width={Math.max(0, x0 - PAD.l)} height={Math.max(0, y0 - PAD.t)} fill="rgba(31,111,235,0.05)" />
      <rect x={x0} y={PAD.t} width={Math.max(0, W - PAD.r - x0)} height={Math.max(0, y0 - PAD.t)} fill="rgba(207,34,46,0.06)" />
      <rect x={PAD.l} y={y0} width={Math.max(0, x0 - PAD.l)} height={Math.max(0, H - PAD.b - y0)} fill="rgba(31,111,235,0.09)" />
      <rect x={x0} y={y0} width={Math.max(0, W - PAD.r - x0)} height={Math.max(0, H - PAD.b - y0)} fill="rgba(207,34,46,0.03)" />
      <line x1={x0} y1={PAD.t} x2={x0} y2={H - PAD.b} stroke="var(--border-primary)" strokeWidth={1} />
      <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0} stroke="var(--border-primary)" strokeWidth={1} />
      <text x={PAD.l + 4} y={PAD.t + 9} fill="rgba(31,111,235,0.45)" fontSize={7.5}>손실+하락</text>
      <text x={W - PAD.r - 4} y={PAD.t + 9} textAnchor="end" fill="rgba(207,34,46,0.5)" fontSize={7.5}>수익+상승</text>
      <text x={PAD.l + 4} y={H - PAD.b - 4} fill="rgba(31,111,235,0.4)" fontSize={7.5}>손실↔반등중</text>
      <text x={W - PAD.r - 4} y={H - PAD.b - 4} textAnchor="end" fill="rgba(120,120,120,0.5)" fontSize={7.5}>수익+오늘조정</text>
      {[rXMin, 0, rXMax].map(v => (
        <text key={v} x={xS(v)} y={H - PAD.b + 11} textAnchor="middle" fill="var(--text-secondary)" fontSize={8}>
          {v >= 0 ? '+' : ''}{v.toFixed(0)}%
        </text>
      ))}
      {[rYMin, 0, rYMax].filter((v, idx, a) => a.indexOf(v) === idx).map(v => (
        <text key={v} x={PAD.l - 3} y={yS(v)} textAnchor="end" dominantBaseline="middle" fill="var(--text-secondary)" fontSize={8}>
          {v >= 0 ? '+' : ''}{v.toFixed(1)}
        </text>
      ))}
      <text x={W / 2} y={H - 2} textAnchor="middle" fill="var(--text-muted)" fontSize={8}>← 누적 수익률 →</text>
      <text x={8} y={H / 2} textAnchor="middle" fill="var(--text-muted)" fontSize={8} transform={`rotate(-90,8,${H / 2})`}>일간↑</text>
      {[...visible].sort((a, b) => b.value - a.value).map(item => {
        const bx = xS(item.profitPct);
        const by = item.dailyPct !== null ? yS(item.dailyPct) : y0;
        const r = rS(item.value);
        const isHov = hov === item.ticker;
        return (
          <g key={item.ticker} style={{ cursor: 'pointer' }} onMouseEnter={() => setHov(item.ticker)}>
            <circle cx={bx} cy={by} r={r} fill={item.color}
              opacity={hov && !isHov ? 0.18 : 0.75}
              stroke={isHov ? 'white' : 'rgba(255,255,255,0.15)'}
              strokeWidth={isHov ? 2 : 1}
              style={{ transition: 'opacity 0.18s' }} />
            {(r > 16 || isHov) && (
              <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle"
                fill="white" fontSize={Math.min(10, r * 0.52)} fontWeight={700} style={{ pointerEvents: 'none' }}>
                {item.label.length > 5 ? item.label.slice(0, 4) + '…' : item.label}
              </text>
            )}
            {isHov && (
              <text x={bx} y={by + r + 11} textAnchor="middle" fill="var(--text-primary)" fontSize={9} fontWeight={600} style={{ pointerEvents: 'none' }}>
                {item.profitPct >= 0 ? '+' : ''}{item.profitPct.toFixed(1)}%{item.dailyPct !== null ? ` / 일간 ${item.dailyPct >= 0 ? '+' : ''}${item.dailyPct.toFixed(2)}%` : ''}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

const fmtKrw = (n: number) => n.toLocaleString('ko-KR') + '원';
const fmtSign = (n: number, digits = 2) => (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';
const fmtYears = (years: number) => years < 1 ? `${Math.round(years * 12)}개월` : `${years.toFixed(1)}년`;

function timeSince(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.floor(m / 60)}시간 전`;
}

function nativePrice(ticker: string, krwPrice: number, usdKrw: number): string {
  if (!krwPrice) return '...';
  if (ticker === 'CASH') return '-';
  if (/^\d{6}$/.test(ticker) || ticker === 'GOLD') return krwPrice.toLocaleString('ko-KR') + '원';
  if (/^\d{4}$/.test(ticker)) return 'HK$' + (krwPrice / usdKrw * 7.78).toFixed(2);
  return '$' + (krwPrice / usdKrw).toFixed(2);
}

function nativeChange(ticker: string, krwChange: number, usdKrw: number): string {
  const sign = krwChange >= 0 ? '+' : '';
  if (/^\d{6}$/.test(ticker) || ticker === 'GOLD') return sign + krwChange.toLocaleString('ko-KR') + '원';
  if (/^\d{4}$/.test(ticker)) {
    const v = (krwChange / usdKrw * 7.78);
    return (v >= 0 ? '+' : '') + 'HK$' + Math.abs(v).toFixed(2);
  }
  const v = krwChange / usdKrw;
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
}

export default function Dashboard({ portfolio, theme = 'dark', isMobile = false }: Props) {
  const { transactions, holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload, updateCash } = portfolio;
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tab, setTab] = useState<'시세' | '평가'>('시세');
  const [sortKey, setSortKey] = useState<string>('market_value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editingCash, setEditingCash] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<{ sym: string; label: string } | null>(null);
  const [showInfoViz, setShowInfoViz] = useState(false);
  const [editingSector, setEditingSector] = useState<string | null>(null);

  async function saveSector(ticker: string, newSector: string) {
    await supabase
      .from('transactions')
      .update({ sector: newSector || null })
      .eq('ticker', ticker);
    portfolio.patchSector(ticker, newSector || null);
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  // ── 일간 손익 ───────────────────────────────────────
  // 같은 환율 기준으로 전일 대비 KRW 변화 계산 (오늘 환율로 양쪽 모두 환산)
  const dailyPnl = holdings.reduce((sum, h) => {
    if (h.ticker === 'CASH' || h.prev_close_krw <= 0 || h.price_source === 'loading') return sum;
    return sum + (h.current_price_krw - h.prev_close_krw) * h.shares;
  }, 0);
  const prevDayTotal = holdings.reduce((sum, h) => {
    if (h.ticker === 'CASH' || h.prev_close_krw <= 0 || h.price_source === 'loading') return sum;
    return sum + h.prev_close_krw * h.shares;
  }, 0);
  const dailyPnlPct = prevDayTotal > 0 ? (dailyPnl / prevDayTotal) * 100 : null;
  const dailyColor = dailyPnl >= 0 ? 'var(--up)' : 'var(--down)';
  const hasDailyData = prevDayTotal > 0;

  // ── 오늘의 움직임 ───────────────────────────────────
  const withPnl = holdings
    .filter(h => h.ticker !== 'CASH' && h.daily_change_pct !== null && h.prev_close_krw > 0)
    .map(h => ({ ...h, dailyPnl: (h.current_price_krw - h.prev_close_krw) * h.shares }));
  const gainers = [...withPnl].filter(h => h.dailyPnl >= 0)
    .sort((a, b) => (b.daily_change_pct ?? 0) - (a.daily_change_pct ?? 0)).slice(0, 3);
  const losers = [...withPnl].filter(h => h.dailyPnl < 0)
    .sort((a, b) => (a.daily_change_pct ?? 0) - (b.daily_change_pct ?? 0)).slice(0, 3);
  const showMovers = withPnl.length >= 1;

  // ── 자산 구성 ───────────────────────────────────────
  const assetGroups = [
    {
      label: '한국 주식',
      value: holdings.filter(h => h.region === '한국' && h.ticker !== 'CASH').reduce((s, h) => s + h.market_value_krw, 0),
      color: 'var(--up)',
    },
    {
      label: '해외 주식',
      value: holdings.filter(h => h.region === '해외' && h.ticker !== 'GOLD').reduce((s, h) => s + h.market_value_krw, 0),
      color: 'var(--down)',
    },
    {
      label: '금',
      value: holdings.find(h => h.ticker === 'GOLD')?.market_value_krw ?? 0,
      color: '#ffa500',
    },
    {
      label: '현금',
      value: holdings.find(h => h.ticker === 'CASH')?.market_value_krw ?? 0,
      color: '#3fb950',
    },
  ].filter(g => g.value > 0);
  const assetTotal = assetGroups.reduce((s, g) => s + g.value, 0);

  // ── 종목별 IRR (평가 탭 테이블용) ───────────────
  const holdingIrrs = useMemo(() => {
    if (transactions.length === 0 || holdings.length === 0) return [];
    return calcHoldingIrrs(transactions, holdings);
  }, [transactions, holdings]);

  // ── 포트폴리오 분석 지표 ─────────────────────────
  const portfolioIrr = useMemo(() => {
    if (transactions.length === 0 || holdings.length === 0) return null;
    return calcPortfolioIrr(transactions, holdings);
  }, [transactions, holdings]);

  const firstDate = useMemo(() => {
    const buys = transactions.filter(t => t.action === 'buy');
    if (buys.length === 0) return null;
    return buys.reduce((min, t) => t.trade_date < min ? t.trade_date : min, buys[0].trade_date);
  }, [transactions]);

  const investmentYears = firstDate
    ? (Date.now() - new Date(firstDate).getTime()) / (365.25 * 24 * 3600 * 1000)
    : 0;

  const sortedHoldings = useMemo(() => {
    const rest = holdings.filter(h => h.ticker !== 'CASH');
    const sorted = [...rest].sort((a, b) => {
      let va = 0, vb = 0;
      if (sortKey === 'market_value') { va = a.market_value_krw; vb = b.market_value_krw; }
      else if (sortKey === 'daily_change') { va = a.daily_change_pct ?? -Infinity; vb = b.daily_change_pct ?? -Infinity; }
      else if (sortKey === 'profit_pct') { va = a.profit_pct; vb = b.profit_pct; }
      else if (sortKey === 'profit') { va = a.profit_krw; vb = b.profit_krw; }
      else if (sortKey === 'daily_pnl') {
        va = a.prev_close_krw > 0 ? (a.current_price_krw - a.prev_close_krw) * a.shares : -Infinity;
        vb = b.prev_close_krw > 0 ? (b.current_price_krw - b.prev_close_krw) * b.shares : -Infinity;
      }
      else if (sortKey === 'irr') {
        va = holdingIrrs.find(r => r.ticker === a.ticker)?.irr ?? -Infinity;
        vb = holdingIrrs.find(r => r.ticker === b.ticker)?.irr ?? -Infinity;
      }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return sorted;
  }, [holdings, sortKey, sortDir, holdingIrrs]);

  const SortTh = ({ label, k, left }: { label: string; k: string; left?: boolean }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ padding: '10px 14px', textAlign: left ? 'left' : 'right', fontWeight: 500, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
    >
      {label}{' '}
      <span style={{ fontSize: 9, color: sortKey === k ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {sortKey === k ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
      </span>
    </th>
  );

  if (status === 'error') {
    return (
      <div style={{ padding: 48, color: 'var(--up)' }}>
        <p style={{ marginBottom: 12 }}>오류: {error}</p>
        <button
          onClick={() => reload()}
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div style={{ padding: 48, color: 'var(--text-secondary)', fontSize: 14 }}>
        포트폴리오 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: isMobile ? '6px 8px' : '20px 8px', minWidth: 0 }}>

      {/* ── 헤더 ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'flex-start', gap: isMobile ? 6 : 0, marginBottom: isMobile ? 8 : 16 }}>
        <div>
          <div style={{ fontSize: isMobile ? 24 : 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>
            {fmtKrw(summary.totalValue)}
          </div>
          <div style={{ marginTop: 6, fontSize: isMobile ? 13 : 16, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: isMobile ? 4 : 8 }}>
            {hasDailyData ? (
              <>
                <span style={{ color: dailyColor, fontWeight: 600 }}>
                  {dailyPnl >= 0 ? '+' : ''}{fmtKrw(Math.round(dailyPnl))}
                </span>
                {dailyPnlPct !== null && (
                  <span style={{ color: dailyColor, fontSize: 14 }}>
                    ({fmtSign(dailyPnlPct)}) 일간
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>시세 로딩 중...</span>
            )}
          </div>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', flexDirection: isMobile ? 'row' : 'column', alignItems: isMobile ? 'center' : 'flex-end', gap: isMobile ? 6 : 4 }}>
          {isRefreshing && <span style={{ color: 'var(--down)', fontSize: 10 }}>● 업데이트 중</span>}
          {lastUpdated && !isRefreshing && <span style={{ fontSize: 10 }}>{timeSince(lastUpdated)} 업데이트</span>}
          {usdKrw > 0 && !isMobile && <div>USD/KRW {usdKrw.toLocaleString()}</div>}
          <button
            onClick={() => reload()}
            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', padding: isMobile ? '4px 8px' : '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: isMobile ? 11 : 12 }}
          >
            새로고침
          </button>
        </div>
      </div>

      {/* ── 요약 카드 6개 ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(6, 1fr)', gap: isMobile ? 5 : 8, marginBottom: isMobile ? 7 : 12 }}>
        {[
          { label: '투자원금', value: fmtKrw(summary.totalPrincipal), color: 'var(--text-primary)' },
          {
            label: '일간 손익',
            value: hasDailyData ? (dailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(dailyPnl)) : '-',
            sub: hasDailyData && dailyPnlPct !== null ? fmtSign(dailyPnlPct) : undefined,
            color: hasDailyData ? dailyColor : 'var(--text-secondary)',
          },
          {
            label: '누적 손익',
            value: (summary.totalProfit >= 0 ? '+' : '') + fmtKrw(summary.totalProfit),
            color: summary.totalProfit >= 0 ? 'var(--up)' : 'var(--down)',
          },
          {
            label: '수익률',
            value: fmtSign(summary.profitPct),
            color: summary.profitPct >= 0 ? 'var(--up)' : 'var(--down)',
          },
          {
            label: '포트폴리오 IRR',
            value: portfolioIrr !== null ? fmtSign(portfolioIrr * 100) : '-',
            sub: firstDate ? fmtYears(investmentYears) : undefined,
            color: portfolioIrr !== null ? (portfolioIrr >= 0 ? 'var(--up)' : 'var(--down)') : 'var(--text-secondary)',
          },
        ].map((c) => (
          <div key={c.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: isMobile ? '5px 8px' : '12px 16px' }}>
            <div style={{ fontSize: isMobile ? 10 : 12, color: 'var(--text-secondary)', marginBottom: isMobile ? 2 : 5 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 14 : 19, fontWeight: 700, color: c.color }}>{c.value}</div>
            {'sub' in c && c.sub && (
              <div style={{ fontSize: isMobile ? 11 : 13, color: c.color, marginTop: 2 }}>{c.sub}</div>
            )}
          </div>
        ))}
        {/* 현금 카드 (인라인 편집) */}
        {(() => {
          const cashVal = holdings.find(h => h.ticker === 'CASH')?.market_value_krw ?? 0;
          return (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: isMobile ? '8px 10px' : '12px 16px' }}>
              <div style={{ fontSize: isMobile ? 10 : 12, color: 'var(--text-secondary)', marginBottom: isMobile ? 3 : 5 }}>현금</div>
              {editingCash ? (
                <input
                  autoFocus
                  type="number"
                  value={cashInput}
                  onChange={e => setCashInput(e.target.value)}
                  onBlur={() => {
                    const v = Number(cashInput.replace(/,/g, ''));
                    if (!isNaN(v) && v >= 0) updateCash(v);
                    setEditingCash(false);
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setEditingCash(false);
                  }}
                  style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', padding: '4px 6px', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              ) : (
                <div
                  onClick={() => { setCashInput(cashVal.toString()); setEditingCash(true); }}
                  title="클릭해서 편집"
                  style={{ fontSize: isMobile ? 14 : 19, fontWeight: 700, color: '#3fb950', cursor: 'text', borderBottom: '1px dashed var(--border-primary)', display: 'inline-block' }}
                >
                  {fmtKrw(cashVal)}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── 시장 지수 ────────────────────────────────── */}
      <MarketBar
        selected={selectedMarket?.sym}
        onSelect={(sym, label) =>
          setSelectedMarket(prev => prev?.sym === sym ? null : { sym, label })
        }
      />
      {selectedMarket && (
        <div style={{ marginBottom: isMobile ? 8 : 16, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <ChartPanel ticker={selectedMarket.sym} name={selectedMarket.label} theme={theme} />
        </div>
      )}

      {/* ── 자산 구성 + 오늘의 움직임 ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: (!isMobile && showMovers) ? '1fr 1fr' : '1fr', gap: 10, marginBottom: isMobile ? 8 : 16 }}>

        {/* 자산 구성 */}
        {assetGroups.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: isMobile ? '10px 12px' : '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>자산 구성</div>
            {assetGroups.map(g => {
              const pct = assetTotal > 0 ? g.value / assetTotal * 100 : 0;
              return (
                <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, marginBottom: 7 }}>
                  <div style={{ width: isMobile ? 52 : 70, fontSize: isMobile ? 10 : 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>{g.label}</div>
                  <div style={{ flex: 1, height: 14, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden', minWidth: 20 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: g.color, borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ width: 36, fontSize: isMobile ? 10 : 11, color: g.color, textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(1)}%</div>
                  <div style={{ width: isMobile ? 76 : 100, fontSize: isMobile ? 10 : 11, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {(g.value / 1_0000).toFixed(0)}만원
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 오늘의 움직임 */}
        {showMovers && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: isMobile ? 6 : 10 }}>
            {([
              { title: '상승 상위', list: gainers, up: true },
              { title: '하락 상위', list: losers, up: false },
            ] as const).map(({ title, list, up }) => (
              <div key={title} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: isMobile ? 10 : 14, padding: isMobile ? '8px 10px' : '14px 18px' }}>
                <div style={{ fontSize: isMobile ? 11 : 13, fontWeight: 700, color: up ? 'var(--up)' : 'var(--down)', marginBottom: isMobile ? 5 : 12 }}>{title}</div>
                {list.length === 0
                  ? <div style={{ fontSize: isMobile ? 11 : 13, color: 'var(--text-muted)' }}>해당 없음</div>
                  : list.map(h => (
                    <div key={h.ticker} style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, marginBottom: isMobile ? 5 : 10, minWidth: 0 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: isMobile ? 11 : 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
                        {!isMobile && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.ticker}</div>}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: isMobile ? 12 : 15, fontWeight: 700, color: up ? 'var(--up)' : 'var(--down)' }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</div>
                        <div style={{ fontSize: isMobile ? 10 : 11, color: up ? 'var(--up)' : 'var(--down)', opacity: 0.8 }}>
                          {up ? '+' : ''}{Math.round(h.dailyPnl / 10000)}만원
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 인포그래픽 토글 ────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: isMobile ? 6 : 12, marginTop: isMobile ? 2 : 4 }}>
        <button
          onClick={() => setShowInfoViz(v => !v)}
          style={{
            background: showInfoViz ? 'var(--accent)' : 'var(--bg-card)',
            border: '1px solid var(--border-primary)', borderRadius: 980,
            padding: '8px 22px', fontSize: 13, fontWeight: 500,
            color: showInfoViz ? '#fff' : 'var(--text-secondary)',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
        >
          {showInfoViz ? '▲ 인포그래픽 접기' : '▼ 인포그래픽 보기'}
        </button>
      </div>

      {/* ── 인포그래픽 섹션 ──────────────────────────── */}
      {showInfoViz && (
        <div style={{ marginBottom: 16, animation: 'fadeSlideIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            {/* ① 도넛 + 범례 */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>평가금액 구성</div>
              <DonutWithLegend
                items={sortedHoldings.map((h, i) => ({
                  label: displayLabel(h.ticker, h.name),
                  value: h.market_value_krw,
                  color: PALETTE[i % PALETTE.length],
                }))}
                totalValue={summary.totalValue}
              />
            </div>
            {/* ② 히트맵 트리맵 */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>일간 히트맵</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>크기=비중 · 색상=일간등락 · 마우스 올리면 상세</div>
              <HeatTreemap
                items={sortedHoldings.map(h => ({
                  label: displayLabel(h.ticker, h.name),
                  value: h.market_value_krw,
                  color: heatColor(h.daily_change_pct),
                  dailyChangePct: h.daily_change_pct,
                }))}
              />
            </div>
          </div>
          {/* ③ 버블 차트 */}
          {sortedHoldings.length >= 2 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, padding: '16px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>수익률 산점도</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>버블 크기=보유비중 · X=누적수익률 · Y=일간등락 · 마우스 올리면 수치</div>
              <BubbleChart
                items={sortedHoldings.map((h, i) => ({
                  label: displayLabel(h.ticker, h.name),
                  ticker: h.ticker,
                  profitPct: h.profit_pct,
                  dailyPct: h.daily_change_pct,
                  value: h.market_value_krw,
                  color: PALETTE[i % PALETTE.length],
                }))}
              />
            </div>
          )}
        </div>
      )}

      {/* ── 시세 / 평가 탭 (데스크탑만 — 모바일은 카드에 통합) ─ */}
      <div style={{ display: isMobile ? 'none' : 'flex', borderBottom: '1px solid var(--border-primary)', marginBottom: 0 }}>
        {(['시세', '평가'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--down)' : '2px solid transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              padding: '10px 20px',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: tab === t ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── 모바일: 카드 레이아웃 (모든 정보 표시) ─────── */}
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {sortedHoldings.map((h, i) => {
            const isLoading = h.price_source === 'loading';
            const pct = h.daily_change_pct;
            const pctColor = pct === null || isLoading ? 'var(--text-secondary)' : pct >= 0 ? 'var(--up)' : 'var(--down)';
            const krwChange = h.prev_close_krw > 0 ? h.current_price_krw - h.prev_close_krw : null;
            const holdingDailyPnl = h.prev_close_krw > 0 ? (h.current_price_krw - h.prev_close_krw) * h.shares : null;
            const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
            const profitColor = h.profit_krw >= 0 ? 'var(--up)' : 'var(--down)';
            const holdingIrr = holdingIrrs.find(r => r.ticker === h.ticker)?.irr ?? null;
            const irrColor = holdingIrr === null ? 'var(--text-secondary)' : holdingIrr >= 0 ? 'var(--up)' : 'var(--down)';
            const isSelected = selectedTicker === h.ticker;
            const Cell = ({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) => (
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 1 }}>{label}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
              </div>
            );
            return (
              <div
                key={h.ticker}
                className="row-enter"
                style={{
                  background: isSelected ? 'var(--bg-tertiary)' : 'var(--bg-card)',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-primary)'}`,
                  borderRadius: 10, overflow: 'hidden', animationDelay: `${i * 0.04}s`,
                }}
              >
                <div
                  onClick={() => setSelectedTicker(isSelected ? null : h.ticker)}
                  style={{ padding: '8px 11px', cursor: 'pointer' }}
                >
                  {/* 헤더: 로고 + 이름 + 현재가/등락률 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <StockLogo ticker={h.ticker} name={h.name} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{h.ticker} · {weight.toFixed(1)}%</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: pctColor, fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading ? '-' : pct !== null ? fmtSign(pct) : '-'}
                      </div>
                      <div style={{ fontSize: 10, color: pctColor, display: 'flex', gap: 3, justifyContent: 'flex-end' }}>
                        <span>{isLoading ? '' : nativePrice(h.ticker, h.current_price_krw, usdKrw)}</span>
                        {!isLoading && krwChange !== null && <span>{nativeChange(h.ticker, krwChange, usdKrw)}</span>}
                      </div>
                    </div>
                  </div>
                  {/* 2×4 그리드 — 일간손익·수량·평균단가·평가금액 / 평가손익·수익률·IRR·섹터 */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px 4px' }}>
                    <Cell label="일간손익" value={isLoading || holdingDailyPnl === null ? '-' : (holdingDailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(holdingDailyPnl))} color={holdingDailyPnl === null ? 'var(--text-secondary)' : holdingDailyPnl >= 0 ? 'var(--up)' : 'var(--down)'} />
                    <Cell label="수량" value={h.ticker === 'CASH' ? '-' : h.shares.toLocaleString('ko-KR')} />
                    <Cell label="평균단가" value={h.ticker === 'CASH' ? '-' : nativePrice(h.ticker, h.avg_price_krw, usdKrw)} />
                    <Cell label="평가금액" value={fmtKrw(h.market_value_krw)} />
                    <Cell label="평가손익" value={(h.profit_krw >= 0 ? '+' : '') + fmtKrw(h.profit_krw)} color={profitColor} />
                    <Cell label="수익률" value={fmtSign(h.profit_pct)} color={profitColor} />
                    <Cell label="IRR" value={isLoading ? '-' : holdingIrr !== null ? fmtSign(holdingIrr * 100) : '-'} color={irrColor} />
                    <div style={{ minWidth: 0 }} onClick={e => e.stopPropagation()}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 1 }}>섹터</div>
                      {editingSector === h.ticker ? (
                        <select
                          autoFocus
                          defaultValue={h.sector ?? ''}
                          onChange={e => { saveSector(h.ticker, e.target.value); setEditingSector(null); }}
                          onBlur={() => setEditingSector(null)}
                          style={{ width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--text-primary)', fontSize: 10, padding: '2px 3px', outline: 'none' }}
                        >
                          <option value="">– 미분류 –</option>
                          {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <span
                          onClick={() => setEditingSector(h.ticker)}
                          style={{ fontSize: 10, fontWeight: 600, color: h.sector ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: 'pointer', borderBottom: '1px dashed var(--border-primary)' }}
                        >
                          {h.sector ?? '+ 섹터'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <div style={{ borderTop: '1px solid var(--bg-tertiary)' }}>
                    <ChartPanel ticker={h.ticker} name={h.name} theme={theme} avgPrice={h.avg_price_krw} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (

      /* ── 데스크탑: 테이블 ──────────────────────────── */
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderTop: 'none', borderRadius: '0 0 8px 8px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        {tab === '시세' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 12 }}>
                <th style={{ padding: isMobile ? '9px 10px' : '10px 14px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                {!isMobile && <th style={{ padding: '10px 14px', width: 120, fontWeight: 500 }}></th>}
                {!isMobile && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>수량</th>}
                {!isMobile && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평균단가</th>}
                <th style={{ padding: isMobile ? '9px 8px' : '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>현재가</th>
                {!isMobile && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>전일대비</th>}
                <SortTh label="등락률" k="daily_change" />
                <SortTh label="평가금액" k="market_value" />
                {!isMobile && <SortTh label="일간 손익" k="daily_pnl" />}
                {!isMobile && <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>비중</th>}
                {!isMobile && <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>섹터</th>}
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map((h, i) => {
                const isLoading = h.price_source === 'loading';
                const pct = h.daily_change_pct;
                const pctColor = pct === null || isLoading ? 'var(--text-secondary)' : pct >= 0 ? 'var(--up)' : 'var(--down)';
                const krwChange = h.prev_close_krw > 0 ? h.current_price_krw - h.prev_close_krw : null;
                const holdingDailyPnl = h.prev_close_krw > 0
                  ? (h.current_price_krw - h.prev_close_krw) * h.shares
                  : null;
                const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
                const isSelected = selectedTicker === h.ticker;

                return (
                  <React.Fragment key={h.ticker}>
                    <tr
                      onClick={() => setSelectedTicker(isSelected ? null : h.ticker)}
                      className="row-enter"
                      style={{
                        borderTop: '1px solid var(--bg-tertiary)',
                        background: isSelected ? 'var(--bg-tertiary)' : i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                        cursor: 'pointer',
                        animationDelay: `${i * 0.045}s`,
                      }}
                    >
                      <td style={{ padding: isMobile ? '8px 10px' : '9px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <StockLogo ticker={h.ticker} name={h.name} size={26} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: isMobile ? 13 : 14 }}>{h.name}</div>
                            <div style={{ fontSize: isMobile ? 10 : 11, color: 'var(--text-secondary)', marginTop: 1 }}>{h.ticker}</div>
                          </div>
                        </div>
                      </td>
                      {!isMobile && <td style={{ padding: '4px 8px', width: 120 }}>
                        {!isLoading && <SparkLine ticker={h.ticker} dailyChangePct={h.daily_change_pct} />}
                      </td>}
                      {!isMobile && <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {h.ticker === 'CASH' ? '-' : h.shares.toLocaleString('ko-KR')}
                      </td>}
                      {!isMobile && <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {h.ticker === 'CASH' ? '-' : nativePrice(h.ticker, h.avg_price_krw, usdKrw)}
                      </td>}
                      <td style={{ padding: isMobile ? '8px 8px' : '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: isMobile ? 13 : 14, transition: 'color 0.4s ease' }}>
                        {isLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 56, height: 13 }} /> : nativePrice(h.ticker, h.current_price_krw, usdKrw)}
                      </td>
                      {!isMobile && <td style={{ padding: '9px 14px', textAlign: 'right', color: pctColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {isLoading || krwChange === null ? '-' : nativeChange(h.ticker, krwChange, usdKrw)}
                      </td>}
                      <td style={{ padding: isMobile ? '8px 8px' : '9px 14px', textAlign: 'right', color: pctColor, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: isMobile ? 13 : 14, transition: 'color 0.4s ease' }}>
                        {isLoading ? '-' : pct !== null ? fmtSign(pct) : '-'}
                      </td>
                      <td style={{ padding: isMobile ? '8px 8px' : '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontSize: isMobile ? 13 : 14, transition: 'color 0.4s ease' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      {!isMobile && <td style={{ padding: '9px 14px', textAlign: 'right', color: holdingDailyPnl === null ? 'var(--text-secondary)' : holdingDailyPnl >= 0 ? 'var(--up)' : 'var(--down)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {isLoading || holdingDailyPnl === null ? '-'
                          : (holdingDailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(holdingDailyPnl))}
                      </td>}
                      {!isMobile && <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>}
                      {!isMobile && (
                        <td style={{ padding: '6px 14px', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                          {editingSector === h.ticker ? (
                            <select
                              autoFocus
                              defaultValue={h.sector ?? ''}
                              onChange={e => { saveSector(h.ticker, e.target.value); setEditingSector(null); }}
                              onBlur={() => setEditingSector(null)}
                              style={{
                                background: 'var(--bg-tertiary)', border: '1px solid var(--accent)',
                                borderRadius: 5, color: 'var(--text-primary)', fontSize: 11,
                                padding: '3px 6px', cursor: 'pointer', outline: 'none',
                              }}
                            >
                              <option value="">– 미분류 –</option>
                              {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          ) : (
                            <span
                              title="클릭해서 섹터 수정"
                              onClick={() => setEditingSector(h.ticker)}
                              style={{
                                fontSize: 11, padding: '2px 8px', borderRadius: 980,
                                background: h.sector ? 'var(--bg-tertiary)' : 'transparent',
                                border: `1px dashed ${h.sector ? 'var(--border-primary)' : 'var(--text-muted)'}`,
                                color: h.sector ? 'var(--text-secondary)' : 'var(--text-muted)',
                                cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-block',
                              }}
                            >
                              {h.sector ?? '+ 섹터'}
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                    {isSelected && (
                      <tr key={`${h.ticker}-chart`}>
                        <td colSpan={isMobile ? 4 : 11} style={{ padding: 0 }}>
                          <ChartPanel ticker={h.ticker} name={h.name} theme={theme} avgPrice={h.avg_price_krw} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 12 }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>수량</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평균단가</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>현재가</th>
                <SortTh label="평가금액" k="market_value" />
                <SortTh label="평가손익" k="profit" />
                <SortTh label="수익률" k="profit_pct" />
                <SortTh label="IRR" k="irr" />
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>비중</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, whiteSpace: 'nowrap' }}>섹터</th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map((h, i) => {
                const isLoading = h.price_source === 'loading';
                const profitColor = h.profit_krw >= 0 ? 'var(--up)' : 'var(--down)';
                const holdingIrr = holdingIrrs.find(r => r.ticker === h.ticker)?.irr ?? null;
                const irrColor = holdingIrr === null ? 'var(--text-secondary)' : holdingIrr >= 0 ? 'var(--up)' : 'var(--down)';
                const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
                const isSelected = selectedTicker === h.ticker;

                return (
                  <React.Fragment key={h.ticker}>
                    <tr
                      onClick={() => setSelectedTicker(isSelected ? null : h.ticker)}
                      className="row-enter"
                      style={{
                        borderTop: '1px solid var(--bg-tertiary)',
                        background: isSelected ? 'var(--bg-tertiary)' : i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                        cursor: 'pointer',
                        animationDelay: `${i * 0.045}s`,
                      }}
                    >
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <StockLogo ticker={h.ticker} name={h.name} size={26} />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{h.ticker}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {h.shares.toLocaleString()}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.avg_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {isLoading ? <span className="skeleton" style={{ display: 'inline-block', width: 72, height: 14 }} /> : fmtKrw(h.current_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {(h.profit_krw >= 0 ? '+' : '') + fmtKrw(h.profit_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {fmtSign(h.profit_pct)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: irrColor, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', transition: 'color 0.4s ease' }}>
                        {isLoading ? '-' : holdingIrr !== null ? fmtSign(holdingIrr * 100) : '-'}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>
                      <td style={{ padding: '6px 14px', textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                        {editingSector === h.ticker ? (
                          <select
                            autoFocus
                            defaultValue={h.sector ?? ''}
                            onChange={e => { saveSector(h.ticker, e.target.value); setEditingSector(null); }}
                            onBlur={() => setEditingSector(null)}
                            style={{
                              background: 'var(--bg-tertiary)', border: '1px solid var(--accent)',
                              borderRadius: 5, color: 'var(--text-primary)', fontSize: 11,
                              padding: '3px 6px', cursor: 'pointer', outline: 'none',
                            }}
                          >
                            <option value="">– 미분류 –</option>
                            {SECTOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          <span
                            title="클릭해서 섹터 수정"
                            onClick={() => setEditingSector(h.ticker)}
                            style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 980,
                              background: h.sector ? 'var(--bg-tertiary)' : 'transparent',
                              border: `1px dashed ${h.sector ? 'var(--border-primary)' : 'var(--text-muted)'}`,
                              color: h.sector ? 'var(--text-secondary)' : 'var(--text-muted)',
                              cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-block',
                            }}
                          >
                            {h.sector ?? '+ 섹터'}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isSelected && (
                      <tr key={`${h.ticker}-chart`}>
                        <td colSpan={10} style={{ padding: 0 }}>
                          <ChartPanel ticker={h.ticker} name={h.name} theme={theme} avgPrice={h.avg_price_krw} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

    </div>
  );
}
