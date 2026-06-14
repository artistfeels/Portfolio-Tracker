import { useState, useEffect, useMemo } from 'react';
import type { HoldingWithPrice } from '../lib/types';

interface Props {
  holdings: HoldingWithPrice[];
  usdKrw: number;
  isMobile?: boolean;
}

// ─── 데이터 타입 ──────────────────────────────────────────────
interface Quote {
  symbol: string;
  label: string;
  emoji: string;
  price: number | null;
  changePct: number | null;
  changeAbs: number | null;
  loading: boolean;
}

interface CurrencyRate {
  code: string;
  label: string;
  flag: string;
  unit: string;
  krw: number | null;
  changePct: number | null;
  loading: boolean;
}

// ─── 설정 ─────────────────────────────────────────────────────
const INDICES: { symbol: string; label: string; emoji: string }[] = [
  { symbol: '^KS11',  label: 'KOSPI',      emoji: '🇰🇷' },
  { symbol: '^KQ11',  label: 'KOSDAQ',     emoji: '🇰🇷' },
  { symbol: '^GSPC',  label: 'S&P 500',    emoji: '🇺🇸' },
  { symbol: '^IXIC',  label: 'Nasdaq',     emoji: '🇺🇸' },
  { symbol: '^DJI',   label: 'Dow Jones',  emoji: '🇺🇸' },
  { symbol: '^N225',  label: 'Nikkei 225', emoji: '🇯🇵' },
];

const CURRENCIES: { symbol: string; code: string; label: string; flag: string; unit: string; mul?: number }[] = [
  { symbol: 'EURKRW=X', code: 'EUR', label: '유로',    flag: '🇪🇺', unit: '1 EUR' },
  { symbol: 'JPYKRW=X', code: 'JPY', label: '엔화',    flag: '🇯🇵', unit: '100 JPY', mul: 100 },
  { symbol: 'CNYKRW=X', code: 'CNY', label: '위안화',  flag: '🇨🇳', unit: '1 CNY' },
  { symbol: 'GBPKRW=X', code: 'GBP', label: '파운드',  flag: '🇬🇧', unit: '1 GBP' },
];

// ─── VIX 해석 ──────────────────────────────────────────────────
function vixLevel(vix: number | null): { label: string; color: string; pct: number } {
  if (vix == null) return { label: '–', color: '#6e7681', pct: 0 };
  if (vix < 13)  return { label: '극도의 안정',  color: '#22c55e', pct: Math.round(vix / 50 * 100) };
  if (vix < 18)  return { label: '안정',         color: '#84cc16', pct: Math.round(vix / 50 * 100) };
  if (vix < 25)  return { label: '보통',          color: '#eab308', pct: Math.round(vix / 50 * 100) };
  if (vix < 35)  return { label: '공포',          color: '#f97316', pct: Math.round(vix / 50 * 100) };
  return          { label: '극도의 공포',         color: '#ef4444', pct: Math.min(98, Math.round(vix / 50 * 100)) };
}

// ─── Yahoo Finance 시세 조회 ───────────────────────────────────
async function fetchQuote(symbol: string): Promise<{ price: number | null; changePct: number | null; changeAbs: number | null }> {
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePct: null, changeAbs: null };
    const price = meta.regularMarketPrice as number;
    const prev  = (meta.chartPreviousClose ?? meta.previousClose) as number;
    if (!price || !prev) return { price: price ?? null, changePct: null, changeAbs: null };
    return {
      price,
      changePct: ((price - prev) / prev) * 100,
      changeAbs: price - prev,
    };
  } catch {
    return { price: null, changePct: null, changeAbs: null };
  }
}

// ─── 헬퍼 ────────────────────────────────────────────────────
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

