import { useMemo, useState, useEffect, useCallback } from 'react';
import type { Transaction, HoldingWithPrice } from '../lib/types';
import { calcHoldingsAtDate } from '../lib/history';
import { KR_TICKER_SUFFIX } from '../lib/prices';

interface Props {
  transactions: Transaction[];
  holdings: HoldingWithPrice[];
  usdKrw: number;
  isMobile?: boolean;
}

interface DivEvent {
  date: string;
  ticker: string;
  name: string;
  amountPerShare: number; // in original currency
  amountPerShareKrw: number;
  shares: number;
  totalKrw: number;
}

interface ForecastItem {
  ticker: string;
  name: string;
  shares: number;
  annualRateUsd: number | null;
  annualKrw: number;
  yieldPct: number | null;
  exDate: string | null;
  frequency: string;
}

function toYahooSym(ticker: string): string {
  if (ticker === 'GOLD') return 'GC=F';
  if (/^\d{6}$/.test(ticker)) {
    const suffix = KR_TICKER_SUFFIX[ticker] ?? 'KS';
    return `${ticker}.${suffix}`;
  }
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}

function estimateFrequency(events: { date: string; amount: number }[]): string {
  if (events.length < 2) return '불명';
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const d1 = new Date(events[i - 1].date).getTime();
    const d2 = new Date(events[i].date).getTime();
    gaps.push((d2 - d1) / (1000 * 86400));
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avgGap < 40)  return '월배당';
  if (avgGap < 100) return '분기배당';
  if (avgGap < 200) return '반기배당';
  return '연간배당';
}

async function fetchDivHistory(
  ticker: string,
  transactions: Transaction[],
  usdKrw: number,
  holdingName: string
): Promise<DivEvent[]> {
  const sym = toYahooSym(ticker);
  if (!sym) return [];

  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=10y&events=div`,
      { signal: ctrl.signal }
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];

    const rawDivs = result.events?.dividends as Record<string, { amount: number; date: number }> | undefined;
    if (!rawDivs) return [];

    const currency: string = result.meta?.currency ?? 'USD';
    const isKrw = currency === 'KRW';
    const isHk  = /^\d{4}$/.test(ticker);
    const mul   = isKrw ? 1 : isHk ? (usdKrw / 7.78) : usdKrw;

    return Object.values(rawDivs)
      .map(d => {
        const date = new Date(d.date * 1000).toISOString().slice(0, 10);
        const sharesAtDate = calcHoldingsAtDate(transactions, date).get(ticker) ?? 0;
        if (sharesAtDate <= 0) return null;
        const amountKrw = d.amount * mul;
        return {
          date,
          ticker,
          name: holdingName,
          amountPerShare: d.amount,
          amountPerShareKrw: Math.round(amountKrw),
          shares: sharesAtDate,
          totalKrw: Math.round(amountKrw * sharesAtDate),
        } satisfies DivEvent;
      })
      .filter((d): d is DivEvent => d !== null)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

async function fetchForecast(ticker: string, shares: number, usdKrw: number, name: string): Promise<ForecastItem | null> {
  const sym = toYahooSym(ticker);
  if (!sym) return null;
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    // quoteSummary for dividendRate, exDividendDate
    const [summaryRes, histRes] = await Promise.all([
      fetch(`/api/yahoo/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=summaryDetail`, { signal: ctrl.signal }),
      fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y&events=div`),
    ]);
    const summaryJ = await summaryRes.json();
    const histJ    = await histRes.json();

    const sd = summaryJ?.quoteSummary?.result?.[0]?.summaryDetail;
    const rawDivs = histJ?.chart?.result?.[0]?.events?.dividends as Record<string, { amount: number; date: number }> | undefined;
    const currency: string = histJ?.chart?.result?.[0]?.meta?.currency ?? 'USD';
    const isKrw = currency === 'KRW';
    const isHk  = /^\d{4}$/.test(ticker);
    const mul   = isKrw ? 1 : isHk ? (usdKrw / 7.78) : usdKrw;

    const annualRateUsd: number | null = sd?.dividendRate?.raw ?? null;
    if (!annualRateUsd && !sd?.trailingAnnualDividendRate?.raw) return null;
    const rate = annualRateUsd ?? sd?.trailingAnnualDividendRate?.raw;
    const annualKrw = Math.round(rate * shares * mul);

    const events = rawDivs
      ? Object.values(rawDivs).map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount })).sort((a, b) => a.date.localeCompare(b.date))
      : [];

    const exDateRaw: number | null = sd?.exDividendDate?.raw ?? null;
    const exDate = exDateRaw ? new Date(exDateRaw * 1000).toISOString().slice(0, 10) : null;
    const yieldPct: number | null = sd?.dividendYield?.raw != null ? sd.dividendYield.raw * 100 : null;

    return {
      ticker, name, shares, annualRateUsd: rate, annualKrw,
      yieldPct, exDate, frequency: estimateFrequency(events),
    };
  } catch {
    return null;
  }
}

