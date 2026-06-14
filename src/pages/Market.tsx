import { useState, useEffect, useMemo } from 'react';
import type { HoldingWithPrice } from '../lib/types';

interface Props {
  holdings: HoldingWithPrice[];
  usdKrw: number;
  isMobile?: boolean;
  theme?: 'light' | 'dark';
}

interface Quote {
  symbol: string;
  label: string;
  emoji: string;
  tvSymbol: string;
  price: number | null;
  changePct: number | null;
  changeAbs: number | null;
  loading: boolean;
}

interface FxRate {
  symbol: string;
  code: string;
  label: string;
  flag: string;
  display: string;
  tvSymbol: string;
  price: number | null;
  changePct: number | null;
  loading: boolean;
  formatter: (p: number) => string;
}

const INDICES: { symbol: string; label: string; emoji: string; tvSymbol: string }[] = [
  { symbol: '^KS11',  label: 'KOSPI',      emoji: '🇰🇷', tvSymbol: 'KRX:KOSPI'     },
  { symbol: '^KQ11',  label: 'KOSDAQ',     emoji: '🇰🇷', tvSymbol: 'KRX:KOSDAQ'    },
  { symbol: '^GSPC',  label: 'S&P 500',    emoji: '🇺🇸', tvSymbol: 'SP:SPX'        },
  { symbol: '^IXIC',  label: 'Nasdaq',     emoji: '🇺🇸', tvSymbol: 'NASDAQ:IXIC'   },
  { symbol: '^DJI',   label: 'Dow Jones',  emoji: '🇺🇸', tvSymbol: 'DJ:DJI'        },
  { symbol: '^N225',  label: 'Nikkei 225', emoji: '🇯🇵', tvSymbol: 'TVC:NI225'     },
];

const FX_CONFIGS: { symbol: string; code: string; label: string; flag: string; tvSymbol: string; formatter: (p: number) => string }[] = [
  { symbol: 'EURUSD=X',   code: 'EUR', label: '유로',       flag: '🇪🇺', tvSymbol: 'FX:EURUSD',     formatter: p => `$${p.toFixed(4)}` },
  { symbol: 'USDJPY=X',   code: 'JPY', label: '엔화',       flag: '🇯🇵', tvSymbol: 'FX:USDJPY',     formatter: p => `¥${p.toFixed(2)}` },
  { symbol: 'DX-Y.NYB',   code: 'DXY', label: '달러인덱스', flag: '💵',  tvSymbol: 'TVC:DXY',       formatter: p => p.toFixed(2) },
];

function vixLevel(vix: number | null): { label: string; color: string; pct: number } {
  if (vix == null) return { label: '–', color: '#6e7681', pct: 0 };
  if (vix < 13)  return { label: '극도의 안정',  color: '#22c55e', pct: Math.round(vix / 50 * 100) };
  if (vix < 18)  return { label: '안정',         color: '#84cc16', pct: Math.round(vix / 50 * 100) };
  if (vix < 25)  return { label: '보통',          color: '#eab308', pct: Math.round(vix / 50 * 100) };
  if (vix < 35)  return { label: '공포',          color: '#f97316', pct: Math.round(vix / 50 * 100) };
  return          { label: '극도의 공포',         color: '#ef4444', pct: Math.min(98, Math.round(vix / 50 * 100)) };
}

async function fetchQuote(symbol: string): Promise<{ price: number | null; changePct: number | null; changeAbs: number | null }> {
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePct: null, changeAbs: null };
    const price = meta.regularMarketPrice as number;
    const prev  = (meta.chartPreviousClose ?? meta.previousClose) as number;
    if (!price || !prev) return { price: price ?? null, changePct: null, changeAbs: null };
    return { price, changePct: ((price - prev) / prev) * 100, changeAbs: price - prev };
  } catch {
    return { price: null, changePct: null, changeAbs: null };
  }
}

