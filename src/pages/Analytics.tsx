// src/pages/Analytics.tsx
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useAnalytics } from '../hooks/useAnalytics';
import type { HistoryPoint } from '../lib/types';

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}
function fmtPct(n: number | null): string {
  if (n === null) return '-';
  const sign = n >= 0 ? '+' : '';
  return sign + (n * 100).toFixed(2) + '%';
}

function LineChart({ data, color, label }: {
  data: { time: string; value: number }[];
  color: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 220,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
    });
    const series = chart.addSeries(LineSeries, { color, lineWidth: 2 });
    series.setData(data);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { chart.remove(); ro.disconnect(); };
  }, [data, color]);

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>{label}</div>
      {data.length === 0
        ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>데이터 없음</div>
        : <div ref={ref} />}
    </div>
  );
}

export default function Analytics() {
  const { status, history, summary, holdingIrrs, error } = useAnalytics();

  if (status === 'error') return <div style={{ padding: 32, color: '#cf222e' }}>오류: {error}</div>;
  if (status === 'loading' || status === 'idle') {
    return <div style={{ padding: 32, color: '#8b949e' }}>애널리틱스 데이터 로딩 중... (Yahoo Finance 과거 시세 fetch)</div>;
  }

  const valueData = history.map((p: HistoryPoint) => ({ time: p.date as `${number}-${number}-${number}`, value: p.value_krw }));
  const returnData = history.map((p: HistoryPoint) => ({
    time: p.date as `${number}-${number}-${number}`,
    value: p.invested_krw > 0 ? ((p.value_krw - p.invested_krw) / p.invested_krw) * 100 : 0,
  }));

  const cards = [
    { label: '포트폴리오 IRR', value: fmtPct(summary.portfolioIrr), positive: (summary.portfolioIrr ?? 0) >= 0 },
    { label: '연환산 수익률', value: fmtPct(summary.annualReturn), positive: (summary.annualReturn ?? 0) >= 0 },
    { label: 'MDD', value: fmtPct(summary.mdd), positive: false },
    { label: '보유 기간', value: `${summary.holdingYears}년`, positive: true },
  ];

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>애널리틱스</div>

      {/* 상단 지표 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.label === 'MDD' ? '#1f6feb' : (c.positive ? '#cf222e' : '#1f6feb') }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* 차트 2열 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <LineChart data={valueData} color="#58a6ff" label="자산 총액 추이 (KRW)" />
        <LineChart data={returnData} color="#3fb950" label="수익률 % 추이" />
      </div>

      {/* 종목별 IRR 테이블 */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', fontSize: 13, fontWeight: 600 }}>종목별 IRR</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#21262d', color: '#8b949e' }}>
              {['종목명', '티커', '최초 매수', '투자 원금', '현재 평가', 'IRR'].map((h) => (
                <th key={h} style={{ padding: '8px 14px', textAlign: h === 'IRR' || h === '투자 원금' || h === '현재 평가' ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdingIrrs
              .sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity))
              .map((r, i) => {
                const irrColor = r.irr === null ? '#8b949e' : r.irr >= 0 ? '#cf222e' : '#1f6feb';
                return (
                  <tr key={r.ticker} style={{ borderTop: '1px solid #21262d', background: i % 2 === 0 ? 'transparent' : '#0d1117' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 14px', color: '#8b949e', fontSize: 11 }}>{r.ticker}</td>
                    <td style={{ padding: '8px 14px', color: '#8b949e' }}>{r.first_date}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{fmt(r.invested_krw)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{fmt(r.current_value_krw)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: irrColor }}>
                      {r.irr === null ? '-' : fmtPct(r.irr)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
