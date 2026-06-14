import { useMemo, useState, useEffect } from 'react';
import type { Transaction, HoldingWithPrice } from '../lib/types';

interface Props {
  transactions: Transaction[];
  holdings: HoldingWithPrice[];
  usdKrw: number;
  isMobile?: boolean;
}

interface DivInfo {
  ticker: string;
  name: string;
  annualRate: number | null;
  exDate: string | null;
  yieldPct: number | null;
}

const UP = 'var(--up)';

async function fetchDivInfo(ticker: string): Promise<DivInfo> {
  try {
    // 한국 6자리 코드는 Yahoo 배당 데이터 없음
    if (/^\d{6}$/.test(ticker)) return { ticker, name: '', annualRate: null, exDate: null, yieldPct: null };
    const sym = /^\d{4}$/.test(ticker) ? `${ticker}.HK` : ticker.toUpperCase();
    const res = await fetch(`/api/yahoo/v11/finance/quoteSummary/${encodeURIComponent(sym)}?modules=summaryDetail`);
    const j = await res.json();
    const sd = j?.quoteSummary?.result?.[0]?.summaryDetail;
    if (!sd) return { ticker, name: '', annualRate: null, exDate: null, yieldPct: null };
    const exDateRaw: number | null = sd.exDividendDate?.raw ?? null;
    return {
      ticker,
      name: '',
      annualRate: sd.dividendRate?.raw ?? null,
      exDate: exDateRaw ? new Date(exDateRaw * 1000).toISOString().slice(0, 10) : null,
      yieldPct: sd.dividendYield?.raw != null ? sd.dividendYield.raw * 100 : null,
    };
  } catch {
    return { ticker, name: '', annualRate: null, exDate: null, yieldPct: null };
  }
}

function fmtKrw(n: number) { return '₩' + Math.round(n).toLocaleString('ko-KR'); }

