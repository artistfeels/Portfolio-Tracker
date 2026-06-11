// src/hooks/useAnalytics.ts
import { useMemo, useState, useCallback, useRef } from 'react';
import { calcPortfolioIrr, calcHoldingIrrs, calcRiskRatios, calcTwr, buildIndexFrom } from '../lib/calc';
import type { RiskRatiosDetailed } from '../lib/calc';
import { fetchSofr, fetchSpxWeekly, fetchKospiWeekly } from '../lib/market';
import { buildPortfolioHistory } from '../lib/history';
import type { Transaction, HoldingWithPrice, HistoryPoint, IrrResult } from '../lib/types';

export type ChartStatus = 'idle' | 'loading' | 'done' | 'error';

export interface BenchmarkData {
  portfolio: { date: string; value: number }[];
  spx:       { date: string; value: number }[];
  kospi:     { date: string; value: number }[];
}

export interface AnalyticsSummary {
  portfolioIrr: number | null;
  mdd: number | null;
  holdingYears: number;
  sharpe: number | null;
  sortino: number | null;
  treynor: number | null;
  beta: number | null;
}

function calcMdd(history: HistoryPoint[]): number | null {
  if (history.length < 2) return null;
  let peak = history[0].value_krw;
  let mdd = 0;
  for (const p of history) {
    if (p.value_krw > peak) peak = p.value_krw;
    const drawdown = peak > 0 ? (p.value_krw - peak) / peak : 0;
    if (drawdown < mdd) mdd = drawdown;
  }
  return mdd;
}

function lookupClose(
  closes: { date: string; close: number }[],
  date: string
): number | null {
  let best: { date: string; close: number } | null = null;
  for (const c of closes) {
    if (c.date <= date) best = c;
    else break;
  }
  return best?.close ?? null;
}

/** 전체 비동기 작업에 강제 예산을 둬서, 외부 API가 멈춰도 차트 로딩이 영원히 끝나지 않는 일을 방지한다. */
function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const tid = setTimeout(() => { if (!settled) { settled = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!settled) { settled = true; clearTimeout(tid); resolve(v); } })
     .catch(() => { if (!settled) { settled = true; clearTimeout(tid); resolve(fallback); } });
  });
}

/**
 * Analytics 지표 훅.
 *
 * 설계: 거래내역 + 이미 로드된 현재 시세(usePortfolio 재사용)만으로 모든
 * "즉시 지표"(종목/포트폴리오 IRR, 보유기간)를 **동기적으로, 네트워크 0건**
 * 으로 계산한다. 무거운 히스토리/벤치마크/리스크 차트는 사용자가 명시적으로
 * loadCharts()를 호출할 때만, 전체 시간 예산(budget) 안에서 로드한다.
 */
