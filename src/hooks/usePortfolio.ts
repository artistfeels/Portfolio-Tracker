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
  const usdKrwRef = useRef(0);

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

      // 3. Fetch rate + cash in parallel
      const [rate, cashResult] = await Promise.all([
        fetchUsdKrw(),
        supabase.from('cash_balance').select('amount_krw').eq('id', 1).maybeSingle(),
      ]);
      setUsdKrw(rate);
      usdKrwRef.current = rate;

      const supabaseCash = (!cashResult.error && cashResult.data?.amount_krw != null)
        ? Number(cashResult.data.amount_krw)
        : null;
      const localCash = Number(localStorage.getItem('portfolio_cash_krw') ?? '0');
      // Use the larger value: handles migration where Supabase table has default 0
      // but localStorage already has real cash entered by the user.
      const cashBalance = supabaseCash !== null ? Math.max(supabaseCash, localCash) : localCash;
      localStorage.setItem('portfolio_cash_krw', String(cashBalance));
      // If localStorage had more, sync it up to Supabase
      if (supabaseCash !== null && localCash > supabaseCash) {
        supabase.from('cash_balance').upsert({ id: 1, amount_krw: localCash }).then(() => {});
      }

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

      // 5. Final: sync cash, remove sold-off tickers, sort by market value (CASH always included)
      const activeTickers = new Set(rawHoldings.map(h => h.ticker));
      setHoldings(prev => {
        let updated = prev.filter(h => h.ticker === 'CASH' || activeTickers.has(h.ticker));
        const hasCash = updated.some(h => h.ticker === 'CASH');
        updated = hasCash
          ? updated.map(h => h.ticker === 'CASH' ? cashEntry : h)
          : [...updated, cashEntry];
        const sorted = silent
          ? updated
          : [...updated].sort((a, b) => b.market_value_krw - a.market_value_krw);
        setSummary(calcSummary(sorted));
        return sorted;
      });

      setLastUpdated(new Date());

      // 일별 스냅샷 저장 (테이블이 없으면 무시)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const today = new Date().toISOString().slice(0, 10);
          const snap = {
            user_id: user.id,
            date: today,
            total_assets_krw: Math.round(rawHoldings.reduce((s, h) => s + h.avg_price_krw * h.shares, 0)),
            total_principal_krw: Math.round(rawHoldings.reduce((s, h) => s + h.total_principal_krw, 0)),
            unrealized_profit_krw: 0,
            usd_krw: usdKrwRef.current,
          };
          supabase.from('portfolio_snapshots').upsert(snap, { onConflict: 'user_id,date' }).then(() => {});
        }
      } catch { /* 스냅샷 테이블 미존재 시 무시 */ }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      if (!silent) setStatus('error');
    } finally {
      setIsRefreshing(false);
      loadingRef.current = false;
    }
  }, []);

  const updateCash = useCallback((amount: number) => {
    // localStorage: immediate, works offline / before Supabase table is created
    localStorage.setItem('portfolio_cash_krw', String(amount));
    // Supabase: cross-device sync (upsert silently fails if table doesn't exist yet)
    supabase.from('cash_balance').upsert({ id: 1, amount_krw: amount }).then(() => {});

    const cashEntry: HoldingWithPrice = {
      ticker: 'CASH', name: '현금 (KRW)', shares: amount,
      avg_price_krw: 1, total_principal_krw: amount,
      current_price_krw: 1, market_value_krw: amount,
      profit_krw: 0, profit_pct: 0,
      sector: null, region: '한국', asset_group: '현금',
      price_source: '-', daily_change_pct: null, prev_close_krw: 1,
    };
    setHoldings(prev => {
      const withoutCash = prev.filter(h => h.ticker !== 'CASH');
      const updated = [...withoutCash, cashEntry].sort((a, b) => b.market_value_krw - a.market_value_krw);
      setSummary(calcSummary(updated));
      return updated;
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // 30-second polling for price refresh (silent, no loading state)
  useEffect(() => {
    const id = setInterval(() => load(true), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const patchSector = useCallback((ticker: string, sector: string | null) => {
    setTransactions(prev => prev.map(t => t.ticker === ticker ? { ...t, sector } : t));
    setHoldings(prev => prev.map(h => h.ticker === ticker ? { ...h, sector } : h));
  }, []);

  return { transactions, holdings, summary, usdKrw, status, isRefreshing, error, lastUpdated, reload: load, updateCash, patchSector };
}
