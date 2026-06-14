// src/pages/Analytics.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useAnalytics } from '../hooks/useAnalytics';
import type { usePortfolio } from '../hooks/usePortfolio';
import { calcPortfolioIrr, type RiskRatiosDetailed } from '../lib/calc';

type PortfolioState = ReturnType<typeof usePortfolio>;

// lightweight-charts는 CSS 변수를 해석 못하므로 실제 값으로 변환
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// 같은 날짜 중복 제거 + 오름차순 정렬. lightweight-charts.setData는 시간이
// 오름차순·유일하지 않으면 throw하므로 차트 입력 전 반드시 통과시킨다.
function dedupeSorted(data: { date: string; value: number }[]): { date: string; value: number }[] {
  const seen = new Set<string>();
  return [...data]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter(d => { if (seen.has(d.date)) return false; seen.add(d.date); return true; });
}

// ResizeObserver → applyOptions 피드백 루프를 차단한다.
// - 콜백을 requestAnimationFrame으로 합쳐 "ResizeObserver loop" 폭주를 방지
// - 폭(width)이 실제로 바뀐 경우에만 적용, 0이면 무시
function observeWidth(el: HTMLElement, apply: (w: number) => void): { disconnect: () => void } {
  let last = -1;
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const w = el.clientWidth;
      if (w > 0 && w !== last) { last = w; apply(w); }
    });
  });
  ro.observe(el);
  return { disconnect: () => { if (raf) cancelAnimationFrame(raf); ro.disconnect(); } };
}

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}
function fmtPct(n: number | null, decimals = 2): string {
  if (n === null) return '-';
  const sign = n >= 0 ? '+' : '';
  return sign + (n * 100).toFixed(decimals) + '%';
}
function fmtRatio(n: number | null, digits = 2): string {
  if (n === null) return '-';
  return n.toFixed(digits);
}

// ── 기간 필터 ────────────────────────────────────────────────────────
type PeriodKey = '30d' | '3mo' | '6mo' | '1yr' | 'all';
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '30d', label: '30일',  days: 30  },
  { key: '3mo', label: '3개월', days: 90  },
  { key: '6mo', label: '6개월', days: 180 },
  { key: '1yr', label: '1년',   days: 365 },
  { key: 'all', label: '전체',  days: null },
];
const PERIOD_STORAGE_KEY = 'portfolio_analytics_period';

// ── 분석 로더 (Apple-style) ─────────────────────────────────────────
const ANALYSIS_STEPS = [
  '거래 내역 확인',
  '월간 시세 수집',
  '수익률 계산',
  '리스크 지표 산출',
  '차트 생성',
];
const STEP_DELAYS = [0, 800, 2400, 2900, 3500];

