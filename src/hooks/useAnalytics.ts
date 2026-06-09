// src/hooks/useAnalytics.ts
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calcHoldings, calcSummary, calcPortfolioIrr, calcHoldingIrrs, calcRiskRatios } from '../lib/calc';
import { fetchSofr, fetchSpxWeekly } from '../lib/market';
import { fetchAllPrices, fetchUsdKrw } from '../lib/prices';
import { buildPortfolioHistory } from '../lib/history';
import type { Transaction, HoldingWithPrice, HistoryPoint, IrrResult } from '../lib/types';

export type AnalyticsStatus = 'idle' | 'loading' | 'done' | 'error';

export interface AnalyticsSummary {
  portfolioIrr: number | null;
  annualReturn: number | null;
  mdd: number | null;
  holdingYears: number;
  sharpe: number | null;
  sortino: number | null;
  treynor: number | null;
  beta: number | null;
}

function calcAnnualReturn(totalValue: number, totalPrincipal: number, firstDate: string): number | null {
  const years = (Date.now() - new Date(firstDate).getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 0.01 || totalPrincipal <= 0) return null;
  return Math.pow(totalValue / totalPrincipal, 1 / years) - 1;
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

function lookupSpx(
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

export function useAnalytics() {
  const [status, setStatus] = useState<AnalyticsStatus>('idle');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>({
    portfolioIrr: null, annualReturn: null, mdd: null, holdingYears: 0,
    sharpe: null, sortino: null, treynor: null, beta: null,
  });
  const [holdingIrrs, setHoldingIrrs] = useState<IrrResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setStatus('loading');
        const { data, error: dbErr } = await supabase
          .from('transactions').select('*').order('trade_date', { ascending: true });
        if (dbErr) throw new Error(dbErr.message);
        const txs = (data ?? []) as Transaction[];
        if (txs.length === 0) { setStatus('done'); return; }

        const usdKrw = await fetchUsdKrw();
        const rawHoldings = calcHoldings(txs);
        const tickers = rawHoldings.map((h) => h.ticker);
        const prices = await fetchAllPrices(tickers, usdKrw);

        const withPrices: HoldingWithPrice[] = rawHoldings.map((h) => {
          const p = prices.get(h.ticker);
          const current = p?.price_krw ?? 0;
          const marketVal = Math.round(current * h.shares);
          const profit = marketVal - h.total_principal_krw;
          return {
            ...h,
            name: p?.display_name ?? h.name,
            current_price_krw: current,
            market_value_krw: marketVal,
            profit_krw: profit,
            profit_pct: h.total_principal_krw > 0 ? (profit / h.total_principal_krw) * 100 : 0,
            price_source: p?.source ?? 'manual',
            daily_change_pct: p?.daily_change_pct ?? null,
            prev_close_krw: p?.prev_close_krw ?? 0,
          };
        });

        if (cancelled) return;
        setHoldings(withPrices);

        const s = calcSummary(withPrices);
        const firstDate = txs[0].trade_date;
        const years = (Date.now() - new Date(firstDate).getTime()) / (365.25 * 24 * 3600 * 1000);

        // Limit history to 1 year to prevent browser overload
        const ONE_YEAR_SECS = 365 * 24 * 3600;
        const period1 = Math.max(
          Math.floor(new Date(txs[0].trade_date).getTime() / 1000),
          Math.floor(Date.now() / 1000) - ONE_YEAR_SECS
        );
        const period2 = Math.floor(Date.now() / 1000);

        const [hist, rfAnnual, spxCloses] = await Promise.all([
          buildPortfolioHistory(txs, usdKrw),
          fetchSofr(period1, period2),
          fetchSpxWeekly(period1, period2),
        ]);
        if (cancelled) return;
        setHistory(hist);

        const portfolioReturns: number[] = [];
        const marketReturns: number[] = [];
        for (let i = 1; i < hist.length; i++) {
          const prev = hist[i - 1];
          const curr = hist[i];
          if (prev.value_krw <= 0) continue;
          const pr = (curr.value_krw - prev.value_krw) / prev.value_krw;
          const spxPrev = lookupSpx(spxCloses, prev.date);
          const spxCurr = lookupSpx(spxCloses, curr.date);
          if (spxPrev && spxCurr && spxPrev > 0) {
            portfolioReturns.push(pr);
            marketReturns.push((spxCurr - spxPrev) / spxPrev);
          }
        }
        const ratios = calcRiskRatios(portfolioReturns, marketReturns, rfAnnual);

        setSummary({
          portfolioIrr: calcPortfolioIrr(txs, withPrices),
          annualReturn: calcAnnualReturn(s.totalValue, s.totalPrincipal, firstDate),
          mdd: calcMdd(hist),
          holdingYears: Math.round(years * 10) / 10,
          sharpe: ratios.sharpe,
          sortino: ratios.sortino,
          treynor: ratios.treynor,
          beta: ratios.beta,
        });
        setHoldingIrrs(calcHoldingIrrs(txs, withPrices));
        setStatus('done');
      } catch (e: unknown) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setStatus('error'); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { status, history, holdings, summary, holdingIrrs, error };
}
