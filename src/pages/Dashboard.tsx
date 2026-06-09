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
  if (/^\d{4}$/.test(ticker)) {
    const v = (krwChange / usdKrw * 7.78);
    return (v >= 0 ? '+' : '') + 'HK$' + Math.abs(v).toFixed(2);
  }
  const v = krwChange / usdKrw;
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(2);
}

export default function Dashboard({ portfolio }: Props) {
  const { holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload } = portfolio;
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [tab, setTab] = useState<'시세' | '평가'>('시세');

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
  const dailyColor = dailyPnl >= 0 ? '#cf222e' : '#1f6feb';
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
      color: '#cf222e',
    },
    {
      label: '해외 주식',
      value: holdings.filter(h => h.region === '해외' && h.ticker !== 'GOLD').reduce((s, h) => s + h.market_value_krw, 0),
      color: '#1f6feb',
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
              <span style={{ color: '#8b949e', fontSize: 13 }}>시세 로딩 중...</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: 12, color: '#8b949e', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRefreshing && <span style={{ color: '#1f6feb', fontSize: 11 }}>● 업데이트 중</span>}
            {lastUpdated && !isRefreshing && <span>{timeSince(lastUpdated)} 업데이트</span>}
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

      {/* ── 요약 카드 4개 ─────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
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
          <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 5 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: c.color, whiteSpace: 'nowrap' }}>{c.value}</div>
            {'sub' in c && c.sub && (
              <div style={{ fontSize: 12, color: c.color, marginTop: 2 }}>{c.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── 자산 구성 + 오늘의 움직임 ────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: showMovers ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 16 }}>

        {/* 자산 구성 */}
        {assetGroups.length > 0 && (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 10 }}>자산 구성</div>
            {assetGroups.map(g => {
              const pct = assetTotal > 0 ? g.value / assetTotal * 100 : 0;
              return (
                <div key={g.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                  <div style={{ width: 70, fontSize: 11, color: '#8b949e', flexShrink: 0, textAlign: 'right' }}>{g.label}</div>
                  <div style={{ flex: 1, height: 14, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: g.color, borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ width: 38, fontSize: 11, color: g.color, textAlign: 'right', flexShrink: 0 }}>{pct.toFixed(1)}%</div>
                  <div style={{ width: 100, fontSize: 11, color: '#e6edf3', textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
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
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>상승 상위</div>
              {gainers.length === 0
                ? <div style={{ fontSize: 12, color: '#8b949e' }}>없음</div>
                : gainers.map(h => (
                  <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{h.name}</span>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
                      <span style={{ fontSize: 13, color: '#cf222e', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                      <div style={{ fontSize: 10, color: '#cf222e' }}>+{Math.round(h.dailyPnl / 10000)}만원</div>
                    </div>
                  </div>
                ))
              }
            </div>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 8 }}>하락 상위</div>
              {losers.length === 0
                ? <div style={{ fontSize: 12, color: '#8b949e' }}>없음</div>
                : losers.map(h => (
                  <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>{h.name}</span>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
                      <span style={{ fontSize: 13, color: '#1f6feb', fontWeight: 600 }}>{fmtSign(h.daily_change_pct ?? 0, 2)}</span>
                      <div style={{ fontSize: 10, color: '#1f6feb' }}>{Math.round(h.dailyPnl / 10000)}만원</div>
                    </div>
                  </div>
                ))
              }
            </div>
          </div>
        )}
      </div>

      {/* ── 시세 / 평가 탭 ────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', marginBottom: 0 }}>
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
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>현재가</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>전일대비</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>등락률</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평가금액</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>일간 손익</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>비중</th>
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
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</div>
                        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? fmtKrw(h.market_value_krw) : isLoading ? <span style={{ color: '#8b949e' }}>...</span> : nativePrice(h.ticker, h.current_price_krw, usdKrw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: pctColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading || krwChange === null ? '-' : nativeChange(h.ticker, krwChange, usdKrw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: pctColor, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading ? '-' : pct !== null ? fmtSign(pct) : '-'}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: holdingDailyPnl === null ? '#8b949e' : holdingDailyPnl >= 0 ? '#cf222e' : '#1f6feb', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash || isLoading || holdingDailyPnl === null ? '-'
                          : (holdingDailyPnl >= 0 ? '+' : '') + fmtKrw(Math.round(holdingDailyPnl))}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
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
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>종목</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>수량</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평균단가</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>현재가</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평가금액</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>평가손익</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>수익률</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>비중</th>
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
                      <td style={{ padding: '9px 14px' }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</div>
                        <div style={{ fontSize: 10, color: '#8b949e', marginTop: 1 }}>{h.ticker}</div>
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : h.shares.toLocaleString()}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : fmtKrw(h.avg_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : '#e6edf3', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : isLoading ? <span style={{ color: '#8b949e' }}>...</span> : fmtKrw(h.current_price_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtKrw(h.market_value_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : (h.profit_krw >= 0 ? '+' : '') + fmtKrw(h.profit_krw)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {isCash ? '-' : fmtSign(h.profit_pct)}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
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
