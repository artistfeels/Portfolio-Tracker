import { useState, useEffect, useMemo } from 'react';
import type { HoldingWithPrice } from '../lib/types';

interface Props {
  holdings: HoldingWithPrice[];
  usdKrw: number;
  isMobile?: boolean;
}

interface IndexQuote {
  symbol: string;
  label: string;
  price: number | null;
  changePct: number | null;
  loading: boolean;
}

interface Rate {
  code: string;
  label: string;
  flag: string;
  krw: number | null;
  unit: string;
}

const INDICES: { symbol: string; label: string }[] = [
  { symbol: '^KS11',  label: 'KOSPI'    },
  { symbol: '^KQ11',  label: 'KOSDAQ'   },
  { symbol: '^GSPC',  label: 'S&P 500'  },
  { symbol: '^IXIC',  label: 'Nasdaq'   },
  { symbol: '^DJI',   label: 'Dow Jones'},
  { symbol: '^N225',  label: 'Nikkei 225' },
  { symbol: '^VIX',   label: 'VIX (공포지수)' },
];

const CURRENCIES: { code: string; label: string; flag: string; unit: string }[] = [
  { code: 'USD', label: '미국 달러', flag: '🇺🇸', unit: '1 USD' },
  { code: 'EUR', label: '유로',     flag: '🇪🇺', unit: '1 EUR' },
  { code: 'JPY', label: '일본 엔',  flag: '🇯🇵', unit: '100 JPY' },
  { code: 'CNY', label: '중국 위안', flag: '🇨🇳', unit: '1 CNY' },
  { code: 'GBP', label: '영국 파운드', flag: '🇬🇧', unit: '1 GBP' },
];

async function fetchIndexQuote(symbol: string): Promise<{ price: number | null; changePct: number | null }> {
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    if (!meta) return { price: null, changePct: null };
    const price = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose;
    if (!price || !prevClose) return { price: price ?? null, changePct: null };
    return { price, changePct: ((price - prevClose) / prevClose) * 100 };
  } catch {
    return { price: null, changePct: null };
  }
}

const UP = 'var(--up)';
const DOWN = 'var(--down)';

function fmtKrw(n: number) { return '₩' + Math.round(n).toLocaleString('ko-KR'); }

function pctColor(v: number | null) {
  if (v == null) return 'var(--text-muted)';
  return v >= 0 ? UP : DOWN;
}