// ─── 컴포넌트 ─────────────────────────────────────────────────
export default function Market({ holdings, usdKrw, isMobile }: Props) {
  const [vixQuote, setVixQuote] = useState<Quote>({ symbol: '^VIX', label: 'VIX', emoji: '😨', price: null, changePct: null, changeAbs: null, loading: true });
  const [quotes, setQuotes] = useState<Quote[]>(INDICES.map(i => ({ ...i, price: null, changePct: null, changeAbs: null, loading: true })));
  const [rates, setRates] = useState<CurrencyRate[]>(CURRENCIES.map(c => ({ ...c, krw: null, changePct: null, loading: true })));

  // 지수 + VIX 순차 조회
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // VIX 먼저
      const vix = await fetchQuote('^VIX');
      if (!cancelled) setVixQuote(q => ({ ...q, ...vix, loading: false }));
      await new Promise(r => setTimeout(r, 150));
      // 나머지 지수
      for (const idx of INDICES) {
        if (cancelled) break;
        const q = await fetchQuote(idx.symbol);
        if (!cancelled) {
          setQuotes(prev => prev.map(x => x.symbol === idx.symbol ? { ...x, ...q, loading: false } : x));
        }
        await new Promise(r => setTimeout(r, 200));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 환율 조회 (Yahoo Finance 통화쌍)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const c of CURRENCIES) {
        if (cancelled) break;
        try {
          const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(c.symbol)}?interval=1d&range=5d`);
          const j = await res.json();
          const meta = j?.chart?.result?.[0]?.meta;
          if (!meta) { setRates(prev => prev.map(x => x.code === c.code ? { ...x, loading: false } : x)); continue; }
          const price: number = meta.regularMarketPrice;
          const prev: number  = meta.chartPreviousClose ?? meta.previousClose;
          const mul = c.mul ?? 1;
          const krw   = price  * mul;
          const changePct = prev > 0 ? ((price - prev) / prev) * 100 : null;
          if (!cancelled) {
            setRates(p => p.map(x => x.code === c.code ? { ...x, krw: Math.round(krw), changePct, loading: false } : x));
          }
        } catch {
          if (!cancelled) setRates(p => p.map(x => x.code === c.code ? { ...x, loading: false } : x));
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
        name,
        value: d.value,
        profit: d.profit,
        count: d.count,
        tickers: d.tickers.slice(0, 3),
        weight: totalVal > 0 ? d.value / totalVal : 0,
        profitPct: (d.value - d.profit) > 0 ? d.profit / (d.value - d.profit) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const vixInfo = vixLevel(vixQuote.price);
  const pd = isMobile ? '16px 12px' : '24px 28px';

  return (
    <div style={{ padding: pd, color: 'var(--text-primary)', minHeight: '100vh' }}>

      {/* ── 헤더 ──────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>시장 현황</h2>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>

      {/* ── VIX + 주요 지수 (2열 레이아웃) ──────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
        gap: 16,
        marginBottom: 20,
      }}>
        {/* VIX 공포 게이지 */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
          borderRadius: 12, padding: '20px 20px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          minHeight: isMobile ? 'auto' : 180,
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              VIX 변동성 지수
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
            }}>
              {vixInfo.label}
            </div>
          </div>
          {/* 게이지 바 */}
          <div>
            <div style={{ position: 'relative', height: 10, background: 'var(--bg-tertiary)', borderRadius: 5, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${vixInfo.pct}%`,
                background: `linear-gradient(to right, #22c55e, #84cc16, #eab308, #f97316, #ef4444)`,
                borderRadius: 5,
                transition: 'width 1s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)' }}>
              <span>안정</span><span>보통</span><span>공포</span><span>패닉</span>
            </div>
          </div>
        </div>

        {/* 주요 지수 그리드 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
          gap: 10,
        }}>
          {quotes.map(q => (
            <div key={q.symbol} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 12, padding: '14px 16px',
              borderLeft: !q.loading && q.changePct != null
                ? `3px solid ${q.changePct >= 0 ? UP : DOWN}`
                : '3px solid var(--border-primary)',
            }}>
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
                  <span style={{ fontSize: 12, fontWeight: 700, color: pctColor(q.changePct) }}>
                    {pctStr(q.changePct)}
                  </span>
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

      {/* ── 환율 ─────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          환율 (원화 기준)
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {/* USD: use prop value */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>🇺🇸 1 USD</div>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700 }}>
              {usdKrw > 0 ? fmtKrw(usdKrw) : '–'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>미국 달러</div>
          </div>
          {/* Other currencies */}
          {rates.map(r => (
            <div key={r.code} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 12, padding: '14px 16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.flag} {r.unit}</span>
                {!r.loading && r.changePct != null && (
                  <span style={{ fontSize: 9, color: pctColor(r.changePct), fontWeight: 600 }}>{pctStr(r.changePct, 1)}</span>
                )}
              </div>
              {r.loading ? (
                <span className="skeleton" style={{ display: 'block', height: 22, borderRadius: 4, marginBottom: 4 }} />
              ) : (
                <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 700 }}>
                  {r.krw != null ? fmtKrw(r.krw) : '–'}
                </div>
              )}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{r.label}</div>
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

          {/* 트리맵 스타일 히트맵 */}
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
          보유 종목이 없으면 섹터 분석이 표시되지 않습니다.
        </div>
      )}
    </div>
  );
}
