import { useState } from 'react';
import { usePortfolio } from '../hooks/usePortfolio';
import ChartPanel from '../components/ChartPanel';

const fmt = (n: number) =>
  n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';

const fmtPct = (n: number) => {
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
};

export default function Dashboard() {
  const { holdings, summary, usdKrw, status, progress, error, reload } = usePortfolio();
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  if (status === 'error') {
    return (
      <div style={{ padding: 32, color: '#cf222e' }}>
        <p>오류: {error}</p>
        <button onClick={reload}>다시 시도</button>
      </div>
    );
  }

  if (status === 'loading-db') {
    return <div style={{ padding: 32, color: '#8b949e' }}>거래내역 로딩 중...</div>;
  }

  if (status === 'loading-prices') {
    return (
      <div style={{ padding: 32, color: '#8b949e' }}>
        시세 가져오는 중... {progress.done}/{progress.total}
        <div style={{ marginTop: 8, background: '#21262d', borderRadius: 4, height: 8, width: 300 }}>
          <div
            style={{
              background: '#1f6feb',
              height: 8,
              borderRadius: 4,
              width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Portfolio Tracker</h1>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ color: '#8b949e', fontSize: 13 }}>USD/KRW {usdKrw.toLocaleString()}</span>
          <button
            onClick={reload}
            style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
          >
            새로고침
          </button>
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
        {[
          { label: '총 평가금액', value: fmt(summary.totalValue), color: '#e6edf3' },
          { label: '총 매입금액', value: fmt(summary.totalPrincipal), color: '#e6edf3' },
          { label: '평가 손익', value: fmt(summary.totalProfit), color: summary.totalProfit >= 0 ? '#cf222e' : '#1f6feb' },
          { label: '수익률', value: fmtPct(summary.profitPct), color: summary.profitPct >= 0 ? '#cf222e' : '#1f6feb' },
        ].map((c) => (
          <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* 보유종목 테이블 */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#21262d', color: '#8b949e' }}>
              {['종목', '보유수량', '평균단가', '현재가', '평가금액', '손익', '수익률', '비중', '소스'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, whiteSpace: 'nowrap' }}>
                  {h === '종목' ? <span style={{ textAlign: 'left', display: 'block' }}>{h}</span> : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdings.map((h, i) => {
              const isCash = h.ticker === 'CASH';
              const profitColor = h.profit_krw >= 0 ? '#cf222e' : '#1f6feb';
              const weight = summary.totalValue > 0 ? (h.market_value_krw / summary.totalValue) * 100 : 0;
              return (
                <>
                  <tr
                    key={h.ticker}
                    onClick={() => !isCash && setSelectedTicker(selectedTicker === h.ticker ? null : h.ticker)}
                    style={{
                      borderTop: '1px solid #21262d',
                      background: selectedTicker === h.ticker ? '#1c2128' : (i % 2 === 0 ? 'transparent' : '#0d1117'),
                      cursor: isCash ? 'default' : 'pointer',
                    }}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
                      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{h.ticker}</div>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: isCash ? '#8b949e' : undefined }}>
                      {isCash ? '-' : h.shares.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: isCash ? '#8b949e' : undefined }}>
                      {isCash ? '-' : h.avg_price_krw.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: isCash ? '#8b949e' : undefined }}>
                      {isCash ? '-' : h.current_price_krw.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{fmt(h.market_value_krw)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor }}>
                      {isCash ? '-' : fmt(h.profit_krw)}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: isCash ? '#8b949e' : profitColor }}>
                      {isCash ? '-' : fmtPct(h.profit_pct)}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{weight.toFixed(1)}%</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#8b949e', fontSize: 11 }}>{h.price_source}</td>
                  </tr>
                  {selectedTicker === h.ticker && !isCash && (
                    <tr key={`${h.ticker}-chart`}>
                      <td colSpan={9} style={{ padding: 0 }}>
                        <ChartPanel ticker={h.ticker} name={h.name} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
