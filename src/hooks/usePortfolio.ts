import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calcHoldings, calcSummary } from '../lib/calc';
import { fetchPrice, fetchUsdKrw } from '../lib/prices';
import type { Transaction, HoldingWithPrice } from '../lib/types';

export type LoadStatus = 'idle' | 'loading' | 'done' | 'error';

export function usePortfolio() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [summary, setSummary] = useState({ totalValue: 0, totalPrincipal: 0, totalProfit: 0, profitPct: 0 });
  const [usdKrw, setUsdKrw] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const loadingRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (!silent) setStatus('loading');
      setIsRefreshing(true);
      setError(null);

      // 1. DB fetch (fast, ~200ms)
      const { data, error: dbErr } = await supabase
        .from('transactions')
        .select('*')
        .order('trade_date', { ascending: true });
      if (dbErr) throw new Error(dbErr.message);

      const txs = (data ?? []) as Transaction[];
      setTransactions(txs);
      const rawHoldings = calcHoldings(txs);

      // 2. Immediately show table with avg prices as placeholder (no rate needed)
      if (!silent) {
        const placeholder: HoldingWithPrice[] = rawHoldings.map(h => ({
          ...h,
          current_price_krw: h.avg_price_krw,
          market_value_krw: Math.round(h.avg_price_krw * h.shares),
          profit_krw: 0,
          profit_pct: 0,
          price_source: 'loading',
          daily_change_pct: null as number | null,
          prev_close_krw: 0,
        }));
        setHoldings(placeholder);
        setSummary(calcSummary(placeholder));
        setStatus('done'); // Table is visible NOW, prices fill in below
      }

      // 3. Fetch rate + cash balance in parallel (background from user perspective)
      const [rate, cashResult] = await Promise.all([
        fetchUsdKrw(),
        supabase.from('cash_balance').select('amount_krw'),
      ]);
      setUsdKrw(rate);

      const cashBalance = cashResult.data
        ? (cashResult.data as { amount_krw: number }[]).reduce((s, r) => s + (r.amount_krw ?? 0), 0)
        : 0;

      const cashEntry: HoldingWithPrice = {
        ticker: 'CASH',
        name: '현금 (KRW)',
        shares: cashBalance,
        avg_price_krw: 1,
        total_principal_krw: cashBalance,
        current_price_krw: 1,
        market_value_krw: cashBalance,
        profit_krw: 0,
        profit_pct: 0,
        sector: null,
        region: '한국',
        asset_group: '현금',
        price_source: '-',
        daily_change_pct: null,
        prev_close_krw: 1,
      };

      // 4. Progressively fetch prices — each row updates as its price arrives
      for (const h of rawHoldings) {
        const p = await fetchPrice(h.ticker, rate);
        setHoldings(prev => {
          const updated = prev.map(holding => {
            if (holding.ticker !== h.ticker) return holding;
            const current = p.price_krw || holding.avg_price_krw;
            const marketVal = Math.round(current * holding.shares);
            const profit = marketVal - holding.total_principal_krw;
            return {
              ...holding,
              name: p.display_name ?? holding.name,
              current_price_krw: current,
              market_value_krw: marketVal,
              profit_krw: profit,
              profit_pct: holding.total_principal_krw > 0 ? (profit / holding.total_principal_krw) * 100 : 0,
              price_source: p.source,
              daily_change_pct: p.daily_change_pct,
              prev_close_krw: p.prev_close_krw,
            };
          });
          // If this is a new ticker not yet in the list (e.g., after silent refresh)
          const exists = prev.some(x => x.ticker === h.ticker);
          if (!exists) {
            const current = p.price_krw || h.avg_price_krw;
            const marketVal = Math.round(current * h.shares);
            const profit = marketVal - h.total_principal_krw;
            updated.push({
              ...h,
              name: p.display_name ?? h.name,
              current_price_krw: current,
              market_value_krw: marketVal,
              profit_krw: profit,
              profit_pct: h.total_principal_krw > 0 ? (profit / h.total_principal_krw) * 100 : 0,
              price_source: p.source,
              daily_change_pct: p.daily_change_pct,
              prev_close_krw: p.prev_close_krw,
            });
          }
          setSummary(calcSummary(updated));
          return updated;
        });
        if (p.source !== 'cache') {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      // 5. Final: sync cash, remove sold-off tickers, sort by market value
      const activeTickers = new Set(rawHoldings.map(h => h.ticker));
      setHoldings(prev => {
        let updated = prev.filter(h => h.ticker === 'CASH' || activeTickers.has(h.ticker));
        if (cashBalance > 0) {
          const hasCash = updated.some(h => h.ticker === 'CASH');
          updated = hasCash
            ? updated.map(h => h.ticker === 'CASH' ? cashEntry : h)
            : [...updated, cashEntry];
        } else {
          updated = updated.filter(h => h.ticker !== 'CASH');
        }
        const sorted = [...updated].sort((a, b) => b.market_value_krw - a.market_value_krw);
        setSummary(calcSummary(sorted));
        return sorted;
      });

      setLastUpdated(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      if (!silent) setStatus('error');
    } finally {
      setIsRefreshing(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 30-second polling for price refresh (silent, no loading state)
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  return { transactions, holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload: load };
}