function fmtKrw(n: number) { return '₩' + Math.round(n).toLocaleString('ko-KR'); }
const UP = 'var(--up)';

export default function Dividend({ transactions, holdings, usdKrw, isMobile }: Props) {
  const [tab, setTab]               = useState<'history' | 'forecast'>('history');
  const [divEvents, setDivEvents]   = useState<DivEvent[]>([]);
  const [forecasts, setForecasts]   = useState<ForecastItem[]>([]);
  const [loadingHist, setLoadingHist] = useState(false);
  const [loadingFore, setLoadingFore] = useState(false);
  const [histLoaded,  setHistLoaded]  = useState(false);
  const [foreLoaded,  setForeLoaded]  = useState(false);

  const nonCashHoldings = useMemo(() => holdings.filter(h => h.ticker !== 'CASH'), [holdings]);
  const rate = usdKrw || 1380;

  // 배당 히스토리 자동 조회
  const loadHistory = useCallback(async () => {
    if (histLoaded || loadingHist) return;
    setLoadingHist(true);
    const all: DivEvent[] = [];
    for (const h of nonCashHoldings) {
      const evts = await fetchDivHistory(h.ticker, transactions, rate, h.name);
      all.push(...evts);
      if (evts.length > 0) await new Promise(r => setTimeout(r, 200));
    }
    setDivEvents(all.sort((a, b) => b.date.localeCompare(a.date)));
    setHistLoaded(true);
    setLoadingHist(false);
  }, [nonCashHoldings, transactions, rate, histLoaded, loadingHist]);

  // 예상 배당 조회
  const loadForecast = useCallback(async () => {
    if (foreLoaded || loadingFore) return;
    setLoadingFore(true);
    const results = await Promise.all(
      nonCashHoldings.map(h => fetchForecast(h.ticker, h.shares, rate, h.name))
    );
    setForecasts(results.filter((x): x is ForecastItem => x !== null).sort((a, b) => b.annualKrw - a.annualKrw));
    setForeLoaded(true);
    setLoadingFore(false);
  }, [nonCashHoldings, rate, foreLoaded, loadingFore]);

  // 페이지 진입 시 히스토리 자동 로드
  useEffect(() => { loadHistory(); }, [loadHistory]);

  // 탭 전환 시 예상 배당 로드
  useEffect(() => { if (tab === 'forecast') loadForecast(); }, [tab, loadForecast]);

  // 집계
  const byYear = useMemo(() => {
    const map: Record<string, { total: number; items: DivEvent[] }> = {};
    for (const e of divEvents) {
      const yr = e.date.slice(0, 4);
      const m = map[yr] ?? { total: 0, items: [] };
      m.total += e.totalKrw;
      m.items.push(e);
      map[yr] = m;
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [divEvents]);

  const thisYear    = String(new Date().getFullYear());
  const ytdTotal    = byYear.find(([yr]) => yr === thisYear)?.[1].total ?? 0;
  const allTotal    = divEvents.reduce((s, e) => s + e.totalKrw, 0);
  const foreTotal   = forecasts.reduce((s, f) => s + f.annualKrw, 0);

  const pd = isMobile ? '16px 12px' : '24px 28px';
  const thStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontWeight: 600, fontSize: 11, color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontSize: isMobile ? 12 : 13,
    borderBottom: '1px solid var(--border-primary)',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--text-primary)',
  };

  return (
    <div style={{ padding: pd, color: 'var(--text-primary)' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>배당 트래킹</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>Yahoo Finance 배당 데이터 기반 자동 집계</p>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: `${thisYear}년 수령 (YTD)`, value: ytdTotal, sub: `${byYear.find(([y]) => y === thisYear)?.[1].items.length ?? 0}건`, color: UP },
          { label: '누적 수령 배당', value: allTotal, sub: `${divEvents.length}건`, color: 'var(--text-primary)' },
          { label: '예상 연간 배당', value: foreTotal, sub: '현재 보유 기준', color: 'var(--accent)' },
        ].map(c => (
          <div key={c.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, color: c.color }}>{fmtKrw(c.value)}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['history', 'forecast'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--border-primary)',
            background: tab === t ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: tab === t ? '#fff' : 'var(--text-secondary)',
          }}>
            {t === 'history' ? '📅 수령 내역' : '📊 예상 배당'}
          </button>
        ))}
      </div>

      {/* 수령 내역 탭 */}
      {tab === 'history' && (
        loadingHist ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <div style={{ marginBottom: 8 }}>배당 내역 불러오는 중...</div>
            <div style={{ fontSize: 11 }}>Yahoo Finance에서 보유 종목 배당 이벤트를 조회합니다</div>
          </div>
        ) : divEvents.length === 0 && histLoaded ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            조회된 배당 내역이 없습니다.
            <div style={{ fontSize: 11, marginTop: 8 }}>한국 주식 배당은 Yahoo Finance 데이터 미비로 표시되지 않을 수 있습니다.</div>
          </div>
        ) : (
          byYear.map(([year, { total, items }]) => (
            <div key={year} style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700 }}>{year}년</span>
                <span style={{ fontSize: 13, color: UP, fontWeight: 600 }}>{fmtKrw(total)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length}건</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>날짜</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>종목</th>
                      <th style={thStyle}>보유주수</th>
                      <th style={thStyle}>주당 배당</th>
                      <th style={thStyle}>수령액 (원)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((e, idx) => (
                      <tr key={idx}>
                        <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--text-secondary)' }}>{e.date}</td>
                        <td style={{ ...tdStyle, textAlign: 'left' }}>
                          <div style={{ fontWeight: 600 }}>{e.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{e.ticker}</div>
                        </td>
                        <td style={tdStyle}>{e.shares.toLocaleString('ko-KR')}</td>
                        <td style={tdStyle}>{fmtKrw(e.amountPerShareKrw)}</td>
                        <td style={{ ...tdStyle, color: UP, fontWeight: 600 }}>{fmtKrw(e.totalKrw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )
      )}

      {/* 예상 배당 탭 */}
      {tab === 'forecast' && (
        loadingFore ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            예상 배당 데이터 조회 중...
          </div>
        ) : forecasts.length === 0 && foreLoaded ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            예상 배당 데이터가 없습니다.
            <div style={{ fontSize: 11, marginTop: 8 }}>무배당 종목이거나 Yahoo Finance에 배당 정보가 없는 종목입니다.</div>
          </div>
        ) : (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>종목</th>
                    {!isMobile && <th style={thStyle}>주수</th>}
                    <th style={thStyle}>배당수익률</th>
                    <th style={thStyle}>지급 주기</th>
                    <th style={thStyle}>예상 연간</th>
                    <th style={thStyle}>월평균</th>
                    {!isMobile && <th style={thStyle}>다음 배당락일</th>}
                  </tr>
                </thead>
                <tbody>
                  {forecasts.map(f => (
                    <tr key={f.ticker}>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{f.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.ticker}</div>
                      </td>
                      {!isMobile && <td style={tdStyle}>{f.shares.toLocaleString('ko-KR')}</td>}
                      <td style={{ ...tdStyle, color: UP }}>{f.yieldPct != null ? f.yieldPct.toFixed(2) + '%' : '–'}</td>
                      <td style={{ ...tdStyle, color: 'var(--text-secondary)', fontSize: 11 }}>{f.frequency}</td>
                      <td style={{ ...tdStyle, color: UP, fontWeight: 600 }}>{fmtKrw(f.annualKrw)}</td>
                      <td style={tdStyle}>{fmtKrw(f.annualKrw / 12)}</td>
                      {!isMobile && <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{f.exDate ?? '–'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              * Yahoo Finance 기준 연간 배당율 × 현재 보유주수. 세금·환율 미반영. 배당은 변동될 수 있습니다.
            </div>
          </div>
        )
      )}
    </div>
  );
}
