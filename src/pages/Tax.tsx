import { useMemo, useState } from 'react';
import type { Transaction, HoldingWithPrice } from '../lib/types';

interface Props {
  transactions: Transaction[];
  holdings: HoldingWithPrice[];
  isMobile?: boolean;
}

interface YearRow {
  year: string;
  gains_krw: number;
  losses_krw: number;
  net_krw: number;
  deduction_krw: number;
  taxable_krw: number;
  tax_krw: number;
  trades: number;
}

const DEDUCTION = 2_500_000;
const TAX_RATE = 0.22;

function calcRealizedByYear(txs: Transaction[]): YearRow[] {
  const sorted = [...txs].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const basis: Record<string, { shares: number; avgCost: number }> = {};
  const byYear: Record<string, { gains: number; losses: number; trades: number }> = {};

  for (const tx of sorted) {
    if (tx.action === 'buy') {
      const b = basis[tx.ticker] ?? { shares: 0, avgCost: 0 };
      const totalCost = b.shares * b.avgCost + tx.shares * tx.price_krw;
      b.shares += tx.shares;
      b.avgCost = b.shares > 0 ? totalCost / b.shares : 0;
      basis[tx.ticker] = b;
    } else if (tx.action === 'sell' && tx.region === '해외') {
      const b = basis[tx.ticker] ?? { shares: 0, avgCost: 0 };
      const gain = (tx.price_krw - b.avgCost) * tx.shares;
      const year = tx.trade_date.slice(0, 4);
      const y = byYear[year] ?? { gains: 0, losses: 0, trades: 0 };
      if (gain >= 0) y.gains += gain; else y.losses += gain;
      y.trades += 1;
      byYear[year] = y;
      b.shares = Math.max(0, b.shares - tx.shares);
      if (b.shares === 0) b.avgCost = 0;
      basis[tx.ticker] = b;
    } else if (tx.action === 'split' && basis[tx.ticker]) {
      const b = basis[tx.ticker];
      const totalShares = b.shares + tx.shares;
      b.avgCost = totalShares > 0 ? (b.avgCost * b.shares) / totalShares : 0;
      b.shares = totalShares;
    }
  }

  return Object.entries(byYear)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, { gains, losses, trades }]) => {
      const net = gains + losses;
      const taxable = Math.max(0, net - DEDUCTION);
      return {
        year,
        gains_krw: gains,
        losses_krw: losses,
        net_krw: net,
        deduction_krw: Math.min(DEDUCTION, Math.max(0, net)),
        taxable_krw: taxable,
        tax_krw: Math.round(taxable * TAX_RATE),
        trades,
      };
    });
}

function fmtW(n: number) {
  return Math.abs(n) >= 10_000_000
    ? (n / 10_000_000).toFixed(1) + '천만'
    : Math.abs(n) >= 10_000
    ? (n / 10_000).toFixed(0) + '만'
    : n.toLocaleString('ko-KR');
}

function fmtKrw(n: number) {
  return (n < 0 ? '-' : '') + '₩' + Math.abs(n).toLocaleString('ko-KR');
}

const UP = 'var(--up)';
const DOWN = 'var(--down)';