export default function Dividend({ transactions, holdings, usdKrw, isMobile }: Props) {
  const [tab, setTab] = useState<'history' | 'forecast'>('history');
  const [divInfos, setDivInfos] = useState<DivInfo[]>([]);
  const [loadingForecast, setLoadingForecast] = useState(false);

  // 배당 수령 내역 (action='dividend')
  const divTxs = useMemo(
    () => [...transactions.filter(t => t.action === 'dividend')]
      .sort((a, b) => b.trade_date.localeCompare(a.trade_date)),
    [transactions]
  );

  // 연도별 집계
  const byYear = useMemo(() => {
    const map: Record<string, { total: number; items: Transaction[] }> = {};
    for (const tx of divTxs) {
      const yr = tx.trade_date.slice(0, 4);
      const m = map[yr] ?? { total: 0, items: [] };
      m.total += tx.shares * tx.price_krw;
      m.items.push(tx);
      map[yr] = m;
    }
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [divTxs]);

  const thisYear = String(new Date().getFullYear());
  const ytdTotal = byYear.find(([yr]) => yr === thisYear)?.[1].total ?? 0;
  const allTimeTotal = divTxs.reduce((s, t) => s + t.shares * t.price_krw, 0);

  useEffect(() => {
    if (tab !== 'forecast') return;
    setLoadingForecast(true);
    const nonCash = holdings.filter(h => h.ticker !== 'CASH');
    Promise.all(nonCash.map(h => fetchDivInfo(h.ticker)))
      .then(results => { setDivInfos(results); setLoadingForecast(false); });
  }, [tab, holdings]);

  const forecastItems = useMemo(() => {
    if (divInfos.length === 0) return [];
    const rate = usdKrw || 1380;
    return divInfos.map(d => {
      const h = holdings.find(x => x.ticker === d.ticker);
      if (!h || !d.annualRate) return null;
      const isHk = /^\d{4}$/.test(d.ticker);
      const rateMultiplier = isHk ? rate / 7.78 : rate;
      const annualKrw = d.annualRate * h.shares * rateMultiplier;
      const monthlyKrw = annualKrw / 12;
      return { ...d, name: h.name, shares: h.shares, annualKrw, monthlyKrw };
    }).filter(Boolean) as { ticker: string; name: string; shares: number; annualRate: number; annualKrw: number; monthlyKrw: number; exDate: string | null; yieldPct: number | null }[];
  }, [divInfos, holdings, usdKrw]);

  const forecastTotal = forecastItems.reduce((s, x) => s + x.annualKrw, 0);

  const pd = isMobile ? '16px 12px' : '24px 32px';
  const thStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontWeight: 600, fontSize: 11,
    color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)',
    whiteSpace: 'nowrap',
  };
  const tdStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontSize: isMobile ? 12 : 13,
    borderBottom: '1px solid var(--border-primary)',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ padding: pd, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px' }}>배당 트래킹</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>배당 수령 내역 및 예상 연간 배당</p>
      </div>

      {/* 요약 카드 */}
      <div style={{
        display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)',
        gap: 12, marginBottom: 24,
      }}>
        {[
          { label: `${thisYear}년 수령 (YTD)`, value: ytdTotal, color: UP },
          { label: '누적 수령 배당', value: allTimeTotal, color: 'var(--text-primary)' },
          { label: '예상 연간 배당', value: forecastTotal, color: 'var(--accent)', note: '현재 보유 기준' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
            borderRadius: 10, padding: '14px 18px',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, color: c.color }}>
              {fmtKrw(c.value)}
            </div>
            {c.note && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{c.note}</div>}
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
            {t === 'history' ? '수령 내역' : '예상 배당'}
          </button>
        ))}
      </div>

      {tab === 'history' && (
        divTxs.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            배당 수령 내역이 없습니다. 거래내역에서 action='배당'으로 추가하세요.
          </div>
        ) : (
          <div>
            {byYear.map(([year, { total, items }]) => (
              <div key={year} style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{year}년</span>
                  <span style={{ fontSize: 12, color: UP, fontWeight: 600 }}>{fmtKrw(total)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{items.length}건</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, textAlign: 'left' }}>날짜</th>
                        <th style={{ ...thStyle, textAlign: 'left' }}>종목</th>
                        <th style={thStyle}>주수</th>
                        <th style={thStyle}>주당 배당금</th>
                        <th style={thStyle}>수령액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(tx => (
                        <tr key={tx.id}>
                          <td style={{ ...tdStyle, textAlign: 'left', color: 'var(--text-secondary)' }}>{tx.trade_date}</td>
                          <td style={{ ...tdStyle, textAlign: 'left' }}>
                            <div style={{ fontWeight: 600 }}>{tx.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{tx.ticker}</div>
                          </td>
                          <td style={tdStyle}>{tx.shares.toLocaleString('ko-KR')}</td>
                          <td style={tdStyle}>{fmtKrw(tx.price_krw)}</td>
                          <td style={{ ...tdStyle, color: UP, fontWeight: 600 }}>{fmtKrw(tx.shares * tx.price_krw)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'forecast' && (
        loadingForecast ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            배당 정보 불러오는 중...
          </div>
        ) : forecastItems.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            현재 보유 종목에 배당 데이터가 없습니다. (한국 주식·ETF는 Yahoo 데이터 제한)
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
                    <th style={thStyle}>예상 연간</th>
                    <th style={thStyle}>예상 월평균</th>
                    {!isMobile && <th style={thStyle}>다음 배당락일</th>}
                  </tr>
                </thead>
                <tbody>
                  {forecastItems.sort((a, b) => b.annualKrw - a.annualKrw).map(item => (
                    <tr key={item.ticker}>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.ticker}</div>
                      </td>
                      {!isMobile && <td style={tdStyle}>{item.shares.toLocaleString('ko-KR')}</td>}
                      <td style={{ ...tdStyle, color: UP }}>
                        {item.yieldPct != null ? item.yieldPct.toFixed(2) + '%' : '-'}
                      </td>
                      <td style={{ ...tdStyle, color: UP, fontWeight: 600 }}>{fmtKrw(item.annualKrw)}</td>
                      <td style={tdStyle}>{fmtKrw(item.monthlyKrw)}</td>
                      {!isMobile && (
                        <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>
                          {item.exDate ?? '-'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              * Yahoo Finance 기준 연간 배당금 × 현재 보유 주수. 환율·세금 미반영. 배당 일정은 변동될 수 있습니다.
            </div>
          </div>
        )
      )}
    </div>
  );
}
