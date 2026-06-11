import type { Transaction, Holding, HoldingWithPrice, IrrResult, HistoryPoint } from './types';

// 거래내역에서 현재 보유종목 자동 산출 (매수합 - 매도합)
export function calcHoldings(transactions: Transaction[]): Holding[] {
  const map = new Map<string, {
    name: string; shares: number; cost: number;
    sector: string | null; region: '한국' | '해외'; asset_group: string | null;
  }>();

  // 날짜 오름차순 정렬
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime()
  );

  for (const tx of sorted) {
    if (tx.action === 'buy') {
      const prev = map.get(tx.ticker);
      if (prev) {
        const newShares = prev.shares + tx.shares;
        const newCost = prev.cost + tx.shares * tx.price_krw;
        map.set(tx.ticker, { ...prev, shares: newShares, cost: newCost });
      } else {
        map.set(tx.ticker, {
          name: tx.name,
          shares: tx.shares,
          cost: tx.shares * tx.price_krw,
          sector: tx.sector,
          region: tx.region,
          asset_group: tx.asset_group,
        });
      }
    } else if (tx.action === 'sell') {
      const prev = map.get(tx.ticker);
      if (prev) {
        const newShares = prev.shares - tx.shares;
        // 매도 시 원가도 비례 차감
        const newCost = newShares > 0 ? prev.cost * (newShares / prev.shares) : 0;
        if (newShares <= 0) map.delete(tx.ticker);
        else map.set(tx.ticker, { ...prev, shares: newShares, cost: newCost });
      }
    }
  }

  return Array.from(map.entries()).map(([ticker, v]) => ({
    ticker,
    name: v.name,
    shares: v.shares,
    avg_price_krw: v.shares > 0 ? Math.round(v.cost / v.shares) : 0,
    total_principal_krw: Math.round(v.cost),
    sector: v.sector,
    region: v.region,
    asset_group: v.asset_group,
  }));
}

// 포트폴리오 요약
export function calcSummary(holdings: { market_value_krw: number; total_principal_krw: number }[]) {
  const totalValue = holdings.reduce((s, h) => s + h.market_value_krw, 0);
  const totalPrincipal = holdings.reduce((s, h) => s + h.total_principal_krw, 0);
  const totalProfit = totalValue - totalPrincipal;
  const profitPct = totalPrincipal > 0 ? (totalProfit / totalPrincipal) * 100 : 0;
  return { totalValue, totalPrincipal, totalProfit, profitPct };
}

export interface Cashflow {
  date: Date;
  amount: number;
}

export function calcIrr(cashflows: Cashflow[]): number | null {
  if (cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

  function npv(r: number): number {
    return sorted.reduce((s, cf) => {
      const years = (cf.date.getTime() - t0) / MS_PER_YEAR;
      return s + cf.amount / Math.pow(1 + r, years);
    }, 0);
  }

  let lo = -0.999, hi = 100;
  const fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) * fLo > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

export function calcPortfolioIrr(
  transactions: Transaction[],
  holdings: HoldingWithPrice[]
): number | null {
  const cashflows: Cashflow[] = [];
  const today = new Date();

  for (const tx of transactions) {
    const date = new Date(tx.trade_date);
    if (tx.action === 'buy') {
      cashflows.push({ date, amount: -(tx.shares * tx.price_krw) });
    } else if (tx.action === 'sell' || tx.action === 'dividend') {
      cashflows.push({ date, amount: tx.shares * tx.price_krw });
    }
  }
  for (const h of holdings) {
    if (h.ticker === 'CASH') continue;
    if (h.market_value_krw > 0) {
      cashflows.push({ date: today, amount: h.market_value_krw });
    }
  }
  return calcIrr(cashflows);
}

export function calcHoldingIrrs(
  transactions: Transaction[],
  holdings: HoldingWithPrice[]
): IrrResult[] {
  const today = new Date();
  return holdings
    .filter((h) => h.ticker !== 'CASH')
    .map((h) => {
      const txs = transactions.filter((t) => t.ticker === h.ticker);
      const cfs: Cashflow[] = txs.map((t) => ({
        date: new Date(t.trade_date),
        amount:
          t.action === 'buy' ? -(t.shares * t.price_krw) :
          t.action === 'sell' || t.action === 'dividend' ? t.shares * t.price_krw : 0,
      })).filter((cf) => cf.amount !== 0);

      if (h.market_value_krw > 0) {
        cfs.push({ date: today, amount: h.market_value_krw });
      }

      const firstTx = [...txs].sort((a, b) => a.trade_date.localeCompare(b.trade_date))[0];
      return {
        ticker: h.ticker,
        name: h.name,
        irr: calcIrr(cfs),
        invested_krw: h.total_principal_krw,
        current_value_krw: h.market_value_krw,
        first_date: firstTx?.trade_date ?? '',
      };
    });
}

export interface RiskRatios {
  sharpe: number | null;
  sortino: number | null;
  treynor: number | null;
  beta: number | null;
}

export interface RiskRatiosDetailed extends RiskRatios {
  n: number;           // 분석에 사용된 주(週) 수
  rfAnnual: number;    // 연간 무위험금리 (SOFR)
  R_p_ann: number;     // 연환산 포트폴리오 평균 수익률
  R_m_ann: number;     // 연환산 S&P500 평균 수익률
  sigma_p_ann: number; // 연환산 포트폴리오 전체 표준편차
  sigma_d_ann: number; // 연환산 포트폴리오 하방 표준편차 (Sortino용)
}

export interface TwrPoint {
  date: string;
  twr: number; // 100 기준 인덱스 (시작=100)
}

/** Time-Weighted Return: 현금유출입을 구간별로 제거한 순수 운용 성과. */
export function calcTwr(history: HistoryPoint[]): TwrPoint[] {
  if (history.length === 0) return [];
  let product = 1.0;
  const pts: TwrPoint[] = [{ date: history[0].date, twr: 100 }];
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    // prev 또는 curr 중 하나라도 0이면 가격 데이터 누락 — 건너뜀 (product 유지)
    if (prev.value_krw > 0 && curr.value_krw > 0) {
      const netCashFlow = curr.invested_krw - prev.invested_krw;
      const denom = prev.value_krw + netCashFlow;
      if (denom > 0) product *= curr.value_krw / denom;
    }
    pts.push({ date: curr.date, twr: +(product * 100).toFixed(2) });
  }
  return pts;
}