export default function Tax({ transactions, holdings, isMobile }: Props) {
  const [tab, setTab] = useState<'realized' | 'harvest'>('realized');
  const rows = useMemo(() => calcRealizedByYear(transactions), [transactions]);
  const thisYear = String(new Date().getFullYear());

  const currentYearRow = rows.find(r => r.year === thisYear);

  // 손실수확 후보: 해외 보유종목 중 미실현 손실
  const harvestCandidates = useMemo(
    () =>
      holdings
        .filter(h => h.ticker !== 'CASH' && h.region === '해외' && h.profit_krw < 0)
        .sort((a, b) => a.profit_krw - b.profit_krw),
    [holdings]
  );

  const pd = isMobile ? '16px 12px' : '24px 32px';

  const thStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontWeight: 600, fontSize: 11,
    color: 'var(--text-secondary)', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border-primary)',
  };
  const tdStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontSize: isMobile ? 12 : 13,
    color: 'var(--text-primary)', whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    borderBottom: '1px solid var(--border-primary)',
  };

  return (
    <div style={{ padding: pd, maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px' }}>세금 분석</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
          해외 주식 양도소득세 (연간 실현손익 - 250만원 공제 × 22%)
        </p>
      </div>

      {/* 안내 카드 */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
        borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>기본공제</div>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700 }}>연 250만원</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>세율</div>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700 }}>22%</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>지방소득세 포함</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>신고 시기</div>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700 }}>다음해 5월</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>종합소득세 신고 기간</div>
        </div>
      </div>

      {/* 올해 예상 세액 (있을 때만) */}
      {currentYearRow && (
        <div style={{
          background: currentYearRow.tax_krw > 0 ? 'rgba(207,34,46,0.08)' : 'var(--bg-card)',
          border: `1px solid ${currentYearRow.tax_krw > 0 ? UP : 'var(--border-primary)'}`,
          borderRadius: 10, padding: '14px 18px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {thisYear}년 현재까지 실현 손익
          </div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>순 실현손익</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: currentYearRow.net_krw >= 0 ? UP : DOWN }}>
                {fmtKrw(Math.round(currentYearRow.net_krw))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>공제 후 과세표준</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {fmtKrw(Math.round(currentYearRow.taxable_krw))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>예상 납부 세액</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: currentYearRow.tax_krw > 0 ? UP : 'var(--text-primary)' }}>
                {fmtKrw(currentYearRow.tax_krw)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['realized', 'harvest'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--border-primary)',
            background: tab === t ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: tab === t ? '#fff' : 'var(--text-secondary)',
          }}>
            {t === 'realized' ? '연도별 실현 손익' : `손실수확 후보 (${harvestCandidates.length})`}
          </button>
        ))}
      </div>

      {tab === 'realized' && (
        rows.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            해외 주식 매도 내역이 없습니다.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>연도</th>
                  <th style={thStyle}>총 매도익</th>
                  <th style={thStyle}>총 매도손</th>
                  <th style={thStyle}>순 손익</th>
                  <th style={thStyle}>기본공제</th>
                  <th style={thStyle}>과세표준</th>
                  <th style={thStyle}>예상 세액(22%)</th>
                  <th style={thStyle}>거래수</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.year} style={{ background: r.year === thisYear ? 'rgba(255,255,255,0.03)' : undefined }}>
                    <td style={{ ...tdStyle, textAlign: 'left', fontWeight: r.year === thisYear ? 700 : 400, color: r.year === thisYear ? 'var(--accent)' : undefined }}>
                      {r.year}{r.year === thisYear ? ' (진행 중)' : ''}
                    </td>
                    <td style={{ ...tdStyle, color: UP }}>+{fmtW(Math.round(r.gains_krw))}</td>
                    <td style={{ ...tdStyle, color: DOWN }}>{fmtW(Math.round(r.losses_krw))}</td>
                    <td style={{ ...tdStyle, color: r.net_krw >= 0 ? UP : DOWN, fontWeight: 600 }}>
                      {r.net_krw >= 0 ? '+' : ''}{fmtW(Math.round(r.net_krw))}
                    </td>
                    <td style={tdStyle}>{r.deduction_krw > 0 ? '-' + fmtW(Math.round(r.deduction_krw)) : '-'}</td>
                    <td style={tdStyle}>{r.taxable_krw > 0 ? fmtW(Math.round(r.taxable_krw)) : '-'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: r.tax_krw > 0 ? UP : 'var(--text-muted)' }}>
                      {r.tax_krw > 0 ? fmtKrw(r.tax_krw) : '없음'}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{r.trades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              * 해외 주식 양도소득만 집계. 국내 주식(ETF 포함)은 별도 과세 체계 적용. 실제 납부세액은 전문 세무사 확인 필요.
            </div>
          </div>
        )
      )}

      {tab === 'harvest' && (
        harvestCandidates.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            현재 미실현 손실 해외 종목이 없습니다.
          </div>
        ) : (
          <div>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 12,
              color: 'var(--text-secondary)',
            }}>
              아래 종목을 매도하면 {thisYear}년 양도차익과 손익통산 가능 (이월 불가, 해당 연도 내 결제일 기준)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left' }}>종목</th>
                    <th style={thStyle}>평가손실</th>
                    <th style={thStyle}>수익률</th>
                    {!isMobile && <th style={thStyle}>평가금액</th>}
                    {!isMobile && <th style={thStyle}>절감 예상 세액</th>}
                  </tr>
                </thead>
                <tbody>
                  {harvestCandidates.map(h => {
                    const loss = h.profit_krw;
                    const currentYearNet = (currentYearRow?.net_krw ?? 0);
                    const afterOffset = Math.max(0, currentYearNet + loss - DEDUCTION);
                    const currentTax = currentYearRow?.tax_krw ?? 0;
                    const newTax = Math.round(afterOffset * TAX_RATE);
                    const saving = currentTax - newTax;
                    return (
                      <tr key={h.ticker}>
                        <td style={{ ...tdStyle, textAlign: 'left' }}>
                          <div style={{ fontWeight: 600 }}>{h.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.ticker}</div>
                        </td>
                        <td style={{ ...tdStyle, color: DOWN, fontWeight: 600 }}>
                          {fmtKrw(Math.round(loss))}
                        </td>
                        <td style={{ ...tdStyle, color: DOWN }}>
                          {h.profit_pct.toFixed(2)}%
                        </td>
                        {!isMobile && <td style={tdStyle}>{fmtKrw(h.market_value_krw)}</td>}
                        {!isMobile && (
                          <td style={{ ...tdStyle, color: saving > 0 ? DOWN : 'var(--text-muted)', fontWeight: saving > 0 ? 700 : 400 }}>
                            {saving > 0 ? '-' + fmtKrw(saving) : '-'}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
              * 손실수확 후 30일 내 동일 종목 재매수 시 wash-sale rule 미적용 (한국 세법). 단, 매매비용 고려 필요.
            </div>
          </div>
        )
      )}
    </div>
  );
}
