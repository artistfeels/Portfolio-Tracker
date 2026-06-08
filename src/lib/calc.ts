import type { Transaction, Holding } from './types';

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
