import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { calcHoldings, calcSummary } from '../lib/calc';
import { fetchAllPrices, fetchUsdKrw } from '../lib/prices';
import type { Transaction, HoldingWithPrice } from '../lib/types';
export type LoadStatus = 'idle' | 'loading-db' | 'loading-prices' | 'done' | 'error';

export function usePortfolio() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [holdings, setHoldings] = useState<HoldingWithPrice[]>([]);
  const [summary, setSummary] = useState({ totalValue: 0, totalPrincipal: 0, totalProfit: 0, profitPct: 0 });
  const [usdKrw, setUsdKrw] = useState(0);
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus('loading-db');
      setError(null);

      // 1) 거래내역 전체 로드
      const { data, error: dbErr } = await supabase
        .from('transactions')
        .select('*')
        .order('trade_date', { ascending: true });

      if (dbErr) throw new Error('DB 오류: ' + dbErr.message);
      const txs = (data ?? []) as Transaction[];
      setTransactions(txs);

      // 2) 보유종목 산출
      const rawHoldings = calcHoldings(txs);

      // 3) 환율 먼저
      setStatus('loading-prices');
      const rate = await fetchUsdKrw();
      setUsdKrw(rate);

      // 4) 시세 fetch + 현금 잔고 병렬 로드
      const tickers = rawHoldings.map((h) => h.ticker);
      setProgress({ done: 0, total: tickers.length });

      const [prices, cashResult] = await Promise.all([
        fetchAllPrices(tickers, rate, (done, total) => setProgress({ done, total })),
        supabase.from('cash_balance').select('amount_krw'),
      ]);

      const cashBalance = cashResult.data
        ? cashResult.data.reduce((sum: number, r: { amount_krw: number }) => sum + (r.amount_krw ?? 0), 0)
        : 0;

      // 5) 보유종목에 시세 붙이기
      const withPrices: HoldingWithPrice[] = rawHoldings.map((h) => {
        const p = prices.get(h.ticker);
        const current = p?.price_krw ?? 0;
        const marketVal = Math.round(current * h.shares);
        const profit = marketVal - h.total_principal_krw;
        const profitPct = h.total_principal_krw > 0 ? (profit / h.total_principal_krw) * 100 : 0;
        return {
          ...h,
          name: p?.display_name ?? h.name,   // Yahoo longName 우선
          current_price_krw: current,
          market_value_krw: marketVal,
          profit_krw: profit,
          profit_pct: profitPct,
          price_source: p?.source ?? 'manual',
        };
      });

      // 현금 잔고를 가상 보유종목으로 추가
      if (cashBalance > 0) {
        withPrices.push({
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
        });
      }

      // 평가금액 내림차순 정렬
      withPrices.sort((a, b) => b.market_value_krw - a.market_value_krw);
      setHoldings(withPrices);
      setSummary(calcSummary(withPrices));
      setStatus('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { transactions, holdings, summary, usdKrw, status, progress, error, reload: load };
}
