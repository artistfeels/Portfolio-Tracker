import React, { useState } from 'react';
import type { usePortfolio } from '../hooks/usePortfolio';
import ChartPanel from '../components/ChartPanel';

type PortfolioState = ReturnType<typeof usePortfolio>;

interface Props {
  portfolio: PortfolioState;
}

const fmtKrw = (n: number) => n.toLocaleString('ko-KR') + '원';
const fmtSign = (n: number, digits = 2) => (n >= 0 ? '+' : '') + n.toFixed(digits) + '%';

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
  if (/^\d{4}$/.test(ticker)) return sign + 'HK$' + (krwChange / usdKrw * 7.78).toFixed(2);
  return sign + '$' + (krwChange / usdKrw).toFixed(2);
}

export default function Dashboard({ portfolio }: Props) {
  const { holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload } = portfolio;
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tab, setTab] = useState<'시세' | '평가'>('시세');

  // Daily P&L
  const dailyPnl = holdings.reduce((sum, h) => {
    if (h.ticker === 'CASH' || h.prev_close_krw <= 0 || h.price_source === 'loading') return sum;
    return sum + (h.current_price_krw - h.prev_close_krw) * h.shares;
  }, 0);
  const prevDayTotal = holdings.reduce((sum, h) => {
    if (h.ticker === 'CASH' || h.prev_close_krw <= 0 || h.price_source === 'loading') return sum;
    return sum + h.prev_close_krw * h.shares;
  }, 0);
  const dailyPnlPct = prevDayTotal > 0 ? (dailyPnl / prevDayTotal) * 100 : null;
  const dailyColor = dailyPnl >= 0 ? '#cf222e' : '#1f6feb';
  const hasDailyData = prevDayTotal > 0;

  // Today's movers
  const withPnl = holdings
    .filter(h => h.ticker !== 'CASH' && h.daily_change_pct !== null && h.prev_close_krw > 0)
    .map(h => ({ ...h, dailyPnl: (h.current_price_krw - h.prev_close_krw) * h.shares }));
  const gainers = [...withPnl].filter(h => h.dailyPnl >= 0)
    .sort((a, b) => (b.daily_change_pct ?? 0) - (a.daily_change_pct ?? 0)).slice(0, 3);
  const losers = [...withPnl].filter(h => h.dailyPnl < 0)
    .sort((a, b) => (a.daily_change_pct ?? 0) - (b.daily_change_pct ?? 0)).slice(0, 3);
  const showMovers = withPnl.length >= 2;

  // Allocation bar
  const stockHoldings = holdings.filter(h => h.ticker !== 'CASH' && h.market_value_krw > 0);
  const totalStockVal = stockHoldings.reduce((s, h) => s + h.market_value_krw, 0);

  if (status === 'error') {
    return (
      <div style={{ padding: 48, color: '#cf222e' }}>
        <p style={{ marginBottom: 12 }}>오류: {error}</p>
        <button
          onClick={() => reload()}
          style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div style={{ padding: 48, color: '#8b949e', fontSize: 14 }}>
        포트폴리오 불러오는 중...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 48px', minWidth: 0 }}>

      {/* ── 헤더 ──────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, lineHeight: 1 }}>
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
              <span style={{ color: '#8b949e', fontSize: 13 }}>시세 로딩 중...</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: 12, color: '#8b949e', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRefreshing && (
              <span style={{ color: '#1f6feb', fontSize: 11 }}>● 업데이트 중</span>
            )}
            {lastUpdated && !isRefreshing && (
              <span>{timeSince(lastUpdated)} 업데이트</span>
            )}
            <button
              onClick={() => reload()}
              style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
            >
              새로고침
            </button>
          </div>
          {usdKrw > 0 && <div>USD/KRW {usdKrw.toLocaleString()}</div>}
        </div>
      </div>

      {/* ── 요약 카드 ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: '총 평가금액', value: fmtKrw(summary.totalValue), color: '#e6edf3' },
          {
            label: '일간 손익',
            value: hasDailyData ? (dailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(dailyPnl)) : '-',
            sub: hasDailyData && dailyPnlPct !== null ? fmtSign(dailyPnlPct) : undefined,
            color: hasDailyData ? dailyColor : '#8b949e',
          },
          {
            label: '누적 손익',
            value: (summary.totalProfit >= 0 ? '+' : '') + fmtKrw(summary.totalProfit),
            color: summary.totalProfit >= 0 ? '#cf222e' : '#1f6feb',
          },
          {
            label: '수익률',
            value: fmtSign(summary.profitPct),
            color: summary.profitPct >= 0 ? '#cf222e' : '#1f6feb',
          },
        ].map((c) => (
          <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: c.color }}>{c.value}</div>
            {'sub' in c && c.sub && (
              <div style={{ fontSize: 12, color: c.color, marginTop: 2 }}>{c.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── 포트폴리오 구성 바 ─────────────────────────── */}
      {totalStockVal > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: '#21262d', marginBottom: 6 }}>
            {stockHoldings.map(h => {
              const w = (h.market_value_krw / totalStockVal) * 100;
              const color = h.price_source === 'loading' ? '#30363d'
                : h.daily_change_pct === null ? '#30363d'
                : h.daily_change_pct >= 0 ? '#cf222e' : '#1f6feb';
              return (
                <div
                  key={h.ticker}
                  style={{ width: `${w}%`, background: color, transition: 'background 0.3s' }}
                  title={`${h.name}: ${w.toFixed(1)}%${h.daily_change_pct !== null ? ` (${fmtSign(h.daily_change_pct)})` : ''}`}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {stockHoldings.slice(0, 8).map(h => {
              const w = (h.market_value_krw / totalStockVal) * 100;
              const color = h.price_source === 'loading' ? '#8b949e'
                : h.daily_change_pct === null ? '#8b949e'
                : h.daily_change_pct >= 0 ? '#cf222e' : '#1f6feb';
              return (
                <div key={h.ticker} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#8b949e' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 1, background: color, flexShrink: 0 }} />
                  <span>{h.name.length > 6 ? h.name.slice(0, 6) : h.name}</span>
                  <span>{w.toFixed(1)}%</span>
                  {h.daily_change_pct !== null && (
                    <span style={{ color }}>{fmtSign(h.daily_change_pct, 1)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 오늘의 움직임 ──────────────────────────────── */}
      {showMovers && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {/* 상승 */}
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>상승 상위</div>
            {gainers.length === 0
              ? <div style={{ fontSize: 12, color: '#8b949e' }}>없음</div>
              : gainers.map(h => (
                <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{h.name.length > 10 ? h.name.slice(0, 10) : h.name}</span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 13, color: '#cf222e', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                    <span style={{ fontSize: 11, color: '#cf222e', marginLeft: 6 }}>+{fmtKrw(Math.round(h.dailyPnl))}</span>
                  </div>
                </div>
              ))
            }
          </div>
          {/* 하락 */}
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>하락 상위</div>
            {losers.length === 0
              ? <div style={{ fontSize: 12, color: '#8b949e' }}>없음</div>
              : losers.map(h => (
                <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{h.name.length > 10 ? h.name.slice(0, 10) : h.name}</span>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: 13, color: '#1f6feb', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                    <span style={{ fontSize: 11, color: '#1f6feb', marginLeft: 6 }}>{fmtKrw(Math.round(h.dailyPnl))}</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── 시세 / 평가 탭 ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 0, borderBottom: '1px solid #30363d' }}>
        {(['시세', '평가'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t ? '2px solid #1f6feb' : '2px solid transparent',
              color: tab === t ? '#e6edf3' : '#8b949e',
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
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderTop: 'none', borderRadius: '0 0 8px 8px', overflow: 'hidden' }}>
        {tab === '시세' ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#21262d', color: '#8b949e', fontSize: 11 }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>현재가</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>전일대비</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>등락률</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>평가금액</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>일간 손익</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>비중</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const isCash = h.ticker === 'CASH';
                const isLoading = h.price_source === 'loading';
                const pct = h.daily_change_pct;
                const pctColor = pct === null || isLoading ? '#8b949e' : pct >= 0 ? '#cf222e' : '#1f6feb';
                const krwChange = h.prev_close_krw > 0 ? h.current_price_krw - h.prev_close_krw : null;
                const holdingDailyPnl = h.prev_close_krw > 0 && !isCash
                  ? (h.current_price_krw - h.prev_close_krw) * h.shares
                  : null;
                const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
                const isSelected = selectedTicker === h.ticker;

                return (
                  <React.Fragment key={h.ticker}>
                    <tr
                      onClick={() => !isCash && setSelectedTicker(isSelected ? null : h.ticker)}
                      style={{
                        borderTop: '1px solid #21262d',
                        background: isSelected ? '#1c2128' : i % 2 === 0 ? 'transparent' : '#0d1117',
                        cursor: isCash ? 'default' : 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? fmtKrw(h.market_value_krw) : isLoading ? <span style={{ color: '#8b949e' }}>...</span> : nativePrice(h.ticker, h.current_price_krw, usdKrw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: pctColor, fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading || krwChange === null ? '-'
                          : nativeChange(h.ticker, krwChange, usdKrw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: pctColor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading ? '-'
                          : pct !== null ? fmtSign(pct) : '-'}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: holdingDailyPnl === null ? '#8b949e' : holdingDailyPnl >= 0 ? '#cf222e' : '#1f6feb', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading || holdingDailyPnl === null ? '-'
                          : (holdingDailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(holdingDailyPnl))}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>
                    </tr>
                    {isSelected && !isCash && (
                      <tr key={`${h.ticker}-chart`}>
                        <td colSpan={7} style={{ padding: 0 }}>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#21262d', color: '#8b949e', fontSize: 11 }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>수량</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>평균단가</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>현재가</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>평가금액</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>평가손익</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>수익률</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 500 }}>비중</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((h, i) => {
                const isCash = h.ticker === 'CASH';
                const isLoading = h.price_source === 'loading';
                const profitColor = h.profit_krw >= 0 ? '#cf222e' : '#1f6feb';
                const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
                const isSelected = selectedTicker === h.ticker;

                return (
                  <React.Fragment key={h.ticker}>
                    <tr
                      onClick={() => !isCash && setSelectedTicker(isSelected ? null : h.ticker)}
                      style={{
                        borderTop: '1px solid #21262d',
                        background: isSelected ? '#1c2128' : i % 2 === 0 ? 'transparent' : '#0d1117',
                        cursor: isCash ? 'default' : 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 16px' }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: '#8b949e', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : h.shares.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : fmtKrw(h.avg_price_krw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : isLoading ? <span style={{ color: '#8b949e' }}>...</span> : fmtKrw(h.current_price_krw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor, fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : (h.profit_krw >= 0 ? '+' : '') + fmtKrw(h.profit_krw)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor, fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : fmtSign(h.profit_pct)}
                      </td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                        {weight.toFixed(1)}%
                      </td>
                    </tr>
                    {isSelected && !isCash && (
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
        )}
      </div>
    </div>
  );
}