function pctStr(v: number | null) {
  if (v == null) return '-';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function indexFmt(price: number | null, symbol: string) {
  if (price == null) return '-';
  if (symbol === '^VIX') return price.toFixed(2);
  if (symbol === '^KS11' || symbol === '^KQ11') return price.toFixed(2);
  return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export default function Market({ holdings, usdKrw, isMobile }: Props) {
  const [quotes, setQuotes] = useState<IndexQuote[]>(
    INDICES.map(i => ({ ...i, price: null, changePct: null, loading: true }))
  );
  const [rates, setRates] = useState<Rate[]>(
    CURRENCIES.map(c => ({ ...c, krw: null }))
  );
  const [ratesLoaded, setRatesLoaded] = useState(false);

  // Fetch market indices progressively
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const idx of INDICES) {
        if (cancelled) break;
        const q = await fetchIndexQuote(idx.symbol);
        if (!cancelled) {
          setQuotes(prev => prev.map(x =>
            x.symbol === idx.symbol ? { ...x, ...q, loading: false } : x
          ));
        }
        await new Promise(r => setTimeout(r, 200));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch exchange rates
  useEffect(() => {
    fetch('https://api.frankfurter.app/latest?base=KRW&symbols=USD,EUR,JPY,CNY,GBP')
      .then(r => r.json())
      .then(j => {
        if (!j?.rates) return;
        setRates(prev => prev.map(c => {
          const rate = j.rates[c.code];
          if (!rate) return c;
          // 1 KRW = rate [currency], so 1 [currency] = 1/rate KRW
          const krw = c.code === 'JPY'
            ? Math.round(100 / rate)   // 100 JPY
            : Math.round(1 / rate);
          return { ...c, krw };
        }));
        setRatesLoaded(true);
      })
      .catch(() => {
        // fallback: use USD/KRW we already have
        setRates(prev => prev.map(c =>
          c.code === 'USD' ? { ...c, krw: usdKrw || 1380 } : c
        ));
        setRatesLoaded(true);
      });
  }, [usdKrw]);

  // Sector breakdown from holdings
  const sectorData = useMemo(() => {
    const map = new Map<string, { value: number; profit: number; count: number }>();
    const nonCash = holdings.filter(h => h.ticker !== 'CASH');
    const totalVal = nonCash.reduce((s, h) => s + h.market_value_krw, 0);
    for (const h of nonCash) {
      const sector = h.sector || '기타';
      const prev = map.get(sector) ?? { value: 0, profit: 0, count: 0 };
      prev.value += h.market_value_krw;
      prev.profit += h.profit_krw;
      prev.count += 1;
      map.set(sector, prev);
    }
    return [...map.entries()]
      .map(([name, d]) => ({
        name,
        value: d.value,
        profit: d.profit,
        count: d.count,
        weight: totalVal > 0 ? d.value / totalVal : 0,
        profitPct: d.value > 0 ? d.profit / (d.value - d.profit) * 100 : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  const pd = isMobile ? '16px 12px' : '24px 32px';

  const card = (content: React.ReactNode, key: string) => (
    <div key={key} style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
      borderRadius: 10, padding: '14px 18px',
    }}>
      {content}
    </div>
  );

  return (
    <div style={{ padding: pd, maxWidth: 1000 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px' }}>시장</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>주요 지수, 환율, 섹터 현황</p>
      </div>

      {/* 주요 지수 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          주요 지수
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
          gap: 10,
        }}>
          {quotes.map(q =>
            card(
              <>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{q.label}</div>
                {q.loading ? (
                  <span className="skeleton" style={{ display: 'block', height: 22, borderRadius: 4, marginBottom: 4 }} />
                ) : (
                  <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, marginBottom: 3 }}>
                    {indexFmt(q.price, q.symbol)}
                  </div>
                )}
                {!q.loading && (
                  <div style={{ fontSize: 12, color: pctColor(q.changePct), fontWeight: 600 }}>
                    {pctStr(q.changePct)}
                  </div>
                )}
              </>,
              q.symbol
            )
          )}
        </div>
      </div>

      {/* 환율 */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
          환율 (기준: 원)
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)',
          gap: 10,
        }}>
          {rates.map(r =>
            card(
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {r.flag} {r.unit}
                </div>
                {!ratesLoaded ? (
                  <span className="skeleton" style={{ display: 'block', height: 20, borderRadius: 4 }} />
                ) : (
                  <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700 }}>
                    {r.krw != null ? fmtKrw(r.krw) : '-'}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{r.label}</div>
              </>,
              r.code
            )
          )}
        </div>
      </div>

      {/* 섹터 히트맵 */}
      {sectorData.length > 0 && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            내 포트폴리오 섹터
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8,
          }}>
            {sectorData.map(s => {
              const pct = s.profitPct;
              const alpha = Math.min(0.85, Math.abs(pct) / 20);
              const color = pct >= 0
                ? `rgba(207, 34, 46, ${0.06 + alpha * 0.3})`   // red tint for gain (Korean up=red)
                : `rgba(31, 111, 235, ${0.06 + alpha * 0.3})`;  // blue tint for loss
              const borderColor = pct >= 0
                ? `rgba(207, 34, 46, ${0.3 + alpha * 0.5})`
                : `rgba(31, 111, 235, ${0.3 + alpha * 0.5})`;
              const minW = Math.max(100, s.weight * 600);
              return (
                <div key={s.name} style={{
                  background: color, border: `1px solid ${borderColor}`,
                  borderRadius: 10, padding: '14px 16px',
                  minWidth: isMobile ? '45%' : minW, flexGrow: s.weight * 10,
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{s.name}</div>
                  <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: pct >= 0 ? UP : DOWN }}>
                    {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                    {fmtKrw(s.value)} · {(s.weight * 100).toFixed(1)}% · {s.count}종목
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