/** 벤치마크 종가를 startDate 기준 100 인덱스로 변환. */
export function buildIndexFrom(
  closes: { date: string; close: number }[],
  startDate: string
): { date: string; value: number }[] {
  const filtered = closes.filter((c) => c.date >= startDate);
  if (filtered.length === 0) return [];
  const base = filtered[0].close;
  if (base <= 0) return [];
  return filtered.map((c) => ({ date: c.date, value: +(c.close / base * 100).toFixed(2) }));
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sampleVar(arr: number[]): number {
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function sampleCov(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
}

/** 수익률 배열을 받아 연간화 리스크 지표 + 중간 계산값을 반환.
 *  periodsPerYear: 52 = 주간, 12 = 월간 */
export function calcRiskRatios(
  portfolioReturns: number[],
  marketReturns: number[],
  rfAnnual: number,
  periodsPerYear = 12
): RiskRatiosDetailed {
  const nullResult: RiskRatiosDetailed = {
    sharpe: null, sortino: null, treynor: null, beta: null,
    n: portfolioReturns.length, rfAnnual,
    R_p_ann: 0, R_m_ann: 0, sigma_p_ann: 0, sigma_d_ann: 0,
  };
  if (portfolioReturns.length < 4 || marketReturns.length < 4 || portfolioReturns.length !== marketReturns.length) {
    return nullResult;
  }

  const n = portfolioReturns.length;
  const rfPeriod = rfAnnual / periodsPerYear;
  // 기하평균 연환산: 현금유출입 조정된 월간 수익률의 복리 합산 → 1년 TWR과 동일
  const geo = (arr: number[]) => Math.pow(arr.reduce((p, r) => p * (1 + r), 1), periodsPerYear / n) - 1;
  const R_p_ann = geo(portfolioReturns);
  const R_m_ann = geo(marketReturns);
  const sigma_p_ann = Math.sqrt(sampleVar(portfolioReturns)) * Math.sqrt(periodsPerYear);

  // population semi-variance (Sortino 하방편차: 업계 표준)
  const downsideVariance =
    portfolioReturns.reduce((s, r) => s + Math.min(r - rfPeriod, 0) ** 2, 0) / n;
  const sigma_d_ann = Math.sqrt(downsideVariance) * Math.sqrt(periodsPerYear);

  const varM = sampleVar(marketReturns);
  const beta = varM > 1e-12 ? sampleCov(portfolioReturns, marketReturns) / varM : null;
  const excess = R_p_ann - rfAnnual;

  return {
    sharpe: sigma_p_ann > 1e-12 ? excess / sigma_p_ann : null,
    sortino: sigma_d_ann > 1e-12 ? excess / sigma_d_ann : null,
    treynor: beta !== null && Math.abs(beta) > 0.001 ? excess / beta : null,
    beta,
    n, rfAnnual, R_p_ann, R_m_ann, sigma_p_ann, sigma_d_ann,
  };
}