function AnalysisLoader() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timers = STEP_DELAYS.slice(1).map((delay, i) =>
      setTimeout(() => setStep(i + 1), delay)
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  // 신경망 노드 위치 (컨테이너 기준 절대 좌표 %)
  const NODES = [
    { top: '12%', left: '8%',  nx: '8px',  ny: '-10px', delay: '0s',    color: '#a78bfa' },
    { top: '8%',  left: '72%', nx: '-6px', ny: '-8px',  delay: '0.7s',  color: '#38bdf8' },
    { top: '55%', left: '4%',  nx: '10px', ny: '6px',   delay: '1.2s',  color: '#34d399' },
    { top: '62%', left: '86%', nx: '-8px', ny: '10px',  delay: '0.4s',  color: '#f472b6' },
    { top: '80%', left: '22%', nx: '6px',  ny: '8px',   delay: '1.8s',  color: '#fbbf24' },
    { top: '78%', left: '68%', nx: '-10px',ny: '-6px',  delay: '0.9s',  color: '#60a5fa' },
    { top: '28%', left: '90%', nx: '-8px', ny: '8px',   delay: '1.5s',  color: '#c084fc' },
    { top: '42%', left: '2%',  nx: '8px',  ny: '-8px',  delay: '2.1s',  color: '#4ade80' },
  ];

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderRadius: 20, marginBottom: 24,
      background: 'var(--bg-card)',
      minHeight: 420,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      border: '1px solid var(--border-primary)',
      animation: 'fadeSlideIn 0.4s ease',
    }}>
      {/* 배경 오로라 오브 */}
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      <div className="aurora-orb aurora-orb-3" />
      <div className="aurora-orb aurora-orb-4" />
      <div className="aurora-orb aurora-orb-5" />

      {/* 신경망 노드 */}
      {NODES.map((n, i) => (
        <div
          key={i}
          className="energy-node"
          style={{
            top: n.top, left: n.left,
            background: n.color,
            boxShadow: `0 0 8px ${n.color}, 0 0 20px ${n.color}66`,
            animationDelay: n.delay,
            '--nx': n.nx, '--ny': n.ny,
          } as React.CSSProperties}
        />
      ))}

      {/* 노드 연결선 SVG */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
        <line x1="8%" y1="12%" x2="50%" y2="50%" stroke="rgba(167,139,250,0.18)" strokeWidth="1" />
        <line x1="72%" y1="8%" x2="50%" y2="50%" stroke="rgba(56,189,248,0.18)" strokeWidth="1" />
        <line x1="4%" y1="55%" x2="50%" y2="50%" stroke="rgba(52,211,153,0.18)" strokeWidth="1" />
        <line x1="86%" y1="62%" x2="50%" y2="50%" stroke="rgba(244,114,182,0.18)" strokeWidth="1" />
        <line x1="22%" y1="80%" x2="50%" y2="50%" stroke="rgba(251,191,36,0.18)" strokeWidth="1" />
        <line x1="68%" y1="78%" x2="50%" y2="50%" stroke="rgba(96,165,250,0.18)" strokeWidth="1" />
        <line x1="90%" y1="28%" x2="50%" y2="50%" stroke="rgba(192,132,252,0.15)" strokeWidth="1" />
        <line x1="2%" y1="42%" x2="50%" y2="50%" stroke="rgba(74,222,128,0.15)" strokeWidth="1" />
      </svg>

      {/* 메인 콘텐츠 */}
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 48px' }}>

        {/* 에너지 링 어셈블리 */}
        <div style={{ position: 'relative', width: 120, height: 120, marginBottom: 40 }}>
          <div className="energy-ring energy-ring-outer" />
          <div className="energy-ring energy-ring-mid" />
          <div className="energy-orb" />
        </div>

        {/* 그라디언트 타이틀 */}
        <div style={{
          fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', marginBottom: 8,
          background: 'linear-gradient(120deg, #a78bfa 0%, #38bdf8 50%, #34d399 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          포트폴리오 분석 중
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 44, lineHeight: 1.7 }}>
          월간 시세 · 리스크 지표 · 벤치마크를 수집합니다
        </div>

        {/* 단계 표시 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 248, textAlign: 'left' }}>
          {ANALYSIS_STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                opacity: i <= step ? 1 : 0.3,
                transition: 'opacity 0.6s ease',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? 'linear-gradient(135deg, #a78bfa, #38bdf8)' : 'transparent',
                  border: done ? 'none' : `1.5px solid ${active ? '#a78bfa' : 'var(--border-primary)'}`,
                  boxShadow: done ? '0 0 14px rgba(167,139,250,0.55)' : active ? '0 0 8px rgba(167,139,250,0.3)' : 'none',
                  transition: 'all 0.45s ease',
                }}>
                  {done && <span style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>✓</span>}
                  {active && (
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: '#a78bfa',
                      boxShadow: '0 0 8px #a78bfa',
                      animation: 'pulse 1.1s ease-in-out infinite',
                    }} />
                  )}
                </div>
                <span style={{
                  fontSize: 13,
                  color: i <= step ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: active ? 500 : 400,
                  transition: 'color 0.5s ease',
                }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 차트 로딩 스켈레톤 ──────────────────────────────────────────────

// ── 공통 차트 옵션 ──────────────────────────────────────────────────
function chartOptions(height: number) {
  return {
    height,
    layout: { background: { color: cssVar('--bg-primary', '#0d1117') }, textColor: cssVar('--text-secondary', '#8b949e') },
    grid: { vertLines: { color: cssVar('--bg-tertiary', '#21262d') }, horzLines: { color: cssVar('--bg-tertiary', '#21262d') } },
    timeScale: {
      borderColor: cssVar('--border-primary', '#30363d'),
      lockVisibleTimeRangeOnResize: false,
    },
    rightPriceScale: { borderColor: cssVar('--border-primary', '#30363d') },
    crosshair: { mode: 1 },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
  } as const;
}

// ── 자산 총액 + 원금 차트 ───────────────────────────────────────────
function AssetChart({ valueData, principalData }: {
  valueData: { date: string; value: number }[];
  principalData: { date: string; value: number }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || valueData.length === 0) return;
    const el = ref.current;
    const chart = createChart(el, { width: el.clientWidth || 600, ...chartOptions(220) });
    const toTime = (d: { date: string; value: number }) => ({ time: d.date as `${number}-${number}-${number}`, value: d.value });
    const valueSeries = chart.addSeries(LineSeries, { color: cssVar('--accent', '#58a6ff'), lineWidth: 2, title: '' });
    valueSeries.setData(dedupeSorted(valueData).map(toTime));
    if (principalData.length > 0) {
      const principalSeries = chart.addSeries(LineSeries, { color: cssVar('--text-muted', '#6e7681'), lineWidth: 1, lineStyle: 2, title: '' });
      principalSeries.setData(dedupeSorted(principalData).map(toTime));
    }
    chart.timeScale().fitContent();
    const ro = observeWidth(el, (w) => chart.applyOptions({ width: w }));
    return () => { ro.disconnect(); chart.remove(); };
  }, [valueData, principalData]);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>자산 총액 추이 (KRW)</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ width: 14, height: 2, background: cssVar('--accent', '#58a6ff'), display: 'inline-block' }} />평가금액
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            <span style={{ width: 14, height: 2, background: cssVar('--text-muted', '#6e7681'), display: 'inline-block', opacity: 0.7 }} />투자원금
          </div>
        </div>
      </div>
      {valueData.length === 0
        ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>데이터 없음</div>
        : <div ref={ref} style={{ height: 220, width: '100%' }} />}
    </div>
  );
}

// ── 벤치마크 비교 차트 (멀티라인) ──────────────────────────────────
type SeriesDef = { data: { date: string; value: number }[]; color: string; label: string };

function BenchmarkChart({ series }: { series: SeriesDef[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const hasData = series.some(s => s.data.length > 0);

  useEffect(() => {
    if (!ref.current || !hasData) return;
    const el = ref.current;
    const chart = createChart(el, { width: el.clientWidth || 600, ...chartOptions(280) });
    for (const s of series) {
      if (s.data.length === 0) continue;
      // title: '' — price axis label 제거 (legend는 상단에 별도 표시)
      const line = chart.addSeries(LineSeries, { color: s.color, lineWidth: 2, title: '' });
      line.setData(dedupeSorted(s.data).map(d => ({ time: d.date as `${number}-${number}-${number}`, value: d.value })));
    }
    chart.timeScale().fitContent();
    const ro = observeWidth(el, (w) => chart.applyOptions({ width: w }));
    return () => { ro.disconnect(); chart.remove(); };
  }, [series, hasData]);

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>벤치마크 비교 (시작=100, TWR — 현금유출입 제거)</div>
        <div style={{ display: 'flex', gap: 16 }}>
          {series.map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
              <span style={{ width: 18, height: 2, background: s.color, display: 'inline-block', borderRadius: 1 }} />
              {s.label}
            </div>
          ))}
        </div>
      </div>
      {!hasData
        ? <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>데이터 없음</div>
        : <div ref={ref} style={{ height: 280, width: '100%' }} />}
    </div>
  );
}

// ── 리스크 지표 계산 과정 패널 ──────────────────────────────────────
type RiskKey = 'sharpe' | 'sortino' | 'treynor' | 'beta';

function RiskDetailPanel({ type, d }: { type: RiskKey; d: RiskRatiosDetailed }) {
  const p  = (v: number) => (v * 100).toFixed(2) + '%';
  const r  = (v: number) => v.toFixed(4);

  if (type === 'sharpe') return (
    <div style={detailStyle}>
      <div style={detailTitle}>샤프 비율 계산 과정</div>
      <code style={detailCode}>
        샤프 = (R_p − R_f) / σ_p{'\n'}
        {'\n'}
        R_p  = {p(d.R_p_ann)}  (기하평균 연환산 — 최근 1년 TWR, 현금유출입 조정){'\n'}
        R_f  = {p(d.rfAnnual)}  (SOFR 기간평균, 연간){'\n'}
        σ_p  = {p(d.sigma_p_ann)}  (월간 표준편차 × √12, 표본분산){'\n'}
        n    = {d.n}개월{'\n'}
        {'\n'}
        초과수익  = {p(d.R_p_ann)} − {p(d.rfAnnual)} = {p(d.R_p_ann - d.rfAnnual)}{'\n'}
        샤프     = {p(d.R_p_ann - d.rfAnnual)} / {p(d.sigma_p_ann)} = {fmtRatio(d.sharpe)}
      </code>
      <div style={detailNote}>1 이상이면 위험 대비 초과수익 양호. 시장 평균(S&P500)은 장기 약 0.5~0.7.</div>
    </div>
  );

  if (type === 'sortino') return (
    <div style={detailStyle}>
      <div style={detailTitle}>소르티노 비율 계산 과정</div>
      <code style={detailCode}>
        소르티노 = (R_p − R_f) / σ_d{'\n'}
        {'\n'}
        R_p  = {p(d.R_p_ann)}{'\n'}
        R_f  = {p(d.rfAnnual)}{'\n'}
        σ_d  = {p(d.sigma_d_ann)}  (하방 편차만 계산 — 무위험수익률 하회 구간만 포함){'\n'}
        n    = {d.n}개월{'\n'}
        {'\n'}
        초과수익  = {p(d.R_p_ann - d.rfAnnual)}{'\n'}
        소르티노 = {p(d.R_p_ann - d.rfAnnual)} / {p(d.sigma_d_ann)} = {fmtRatio(d.sortino)}
      </code>
      <div style={detailNote}>
        샤프({fmtRatio(d.sharpe)}) vs 소르티노({fmtRatio(d.sortino)}): 소르티노가 더 높으면 변동성이 주로 상방으로 발생한다는 의미.
        하방 변동성만 페널티로 보기 때문에 샤프보다 직관적인 경우가 많음.
      </div>
    </div>
  );

  if (type === 'treynor') return (
    <div style={detailStyle}>
      <div style={detailTitle}>트레이너 비율 계산 과정</div>
      <code style={detailCode}>
        트레이너 = (R_p − R_f) / β{'\n'}
        {'\n'}
        R_p  = {p(d.R_p_ann)}{'\n'}
        R_f  = {p(d.rfAnnual)}{'\n'}
        β    = {r(d.beta ?? 0)}  (포트폴리오와 S&P500의 공분산 / S&P500 분산){'\n'}
        R_m  = {p(d.R_m_ann)}  (S&P500 연환산 수익률, 참고용){'\n'}
        n    = {d.n}개월{'\n'}
        {'\n'}
        초과수익   = {p(d.R_p_ann - d.rfAnnual)}{'\n'}
        트레이너  = {p(d.R_p_ann - d.rfAnnual)} / {r(d.beta ?? 0)} = {fmtRatio(d.treynor)}
      </code>
      <div style={detailNote}>β 1단위 시장위험 당 초과수익. 여러 포트폴리오 비교에 유용하지만 β가 낮은(금·현금 비중 높은) 포트폴리오에선 왜곡될 수 있음.</div>
    </div>
  );

  // beta
  return (
    <div style={detailStyle}>
      <div style={detailTitle}>베타(β) 계산 과정</div>
      <code style={detailCode}>
        β = Cov(R_p, R_m) / Var(R_m){'\n'}
        {'\n'}
        벤치마크: S&P500 월간 수익률{'\n'}
        기간    : {d.n}개월{'\n'}
        R_p_ann = {p(d.R_p_ann)}{'\n'}
        R_m_ann = {p(d.R_m_ann)}{'\n'}
        β       = {r(d.beta ?? 0)}
      </code>
      <div style={detailNote}>
        β=1: 시장과 동일 움직임. β{'<'}1: 방어적(금·현금·저변동). β{'>'}1: 공격적(성장주).
        ETF·금·현금 비중이 높으면 β가 낮게 나오는 것이 정상.
      </div>
    </div>
  );
}

const detailStyle: React.CSSProperties = {
  marginTop: 12, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
  borderRadius: 6, padding: '14px 18px',
};
const detailTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10,
};
const detailCode: React.CSSProperties = {
  display: 'block', fontFamily: 'ui-monospace, Consolas, monospace',
  fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.8,
  whiteSpace: 'pre', overflowX: 'auto', background: 'transparent',
};
const detailNote: React.CSSProperties = {
  marginTop: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6,
};

// ── 메인 컴포넌트 ───────────────────────────────────────────────────
export default function Analytics({ portfolio, isMobile = false }: { portfolio: PortfolioState; isMobile?: boolean }) {
  const { transactions, holdings, usdKrw, status: portfolioStatus, error: portfolioError } = portfolio;
  const { summary, holdingIrrs, chartStatus, history, riskDetail, benchmarkData, loadCharts } =
    useAnalytics(transactions, holdings, usdKrw);
  const [period, setPeriod] = useState<PeriodKey>(
    () => (localStorage.getItem(PERIOD_STORAGE_KEY) as PeriodKey | null) ?? 'all'
  );
  const [expandedRisk, setExpandedRisk] = useState<RiskKey | null>(null);
  const [expandedIrr, setExpandedIrr] = useState(false);
  const [excludedTickers, setExcludedTickers] = useState<Set<string>>(new Set());
  const [expandedMdd, setExpandedMdd] = useState(false);
  const [expandedCagr, setExpandedCagr] = useState(false);
  const [cagrYears, setCagrYears] = useState(3);
  const [expandedAlpha, setExpandedAlpha] = useState(false);
  const [expandedExpected, setExpandedExpected] = useState(false);
  const [expandedIrrContrib, setExpandedIrrContrib] = useState(false);
  const [benchmarkStart, setBenchmarkStart] = useState<string>('');
  const benchmarkInitRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(PERIOD_STORAGE_KEY, period);
  }, [period]);

  // benchmarkData 최초 로드 시 시작일 기본값 설정
  useEffect(() => {
    if (benchmarkData?.portfolio.length && !benchmarkInitRef.current) {
      benchmarkInitRef.current = true;
      setBenchmarkStart(benchmarkData.portfolio[0].date);
    }
  }, [benchmarkData]);

  // 선택 기간으로 history 필터링 (자산 추이 차트용)
  const filteredHistory = useMemo(() => {
    const cfg = PERIODS.find((p) => p.key === period);
    if (!cfg || cfg.days === null) return history;
    const cutoff = new Date(Date.now() - cfg.days * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return history.filter((p) => p.date >= cutoff);
  }, [history, period]);

  // 벤치마크 시리즈: 사용자 지정 시작일 기준으로 재인덱싱 (기간 필터와 독립)
  const benchmarkSeriesData = useMemo<SeriesDef[]>(() => {
    if (!benchmarkData) return [];
    const trim = (arr: { date: string; value: number }[]) => {
      const sub = benchmarkStart ? arr.filter(p => p.date >= benchmarkStart) : arr;
      if (sub.length === 0) return sub;
      const base = sub[0].value;
      return base > 0 ? sub.map(p => ({ date: p.date, value: +(p.value / base * 100).toFixed(2) })) : sub;
    };
    return [
      { data: trim(benchmarkData.portfolio), color: cssVar('--accent', '#58a6ff'), label: '내 포트폴리오' },
      { data: trim(benchmarkData.spx),       color: '#f7931a',                     label: 'S&P500' },
      { data: trim(benchmarkData.kospi),     color: '#3fb950',                     label: 'KOSPI' },
    ];
  }, [benchmarkData, benchmarkStart]);

  const valueData = useMemo(
    () => filteredHistory.map((p) => ({ date: p.date, value: p.value_krw })),
    [filteredHistory]
  );

  const principalData = useMemo(
    () => filteredHistory.map((p) => ({ date: p.date, value: p.invested_krw })),
    [filteredHistory]
  );

  const txsSorted = useMemo(
    () => [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [transactions]
  );

  const filteredPortfolioIrr = useMemo(() => {
    if (excludedTickers.size === 0) return summary.portfolioIrr;
    const filteredTxs = txsSorted.filter(t => !excludedTickers.has(t.ticker));
    const filteredHoldings = holdings.filter(h => !excludedTickers.has(h.ticker));
    return filteredTxs.length ? calcPortfolioIrr(filteredTxs, filteredHoldings) : null;
  }, [excludedTickers, txsSorted, holdings, summary.portfolioIrr]);

  const yearlyMdd = useMemo(() => {
    const yearMap = new Map<number, { date: string; value_krw: number }[]>();
    for (const p of history) {
      const year = parseInt(p.date.slice(0, 4));
      if (!yearMap.has(year)) yearMap.set(year, []);
      yearMap.get(year)!.push(p);
    }
    return [...yearMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, pts]) => {
        let peak = -Infinity, mdd = 0;
        for (const p of pts) {
          if (p.value_krw > peak) peak = p.value_krw;
          if (peak > 0) { const dd = (p.value_krw - peak) / peak; if (dd < mdd) mdd = dd; }
        }
        return { year, mdd };
      });
  }, [history]);

  const cagr = useMemo(() => {
    // 심층 분석 데이터가 있으면 포트폴리오 가치 기준으로 계산 (cagrYears 기준)
    if (history.length >= 2) {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - cagrYears);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const startPt = history.find(p => p.date >= cutoffStr) ?? history[0];
      const endPt = history[history.length - 1];
      if (startPt.value_krw <= 0) return null;
      const yrs = (new Date(endPt.date).getTime() - new Date(startPt.date).getTime()) / (365.25 * 24 * 3600 * 1000);
      return yrs > 0 ? Math.pow(endPt.value_krw / startPt.value_krw, 1 / yrs) - 1 : null;
    }
    // 폴백: 투자원금 대비 현재가치 (전체 기간)
    const totalInvested = holdingIrrs.reduce((s, h) => s + h.invested_krw, 0);
    const totalValue = holdingIrrs.reduce((s, h) => s + h.current_value_krw, 0);
    const years = summary.holdingYears;
    if (years <= 0 || totalInvested <= 0) return null;
    return Math.pow(totalValue / totalInvested, 1 / years) - 1;
  }, [history, cagrYears, holdingIrrs, summary.holdingYears]);

  const alpha = useMemo(() => {
    if (!riskDetail) return null;
    const { R_p_ann, rfAnnual, beta: b, R_m_ann } = riskDetail;
    return R_p_ann - (rfAnnual + (b ?? 0) * (R_m_ann - rfAnnual));
  }, [riskDetail]);

  const sigma = riskDetail?.sigma_p_ann ?? null;

  const expectedReturn = useMemo(() => {
    if (!riskDetail) return null;
    const { rfAnnual, beta: b, R_m_ann } = riskDetail;
    return rfAnnual + (b ?? 0) * (R_m_ann - rfAnnual);
  }, [riskDetail]);

  // ΔIRR 기여도: 포트폴리오 IRR - 해당 종목 제외 IRR, × 원금비중
  const irrContributions = useMemo(() => {
    const portIrr = summary.portfolioIrr;
    if (!holdingIrrs.length || portIrr === null || !txsSorted.length) return [];
    const totalInvested = holdingIrrs.reduce((s, h) => s + h.invested_krw, 0);
    if (totalInvested === 0) return [];
    return holdingIrrs.map(h => {
      const filtTxs = txsSorted.filter(t => t.ticker !== h.ticker);
      const filtHoldings = holdings.filter(hh => hh.ticker !== h.ticker);
      const irrWithout = filtTxs.length > 0 ? (calcPortfolioIrr(filtTxs, filtHoldings) ?? 0) : 0;
      const deltaIrr = portIrr - irrWithout;
      const weight = h.invested_krw / totalInvested;
      return { ...h, deltaIrr, weight, contrib: deltaIrr * weight };
    }).sort((a, b) => b.contrib - a.contrib);
  }, [holdingIrrs, summary.portfolioIrr, txsSorted, holdings]);

  // usePortfolio가 거래내역 로딩에 실패한 경우에만 에러 표시.
  if (portfolioStatus === 'error') {
    return <div style={{ padding: 32, color: 'var(--up)' }}>오류: {portfolioError}</div>;
  }
  // 거래내역이 아직 0건이면(최초 로딩 직후) 가벼운 안내만 표시.
  // 단, IRR 등 즉시 지표는 거래내역만 있으면 바로 계산되므로 굳이 막지 않는다.
  if (transactions.length === 0 && (portfolioStatus === 'loading' || portfolioStatus === 'idle')) {
    return (
      <div style={{ padding: 32, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 14 }}>거래내역 로딩 중...</span>
      </div>
    );
  }


  const riskCards: { key: RiskKey; label: string; value: string; raw: number | null; neutral: boolean }[] = [
    { key: 'sharpe',  label: '샤프 비율',    value: fmtRatio(summary.sharpe),       raw: summary.sharpe,   neutral: false },
    { key: 'sortino', label: '소르티노 비율', value: fmtRatio(summary.sortino),      raw: summary.sortino,  neutral: false },
    { key: 'treynor', label: '트레이너 비율', value: fmtRatio(summary.treynor),      raw: summary.treynor,  neutral: false },
    { key: 'beta',    label: '베타 (β)',      value: fmtRatio(summary.beta, 3),      raw: summary.beta,     neutral: true  },
  ];


  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 32px' }}>
      {/* 헤더 + 기간 필터 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>애널리틱스</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              style={{
                background: period === p.key ? 'var(--down)' : 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)',
                color: period === p.key ? '#fff' : 'var(--text-secondary)',
                padding: '5px 12px', borderRadius: 6, cursor: 'pointer',
                fontSize: 12, fontWeight: period === p.key ? 600 : 400,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 상단 요약 카드 + 확장 패널 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
          {/* IRR 카드 */}
          <div
            onClick={() => setExpandedIrr(v => !v)}
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${expandedIrr ? 'var(--accent)' : 'var(--border-primary)'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              포트폴리오 IRR
              {excludedTickers.size > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>
                  ({excludedTickers.size}개 제외)
                </span>
              )}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: (filteredPortfolioIrr ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {fmtPct(filteredPortfolioIrr)}
            </div>
          </div>

          {/* 기대수익률 카드 */}
          <div
            onClick={() => setExpandedExpected(v => !v)}
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${expandedExpected ? 'var(--accent)' : 'var(--border-primary)'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>기대수익률 (CAPM)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: expectedReturn === null ? 'var(--text-secondary)' : expectedReturn >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {expectedReturn === null ? '-' : fmtPct(expectedReturn)}
            </div>
          </div>

          {/* MDD 카드 */}
          <div
            onClick={() => setExpandedMdd(v => !v)}
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${expandedMdd ? 'var(--accent)' : 'var(--border-primary)'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>MDD</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--down)' }}>
              {fmtPct(summary.mdd)}
            </div>
          </div>
        </div>

        {/* IRR 확장: 종목 제외 선택 */}
        {expandedIrr && (
          <div style={{
            marginTop: 12, padding: '14px 18px',
            background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
              제외할 종목 선택 — 선택된 종목을 빼고 IRR을 재계산합니다
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {holdingIrrs.map(h => {
                const excluded = excludedTickers.has(h.ticker);
                return (
                  <button
                    key={h.ticker}
                    onClick={e => {
                      e.stopPropagation();
                      setExcludedTickers(prev => {
                        const next = new Set(prev);
                        if (next.has(h.ticker)) next.delete(h.ticker); else next.add(h.ticker);
                        return next;
                      });
                    }}
                    style={{
                      padding: '4px 12px', borderRadius: 980, fontSize: 12, cursor: 'pointer',
                      background: excluded ? 'var(--down)' : 'var(--bg-tertiary)',
                      border: `1px solid ${excluded ? 'var(--down)' : 'var(--border-primary)'}`,
                      color: excluded ? '#fff' : 'var(--text-secondary)',
                      textDecoration: excluded ? 'line-through' : 'none',
                      transition: 'all 0.15s',
                    }}
                  >
                    {h.name ?? h.ticker}
                  </button>
                );
              })}
            </div>
            {excludedTickers.size > 0 && (
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {excludedTickers.size}개 제외 → 조정 IRR {fmtPct(filteredPortfolioIrr)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); setExcludedTickers(new Set()); }}
                  style={{
                    background: 'none', border: '1px solid var(--border-primary)',
                    borderRadius: 4, padding: '2px 8px', fontSize: 11,
                    color: 'var(--text-secondary)', cursor: 'pointer',
                  }}
                >
                  초기화
                </button>
              </div>
            )}
          </div>
        )}

        {/* 기대수익률 확장: CAPM 계산 과정 */}
        {expandedExpected && (
          riskDetail ? (
            <div style={{ ...detailStyle, marginTop: 12 }}>
              <div style={detailTitle}>기대수익률 (CAPM) 계산 과정</div>
              <code style={detailCode}>
                E(R_p) = R_f + β × (R_m − R_f){'\n'}
                {'\n'}
                R_f    = {(riskDetail.rfAnnual * 100).toFixed(2)}%  (SOFR 기간평균, 연간){'\n'}
                β      = {(riskDetail.beta ?? 0).toFixed(3)}{'\n'}
                R_m    = {(riskDetail.R_m_ann * 100).toFixed(2)}%  (S&P500 연환산 수익률){'\n'}
                {'\n'}
                E(R_p) = {(riskDetail.rfAnnual * 100).toFixed(2)}% + {(riskDetail.beta ?? 0).toFixed(3)} × ({(riskDetail.R_m_ann * 100).toFixed(2)}% − {(riskDetail.rfAnnual * 100).toFixed(2)}%){'\n'}
                       = {expectedReturn !== null ? (expectedReturn * 100).toFixed(2) : '-'}%
              </code>
              <div style={detailNote}>
                CAPM 기대수익률은 주어진 시장위험(β)을 감수하는 대가로 기대되는 수익률입니다.
                실제 수익률(IRR)이 이를 상회할수록 알파(α)가 양수가 됩니다.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: '12px 18px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              먼저 심층 분석을 실행하면 CAPM 계산 과정이 표시됩니다
            </div>
          )
        )}

        {/* MDD 확장: 연도별 MDD 바 차트 */}
        {expandedMdd && (
          <div style={{
            marginTop: 12, padding: '14px 18px',
            background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
            borderRadius: 6,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
              연도별 최대 낙폭 (MDD)
            </div>
            {yearlyMdd.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                먼저 심층 분석을 실행하면 연도별 데이터가 표시됩니다
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(() => {
                  const maxAbs = Math.max(...yearlyMdd.map(y => Math.abs(y.mdd)), 0.001);
                  return yearlyMdd.map(({ year, mdd }) => (
                    <div key={year} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 36, textAlign: 'right', fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>
                        {year}
                      </div>
                      <div style={{ flex: 1, height: 14, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${(Math.abs(mdd) / maxAbs * 100).toFixed(1)}%`,
                          height: '100%', background: 'var(--down)', borderRadius: 3,
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                      <div style={{
                        width: 58, textAlign: 'right', fontSize: 12,
                        color: 'var(--down)', fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                      }}>
                        {(mdd * 100).toFixed(1)}%
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>
        )}

        {/* 추가 지표: CAGR · 알파 α · 연간 변동성 σ */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
          {/* CAGR 카드 */}
          <div
            onClick={() => setExpandedCagr(v => !v)}
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${expandedCagr ? 'var(--accent)' : 'var(--border-primary)'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
              CAGR
              {history.length >= 2 && (
                <span style={{ marginLeft: 5, fontSize: 10, color: 'var(--text-muted)' }}>
                  {cagrYears === 100 ? '전체' : `최근 ${cagrYears}년`}
                </span>
              )}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: cagr === null ? 'var(--text-secondary)' : cagr >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {cagr === null ? '-' : fmtPct(cagr)}
            </div>
          </div>

          {/* 알파 카드 */}
          <div
            onClick={() => setExpandedAlpha(v => !v)}
            style={{
              background: 'var(--bg-card)',
              border: `1px solid ${expandedAlpha ? 'var(--accent)' : 'var(--border-primary)'}`,
              borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>알파 (α)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: alpha === null ? 'var(--text-secondary)' : alpha >= 0 ? 'var(--up)' : 'var(--down)' }}>
              {alpha === null ? '-' : fmtPct(alpha)}
            </div>
          </div>

          {/* 연간 변동성 카드 */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>연간 변동성 (σ)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: sigma === null ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
              {sigma === null ? '-' : (sigma * 100).toFixed(1) + '%'}
            </div>
          </div>
        </div>

        {/* CAGR 확장: 기간 선택 */}
        {expandedCagr && (
          <div style={{ marginTop: 10, padding: '12px 18px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
              계산 기간
              {history.length < 2 && <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--text-muted)' }}>(심층 분석 실행 후 적용)</span>}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([1, 3, 5, 10, 100] as const).map(y => (
                <button key={y} onClick={e => { e.stopPropagation(); setCagrYears(y); }}
                  style={{
                    background: cagrYears === y ? 'var(--accent)' : 'var(--bg-tertiary)',
                    border: '1px solid var(--border-primary)',
                    color: cagrYears === y ? '#fff' : 'var(--text-secondary)',
                    padding: '4px 14px', borderRadius: 980, fontSize: 12, cursor: 'pointer',
                    fontWeight: cagrYears === y ? 600 : 400, transition: 'all 0.15s',
                  }}>
                  {y === 100 ? '전체' : `${y}년`}
                </button>
              ))}
            </div>
            {history.length >= 2 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                포트폴리오 총평가액 기준 — 심층 분석 데이터 사용
              </div>
            )}
          </div>
        )}

        {/* 알파 확장: 계산 과정 */}
        {expandedAlpha && (
          riskDetail ? (
            <div style={{ ...detailStyle, marginTop: 10 }}>
              <div style={detailTitle}>알파 (α) 계산 과정</div>
              <code style={detailCode}>
                α = R_p − [R_f + β × (R_m − R_f)]   (CAPM 초과수익){'\n'}
                {'\n'}
                R_p  = {(riskDetail.R_p_ann * 100).toFixed(2)}%  (포트폴리오 연환산 수익률 — 최근 1년 TWR){'\n'}
                R_f  = {(riskDetail.rfAnnual * 100).toFixed(2)}%  (SOFR 기간평균){'\n'}
                β    = {(riskDetail.beta ?? 0).toFixed(4)}{'\n'}
                R_m  = {(riskDetail.R_m_ann * 100).toFixed(2)}%  (S&P500 연환산 수익률){'\n'}
                {'\n'}
                CAPM 기대수익 = {(riskDetail.rfAnnual * 100).toFixed(2)} + {(riskDetail.beta ?? 0).toFixed(4)} × ({(riskDetail.R_m_ann * 100).toFixed(2)} − {(riskDetail.rfAnnual * 100).toFixed(2)}){'\n'}
                            {'  '}= {((riskDetail.rfAnnual + (riskDetail.beta ?? 0) * (riskDetail.R_m_ann - riskDetail.rfAnnual)) * 100).toFixed(2)}%{'\n'}
                α    = {(riskDetail.R_p_ann * 100).toFixed(2)}% − {((riskDetail.rfAnnual + (riskDetail.beta ?? 0) * (riskDetail.R_m_ann - riskDetail.rfAnnual)) * 100).toFixed(2)}% = {((alpha ?? 0) * 100).toFixed(2)}%
              </code>
              <div style={detailNote}>
                α &gt; 0: 시장 기대 이상의 초과수익 — 운용 능력이 CAPM 예측을 상회한다는 의미.
                α &lt; 0: 시장 기대 하회. 절대값이 작을수록 패시브 인덱스에 가까운 성과.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 10, padding: '12px 18px', background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              먼저 심층 분석을 실행하면 알파 계산 과정이 표시됩니다
            </div>
          )
        )}
      </div>

      {/* 분석 시작 버튼 (idle일 때만) */}
      {chartStatus === 'idle' && (
        <div style={{
          marginBottom: 24, padding: '28px 24px', background: 'var(--bg-card)',
          border: '1px solid var(--border-primary)', borderRadius: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
          animation: 'fadeSlideIn 0.3s ease',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              심층 분석
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              리스크 지표 · 벤치마크 비교 · 자산 추이 차트를 생성합니다<br />
              월간 시세 데이터를 추가로 불러옵니다
              {usdKrw <= 0 && <span style={{ color: 'var(--text-muted)' }}> · 환율 로딩 중...</span>}
            </div>
          </div>
          <button
            onClick={() => loadCharts()}
            disabled={usdKrw <= 0}
            style={{
              background: usdKrw <= 0 ? 'var(--bg-tertiary)' : 'var(--accent, #1f6feb)',
              border: 'none', color: '#fff',
              padding: '10px 28px', borderRadius: 980,
              cursor: usdKrw <= 0 ? 'default' : 'pointer',
              fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => { if (usdKrw > 0) (e.target as HTMLElement).style.opacity = '0.85'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '1'; }}
          >
            분석 시작
          </button>
        </div>
      )}

      {/* 분석 진행 로더 */}
      {chartStatus === 'loading' && <AnalysisLoader />}

      {/* 리스크 지표 카드 (클릭 → 계산 과정) — 차트 로딩 시작 후에만 표시 */}
      {chartStatus === 'done' && (
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10, letterSpacing: '0.04em' }}>
          리스크 지표 &middot; S&amp;P500 벤치마크 &middot; SOFR 무위험금리 &middot;{' '}
          <span style={{ color: 'var(--text-muted)' }}>카드 클릭 시 계산 과정 표시</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {riskCards.map((c) => {
            const color = c.raw === null
              ? 'var(--text-secondary)'
              : c.neutral ? 'var(--text-primary)'
              : c.raw >= 0 ? 'var(--up)' : 'var(--down)';
            const isSelected = expandedRisk === c.key;
            return (
              <div
                key={c.key}
                onClick={() => setExpandedRisk(isSelected ? null : c.key)}
                style={{
                  background: 'var(--bg-card)',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-primary)'}`,
                  borderRadius: 8, padding: '16px 20px', cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{c.value}</div>
              </div>
            );
          })}
        </div>
        {expandedRisk && riskDetail && (
          <RiskDetailPanel type={expandedRisk} d={riskDetail} />
        )}
      </div>
      )}

      {/* 벤치마크 비교 차트 */}
      {chartStatus !== 'idle' && (
      <div style={{ marginBottom: 24 }}>
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>시작일</span>
            <input
              type="date"
              value={benchmarkStart}
              min={benchmarkData?.portfolio[0]?.date ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={e => setBenchmarkStart(e.target.value)}
              style={{
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
                borderRadius: 4, padding: '3px 8px', color: 'var(--text-primary)', fontSize: 12,
                cursor: 'pointer',
              }}
            />
            {benchmarkData?.portfolio[0]?.date && benchmarkStart !== benchmarkData.portfolio[0].date && (
              <button
                onClick={() => setBenchmarkStart(benchmarkData!.portfolio[0].date)}
                style={{
                  background: 'none', border: '1px solid var(--border-primary)', borderRadius: 4,
                  padding: '3px 8px', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                }}
              >처음으로</button>
            )}
          </div>
          <BenchmarkChart series={benchmarkSeriesData} />
        </>
      </div>
      )}

      {/* 자산 총액 + 원금 추이 */}
      {chartStatus === 'done' && (
      <div style={{ marginBottom: 24 }}>
        <AssetChart valueData={valueData} principalData={principalData} />
      </div>
      )}

      {/* IRR 수익 기여도 차트 (접이식) */}
      {holdingIrrs.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}>
          <div
            onClick={() => setExpandedIrrContrib(v => !v)}
            style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: expandedIrrContrib ? '1px solid var(--bg-tertiary)' : 'none' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>IRR 수익 기여도 (ΔIRR × 원금비중)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>종목 제외 시 ΔIRR × 원금비중</div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{expandedIrrContrib ? '▲' : '▼'}</span>
            </div>
          </div>
          {expandedIrrContrib && (
            <div style={{ padding: '16px 20px' }}>
              {irrContributions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>심층 분석 실행 후 표시됩니다</div>
              ) : (() => {
                const maxAbs = Math.max(...irrContributions.map(h => Math.abs(h.contrib)), 0.001);
                const portIrr = summary.portfolioIrr;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {irrContributions.map(h => {
                      const c = h.contrib;
                      const color = c >= 0 ? 'var(--up)' : 'var(--down)';
                      const barW = Math.abs(c) / maxAbs * 100;
                      const label = /^\d{6}$/.test(h.ticker) ? h.name : h.ticker;
                      return (
                        <div key={h.ticker} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 92, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                          <div style={{ width: 36, fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', flexShrink: 0 }}>{(h.weight * 100).toFixed(0)}%</div>
                          <div style={{ flex: 1, height: 22, background: 'var(--bg-tertiary)', borderRadius: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${barW}%`, height: '100%', background: color, borderRadius: 6, opacity: 0.82, transition: 'width 0.6s ease', minWidth: 2 }} />
                          </div>
                          <div style={{ width: 60, fontSize: 12, color, textAlign: 'right', flexShrink: 0, fontWeight: 700 }}>
                            {c >= 0 ? '+' : ''}{(c * 100).toFixed(2)}%p
                          </div>
                        </div>
                      );
                    })}
                    <div style={{ borderTop: '1px dashed var(--border-primary)', paddingTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>포트폴리오 IRR</span>
                      <span style={{ fontSize: 15, fontWeight: 700, color: (portIrr ?? 0) >= 0 ? 'var(--up)' : 'var(--down)' }}>
                        {portIrr !== null ? ((portIrr >= 0 ? '+' : '') + (portIrr * 100).toFixed(2) + '%') : '-'}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* 종목별 IRR 테이블 */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bg-tertiary)', fontSize: 13, fontWeight: 600 }}>종목별 IRR</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
              {['종목명', '티커', '최초 매수', '투자 원금', '현재 평가', 'IRR'].map((h) => (
                <th key={h} style={{ padding: '8px 14px', textAlign: h === 'IRR' || h === '투자 원금' || h === '현재 평가' ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...holdingIrrs]
              .sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity))
              .map((r, i) => {
                const irrColor = r.irr === null ? 'var(--text-secondary)' : r.irr >= 0 ? 'var(--up)' : 'var(--down)';
                return (
                  <tr key={r.ticker} style={{ borderTop: '1px solid var(--bg-tertiary)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-primary)' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', fontSize: 11 }}>{r.ticker}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)' }}>{r.first_date}</td>
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