export function useAnalytics(
  transactions: Transaction[],
  holdings: HoldingWithPrice[],
  usdKrw: number
) {
  const [chartStatus, setChartStatus] = useState<ChartStatus>('idle');
  const [history,     setHistory]     = useState<HistoryPoint[]>([]);
  const [summary,     setSummary]     = useState<AnalyticsSummary>({
    portfolioIrr: null, mdd: null, holdingYears: 0,
    sharpe: null, sortino: null, treynor: null, beta: null,
  });
  const [riskDetail,    setRiskDetail]    = useState<RiskRatiosDetailed | null>(null);
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkData | null>(null);
  const loadingRef = useRef(false);

  // ── 즉시 지표: 거래내역 + 현재 보유 시세만으로 동기 계산 (네트워크 0건) ──
  const txsSorted = useMemo(
    () => [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    [transactions]
  );

  const portfolioIrr = useMemo(
    () => (txsSorted.length ? calcPortfolioIrr(txsSorted, holdings) : null),
    [txsSorted, holdings]
  );

  const holdingIrrs = useMemo<IrrResult[]>(
    () => (txsSorted.length ? calcHoldingIrrs(txsSorted, holdings) : []),
    [txsSorted, holdings]
  );

  const holdingYears = useMemo(() => {
    if (txsSorted.length === 0) return 0;
    const years = (Date.now() - new Date(txsSorted[0].trade_date).getTime()) / (365.25 * 24 * 3600 * 1000);
    return Math.round(years * 10) / 10;
  }, [txsSorted]);

  // 즉시 지표를 summary에 반영 (mdd/리스크는 차트 로딩 후 채워짐)
  const baseSummary = useMemo<AnalyticsSummary>(() => ({
    ...summary,
    portfolioIrr,
    holdingYears,
  }), [summary, portfolioIrr, holdingYears]);

  // ── 차트/리스크: 명시적 호출 시에만 로드 (전체 예산 18초) ──
  const loadCharts = useCallback(async () => {
    if (loadingRef.current) return;
    if (txsSorted.length === 0) { setChartStatus('done'); return; }
    loadingRef.current = true;
    setChartStatus('loading');

    try {
      const firstDate = txsSorted[0].trade_date;
      const benchmarkPeriod1 = Math.floor(new Date(firstDate).getTime() / 1000);
      const period2 = Math.floor(Date.now() / 1000);
      const ONE_YEAR_SECS = 365 * 24 * 3600;
      const riskPeriod1 = Math.floor(Date.now() / 1000) - ONE_YEAR_SECS;

      // 전체 18초 예산. 어떤 외부 API가 멈춰도 이 시간 안에 무조건 결과를 확정한다.
      const BUDGET = 18000;
      const [hist, rfAnnual, spxCloses, kospiCloses] = await Promise.all([
        withBudget(buildPortfolioHistory(txsSorted, usdKrw, 3), BUDGET, [] as HistoryPoint[]),
        withBudget(fetchSofr(riskPeriod1, period2), BUDGET, 0),
        withBudget(fetchSpxWeekly(benchmarkPeriod1, period2), BUDGET, [] as { date: string; close: number }[]),
        withBudget(fetchKospiWeekly(benchmarkPeriod1, period2), BUDGET, [] as { date: string; close: number }[]),
      ]);

      setHistory(hist);

      const twrPts = calcTwr(hist);
      const startDate = hist[0]?.date ?? firstDate;
      setBenchmarkData({
        portfolio: twrPts.map(p => ({ date: p.date, value: p.twr })),
        spx:   buildIndexFrom(spxCloses,   startDate),
        kospi: buildIndexFrom(kospiCloses, startDate),
      });

      // 리스크 지표 (월간 수익률, periodsPerYear=12)
      const portfolioReturns: number[] = [];
      const marketReturns: number[] = [];
      for (let i = 1; i < hist.length; i++) {
        const prev = hist[i - 1];
        const curr = hist[i];
        if (prev.value_krw <= 0 || curr.value_krw <= 0) continue;
        const netCashFlow = curr.invested_krw - prev.invested_krw;
        const denom = prev.value_krw + netCashFlow;
        if (denom <= 0) continue;
        const pr = (curr.value_krw - prev.value_krw - netCashFlow) / denom;
        const spxPrev = lookupClose(spxCloses, prev.date);
        const spxCurr = lookupClose(spxCloses, curr.date);
        if (spxPrev && spxCurr && spxPrev > 0) {
          portfolioReturns.push(pr);
          marketReturns.push((spxCurr - spxPrev) / spxPrev);
        }
      }
      // 최근 12개월만 사용 (n=12, 1년치 리스크)
      const last12P = portfolioReturns.slice(-12);
      const last12M = marketReturns.slice(-12);
      const ratios = calcRiskRatios(last12P, last12M, rfAnnual, 12);
      setRiskDetail(ratios);

      setSummary(prev => ({
        ...prev,
        mdd: calcMdd(hist),
        sharpe: ratios.sharpe,
        sortino: ratios.sortino,
        treynor: ratios.treynor,
        beta: ratios.beta,
      }));
      setChartStatus('done');
    } catch {
      // withBudget가 reject를 삼키므로 여기까지 거의 오지 않지만, 안전망.
      setChartStatus('error');
    } finally {
      loadingRef.current = false;
    }
  }, [txsSorted, usdKrw]);

  return {
    summary: baseSummary,
    holdingIrrs,
    chartStatus,
    history,
    riskDetail,
    benchmarkData,
    loadCharts,
  };
}
