// src/hooks/useAnalytics.ts
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calcHoldings, calcSummary, calcPortfolioIrr, calcHoldingIrrs } from '../lib/calc';
import { fetchAllPrices, fetchUsdKrw } from '../lib/prices';
import { buildPortfolioHistory } from '../lib/history';
import type { Transaction, HoldingWithPrice, HistoryPoint, IrrResult } from '../lib/types';

export type AnalyticsStatus = 'idle' | 'loading' | 'done' | 'error';

export interface AnalyticsSummary {
  portfolioIrr: number | null;
  annualReturn: number | null;
  mdd: number | null;
  holdingYears: number;
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

export function useAnalytics() {
  const [status, setStatus] = useState<AnalyticsStatus>('idle');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary>({
    portfolioIrr: null, annualReturn: null, mdd: null, holdingYears: 0,
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
          };
        });

        if (cancelled) return;
        setHoldings(withPrices);

        const s = calcSummary(withPrices);
        const firstDate = txs[0].trade_date;
        const years = (Date.now() - new Date(firstDate).getTime()) / (365.25 * 24 * 3600 * 1000);

        const hist = await buildPortfolioHistory(txs, usdKrw);
        if (cancelled) return;
        setHistory(hist);

        setSummary({
          portfolioIrr: calcPortfolioIrr(txs, withPrices),
          annualReturn: calcAnnualReturn(s.totalValue, s.totalPrincipal, firstDate),
          mdd: calcMdd(hist),
          holdingYears: Math.round(years * 10) / 10,
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
