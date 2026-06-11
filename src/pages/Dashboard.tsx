import React, { useState, useMemo } from 'react';
import type { usePortfolio } from '../hooks/usePortfolio';
import ChartPanel from '../components/ChartPanel';
import SparkLine from '../components/SparkLine';
import MarketBar from '../components/MarketBar';
import { calcHoldingIrrs, calcPortfolioIrr } from '../lib/calc';

type PortfolioState = ReturnType<typeof usePortfolio>;

interface Props {
  portfolio: PortfolioState;
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

export default function Dashboard({ portfolio }: Props) {
  const { transactions, holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload, updateCash } = portfolio;
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tab, setTab] = useState<'시세' | '평가'>('시세');
  const [sortKey, setSortKey] = useState<string>('market_value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [editingCash, setEditingCash] = useState(false);
  const [cashInput, setCashInput] = useState('');
  const [selectedMarket, setSelectedMarket] = useState<{ sym: string; label: string } | null>(null);

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
    <div style={{ padding: '20px 8px', minWidth: 0 }}>

      {/* ── 헤더 ──────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, lineHeight: 1, whiteSpace: 'nowrap' }}>
            {fmtKrw(summary.totalValue)}
          </div>
          <div style={{ marginTop: 6, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
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

        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRefreshing && <span style={{ color: 'var(--down)', fontSize: 11 }}>● 업데이트 중</span>}
            {lastUpdated && !isRefreshing && <span>{timeSince(lastUpdated)} 업데이트</span>}
            <button
              onClick={() => reload()}
              style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
            >
              새로고침
            </button>
          </div>
          {usdKrw > 0 && <div>USD/KRW {usdKrw.toLocaleString()}</div>}
        </div>
      </div>

      {/* ── 요약 카드 6개 ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
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
          <div key={c.label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 }}>{c.label}</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: c.color, whiteSpace: 'nowrap' }}>{c.value}</div>
            {'sub' in c && c.sub && (
              <div style={{ fontSize: 13, color: c.color, marginTop: 2 }}>{c.sub}</div>
            )}
          </div>
        ))}
        {/* 현금 카드 (인라인 편집) */}
        {(() => {
          const cashVal = holdings.find(h => h.ticker === 'CASH')?.market_value_krw ?? 0;
          return (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 5 }}>현금</div>
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
                  style={{ fontSize: 19, fontWeight: 700, color: '#3fb950', whiteSpace: 'nowrap', cursor: 'text', borderBottom: '1px dashed var(--border-primary)', display: 'inline-block' }}
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
        <div style={{ marginBottom: 16, background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <ChartPanel ticker={selectedMarket.sym} name={selectedMarket.label} />
        </div>
      )}

      {/* ── 자산 구성 + 오늘의 움직임 ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: showMovers ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 16 }}>

        {/* 자산 구성 */}
        {assetGroups.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>자산 구성</div>
            {assetGroups.map(g => {
              const pct = assetTotal > 0 ? g.value / assetTotal * 100 : 0;
              return (
                <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <div style={{ width: 70, fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0, textAlign: 'right' }}>{g.label}</div>
                  <div style={{ flex: 1, height: 14, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: g.color, borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ width: 38, fontSize: 11, color: g.color, textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(1)}%</div>
                  <div style={{ width: 100, fontSize: 11, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {(g.value / 1_0000).toFixed(0)}만원
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 오늘의 움직임 */}
        {showMovers && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>상승 상위</div>
              {gainers.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>없음</div>
                : gainers.map(h => (
                  <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{h.name}</span>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--up)', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                      <div style={{ fontSize: 10, color: 'var(--up)' }}>+{Math.round(h.dailyPnl / 10000)}만원</div>
                    </div>
                  </div>
                ))
              }
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>하락 상위</div>
              {losers.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>없음</div>
                : losers.map(h => (
                  <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{h.name}</span>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
                      <span style={{ fontSize: 13, color: 'var(--down)', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                      <div style={{ fontSize: 10, color: 'var(--down)' }}>{Math.round(h.dailyPnl / 10000)}만원</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>

      {/* ── 시세 / 평가 탭 ────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-primary)', marginBottom: 0 }}>
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

      {/* ── 테이블 ────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
        {tab === '시세' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', fontSize: 12 }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 14px', width: 120, fontWeight: 500 }}></th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>현재가</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>전일대비</th>
                <SortTh label="등락률" k="daily_change" />
                <SortTh label="평가금액" k="market_value" />
                <SortTh label="일간 손익" k="daily_pnl" />
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>비중</th>
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
                      style={{
                        borderTop: '1px solid var(--bg-tertiary)',
                        background: isSelected ? 'var(--bg-tertiary)' : i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '4px 8px', width: 120 }}>
                        {!isLoading && <SparkLine ticker={h.ticker} />}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading ? <span style={{ color: 'var(--text-secondary)' }}>...</span> : nativePrice(h.ticker, h.current_price_krw, usdKrw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: pctColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading || krwChange === null ? '-' : nativeChange(h.ticker, krwChange, usdKrw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: pctColor, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading ? '-' : pct !== null ? fmtSign(pct) : '-'}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: holdingDailyPnl === null ? 'var(--text-secondary)' : holdingDailyPnl >= 0 ? 'var(--up)' : 'var(--down)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading || holdingDailyPnl === null ? '-'
                          : (holdingDailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(holdingDailyPnl))}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>
                    </tr>
                    {isSelected && (
                      <tr key={`${h.ticker}-chart`}>
                        <td colSpan={8} style={{ padding: 0 }}>
                          <ChartPanel ticker={h.ticker} name={h.name} />
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
                      style={{
                        borderTop: '1px solid var(--bg-tertiary)',
                        background: isSelected ? 'var(--bg-tertiary)' : i % 2 === 0 ? 'transparent' : 'var(--bg-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {h.shares.toLocaleString()}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.avg_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-primary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading ? <span style={{ color: 'var(--text-secondary)' }}>...</span> : fmtKrw(h.current_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {(h.profit_krw >= 0 ? '+' : '') + fmtKrw(h.profit_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtSign(h.profit_pct)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: irrColor, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isLoading ? '-' : holdingIrr !== null ? fmtSign(holdingIrr * 100) : '-'}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>
                    </tr>
                    {isSelected && (
                      <tr key={`${h.ticker}-chart`}>
                        <td colSpan={9} style={{ padding: 0 }}>
                          <ChartPanel ticker={h.ticker} name={h.name} />
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

    </div>
  );
}