const UP   = '#cf222e';
const DOWN = '#1f6feb';
function pctColor(v: number | null) { return v == null ? 'var(--text-muted)' : v >= 0 ? UP : DOWN; }
function pctStr(v: number | null, digits = 2) {
  if (v == null) return '–';
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%';
}
function fmtPrice(p: number | null, symbol: string) {
  if (p == null) return '–';
  if (symbol === '^VIX') return p.toFixed(2);
  if (symbol === '^KS11' || symbol === '^KQ11') return p.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
function fmtKrw(n: number) { return '₩' + Math.round(n).toLocaleString('ko-KR'); }

function TvChart({ tvSymbol, label, theme, onClose }: { tvSymbol: string; label: string; theme: string; onClose: () => void }) {
  const src = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=D&locale=kr&theme=${theme}&style=1&timezone=Asia%2FSeoul&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1`;
  return (
    <div style={{
      border: '1px solid var(--border-primary)', borderRadius: 12,
      overflow: 'hidden', marginBottom: 20, height: 480,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderBottom: '1px solid var(--border-primary)',
        background: 'var(--bg-card)',
      }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8 }}>{tvSymbol}</span>
        </div>
        <button onClick={onClose} style={{
          background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
          borderRadius: 6, width: 28, height: 28, cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>
      </div>
      <iframe
        key={tvSymbol}
        src={src}
        style={{ width: '100%', height: 'calc(100% - 43px)', border: 'none', display: 'block' }}
        title={label}
        allowFullScreen
      />
    </div>
  );
}

export default function Market({ holdings, usdKrw, isMobile, theme = 'dark' }: Props) {
  const [vixQuote, setVixQuote] = useState<Quote>({
    symbol: '^VIX', label: 'VIX', emoji: '😨', tvSymbol: 'CBOE:VIX',
    price: null, changePct: null, changeAbs: null, loading: true,
  });
  const [quotes, setQuotes] = useState<Quote[]>(
    INDICES.map(i => ({ ...i, price: null, changePct: null, changeAbs: null, loading: true }))
  );
  const [fxRates, setFxRates] = useState<FxRate[]>(
    FX_CONFIGS.map(c => ({ ...c, display: '', price: null, changePct: null, loading: true }))
  );
  const [selectedTv, setSelectedTv] = useState<{ sym: string; label: string } | null>(null);

  function selectChart(sym: string, label: string) {
    setSelectedTv(prev => prev?.sym === sym ? null : { sym, label });
  }

  // 지수 + VIX 순차 조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const vix = await fetchQuote('^VIX');
      if (!cancelled) setVixQuote(q => ({ ...q, ...vix, loading: false }));
      await new Promise(r => setTimeout(r, 150));
      for (const idx of INDICES) {
        if (cancelled) break;
        const q = await fetchQuote(idx.symbol);
        if (!cancelled) setQuotes(prev => prev.map(x => x.symbol === idx.symbol ? { ...x, ...q, loading: false } : x));
        await new Promise(r => setTimeout(r, 200));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 환율 조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of FX_CONFIGS) {
        if (cancelled) break;
        try {
          const { price, changePct } = await fetchQuote(c.symbol);
          const display = price != null ? c.formatter(price) : '–';
          if (!cancelled) {
            setFxRates(prev => prev.map(x => x.code === c.code
              ? { ...x, price, changePct, display, loading: false }
              : x
            ));
          }
        } catch {
          if (!cancelled) setFxRates(prev => prev.map(x => x.code === c.code ? { ...x, loading: false } : x));
        }
        await new Promise(r => setTimeout(r, 200));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 섹터 분석 (보유 종목 기준)
  const sectorData = useMemo(() => {
    const map = new Map<string, { value: number; profit: number; count: number; tickers: string[] }>();
    const nonCash = holdings.filter(h => h.ticker !== 'CASH');
    const totalVal = nonCash.reduce((s, h) => s + h.market_value_krw, 0);
    for (const h of nonCash) {
      const key = h.sector || '기타';
      const prev = map.get(key) ?? { value: 0, profit: 0, count: 0, tickers: [] };
      prev.value += h.market_value_krw;
      prev.profit += h.profit_krw;
      prev.count++;
      prev.tickers.push(h.name || h.ticker);
      map.set(key, prev);
    }
    return [...map.entries()]
      .map(([name, d]) => ({
        name, value: d.value, profit: d.profit, count: d.count,
        tickers: d.tickers.slice(0, 3),
        weight: totalVal > 0 ? d.value / totalVal : 0,
        profitPct: (d.value - d.profit) > 0 ? d.profit / (d.value - d.profit) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const vixInfo = vixLevel(vixQuote.price);
  const pd = isMobile ? '16px 12px' : '24px 28px';

  const cardStyle = (isSelected: boolean) => ({
    cursor: 'pointer' as const,
    transition: 'transform 0.12s, box-shadow 0.12s, border-color 0.12s',
    outline: isSelected ? '2px solid var(--accent)' : 'none',
    outlineOffset: isSelected ? '-1px' : undefined,
  });

  return (
    <div style={{ padding: pd, color: 'var(--text-primary)', minHeight: '100vh' }}>

      {/* ── 헤더 ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>시장 현황</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)' }}>클릭하면 차트</span>
        </span>
      </div>

      {/* ── VIX + 주요 지수 ──────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
        gap: 16, marginBottom: 16,
      }}>
        {/* VIX 공포 게이지 */}
        <div
          onClick={() => selectChart('CBOE:VIX', 'VIX 변동성 지수')}
          style={{
            ...cardStyle(selectedTv?.sym === 'CBOE:VIX'),
            background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
            borderRadius: 12, padding: '20px 20px',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            minHeight: isMobile ? 'auto' : 180,
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
        >
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              VIX 변동성 지수 ↗
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              {vixQuote.loading ? (
                <span className="skeleton" style={{ display: 'block', width: 72, height: 36, borderRadius: 6 }} />
              ) : (
                <>
                  <span style={{ fontSize: 36, fontWeight: 800, color: vixInfo.color, fontVariantNumeric: 'tabular-nums' }}>
                    {vixQuote.price?.toFixed(2) ?? '–'}
                  </span>
                  <span style={{ fontSize: 13, color: pctColor(vixQuote.changePct), fontWeight: 600 }}>
                    {pctStr(vixQuote.changePct)}
                  </span>
                </>
              )}
            </div>
            <div style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: 20,
              background: vixInfo.color + '22', border: `1px solid ${vixInfo.color}55`,
              fontSize: 12, fontWeight: 700, color: vixInfo.color, marginBottom: 16,
            }}>{vixInfo.label}</div>
          </div>
          <div>
            <div style={{ position: 'relative', height: 10, background: 'var(--bg-tertiary)', borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: `${vixInfo.pct}%`,
                background: 'linear-gradient(to right, #22c55e, #84cc16, #eab308, #f97316, #ef4444)',
                borderRadius: 5, transition: 'width 1s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}>
              <span>안정</span><span>보통</span><span>공포</span><span>패닉</span>
            </div>
          </div>
        </div>

        {/* 주요 지수 그리드 */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: 10 }}>
          {quotes.map(q => (
            <div
              key={q.symbol}
              onClick={() => selectChart(q.tvSymbol, q.label)}
              style={{
                ...cardStyle(selectedTv?.sym === q.tvSymbol),
                background: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px',
                border: '1px solid var(--border-primary)',
                borderLeft: !q.loading && q.changePct != null
                  ? `3px solid ${q.changePct >= 0 ? UP : DOWN}`
                  : '3px solid var(--border-primary)',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                <span style={{ fontSize: 13 }}>{q.emoji}</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: 0.3 }}>{q.label}</span>
              </div>
              {q.loading ? (
                <span className="skeleton" style={{ display: 'block', height: 22, borderRadius: 4, marginBottom: 6 }} />
              ) : (
                <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
                  {fmtPrice(q.price, q.symbol)}
                </div>
              )}
              {!q.loading && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(q.changePct) }}>{pctStr(q.changePct)}</span>
                  {q.changeAbs != null && (
                    <span style={{ fontSize: 10, color: pctColor(q.changePct) }}>
                      ({q.changeAbs >= 0 ? '+' : ''}{q.changeAbs.toFixed(2)})
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 인라인 TradingView 차트 ──────────────── */}
      {selectedTv && (
        <TvChart
          tvSymbol={selectedTv.sym}
          label={selectedTv.label}
          theme={theme}
          onClose={() => setSelectedTv(null)}
        />
      )}

      {/* ── 환율 ─────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          주요 환율 (클릭 시 차트)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 10 }}>
          {/* USD/KRW */}
          <div
            onClick={() => selectChart('FX_IDC:USDKRW', '달러/원 USD/KRW')}
            style={{
              ...cardStyle(selectedTv?.sym === 'FX_IDC:USDKRW'),
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 12, padding: '14px 16px',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
          >
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>🇺🇸 달러 USD/KRW</div>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
              {usdKrw > 0 ? fmtKrw(usdKrw) : '–'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>1달러 = 원화</div>
          </div>
          {/* EUR, JPY, DXY */}
          {fxRates.map(r => (
            <div
              key={r.code}
              onClick={() => selectChart(r.tvSymbol, r.label)}
              style={{
                ...cardStyle(selectedTv?.sym === r.tvSymbol),
                background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
                borderRadius: 12, padding: '14px 16px',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.flag} {r.label}</span>
                {!r.loading && r.changePct != null && (
                  <span style={{ fontSize: 9, color: pctColor(r.changePct), fontWeight: 600 }}>{pctStr(r.changePct, 2)}</span>
                )}
              </div>
              {r.loading ? (
                <span className="skeleton" style={{ display: 'block', height: 28, borderRadius: 4, marginBottom: 4 }} />
              ) : (
                <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                  {r.display || '–'}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                {r.code === 'EUR' ? '1유로 = 달러' : r.code === 'JPY' ? '1달러 = 엔' : '달러인덱스'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 내 포트폴리오 섹터 ──────────────────────── */}
      {sectorData.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            내 포트폴리오 섹터 구성
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sectorData.map(s => {
              const pct = s.profitPct;
              const intensity = Math.min(1, Math.abs(pct) / 15);
              const bg = pct >= 0
                ? `rgba(207, 34, 46, ${0.05 + intensity * 0.25})`
                : `rgba(31, 111, 235, ${0.05 + intensity * 0.25})`;
              const border = pct >= 0
                ? `rgba(207, 34, 46, ${0.2 + intensity * 0.5})`
                : `rgba(31, 111, 235, ${0.2 + intensity * 0.5})`;
              const minW = isMobile ? 'calc(50% - 4px)' : `${Math.max(120, s.weight * 700)}px`;
              return (
                <div key={s.name} style={{
                  background: bg, border: `1px solid ${border}`,
                  borderRadius: 10, padding: '14px 16px',
                  minWidth: minW, flexGrow: s.weight * 8,
                  boxSizing: 'border-box',
                }}>
                  <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: 'var(--text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 800, color: pct >= 0 ? UP : DOWN }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 6 }}>
                    {fmtKrw(s.value)} · {(s.weight * 100).toFixed(1)}%
                  </div>
                  {!isMobile && s.tickers.length > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                      {s.tickers.join(' · ')}{s.count > 3 ? ` +${s.count - 3}` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sectorData.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)', fontSize: 13 }}>
          보유 종목의 섹터를 설정하면 섹터 분석이 표시됩니다.
        </div>
      )}
    </div>
  );
}
