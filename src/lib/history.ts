// src/lib/history.ts
import type { Transaction, HistoryPoint } from './types';
import { KR_TICKER_SUFFIX } from './prices';

export function calcHoldingsAtDate(
  transactions: Transaction[],
  date: string
): Map<string, number> {
  const holdings = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.trade_date > date) continue;
    const prev = holdings.get(tx.ticker) ?? 0;
    if (tx.action === 'buy') {
      holdings.set(tx.ticker, prev + tx.shares);
    // dividend and split actions intentionally skipped — split ratio tracking not supported
    } else if (tx.action === 'sell') {
      const next = prev - tx.shares;
      if (next <= 0) holdings.delete(tx.ticker);
      else holdings.set(tx.ticker, next);
    }
  }
  return holdings;
}

export function calcInvestedAtDate(transactions: Transaction[], date: string): number {
  return transactions
    .filter((t) => t.trade_date <= date && t.action === 'buy')
    .reduce((s, t) => s + t.shares * t.price_krw, 0);
}

function toYahooHistSym(ticker: string): string {
  if (ticker === 'GOLD') return 'XAUUSD=X';
  if (/^\d{6}$/.test(ticker)) {
    const suffix = KR_TICKER_SUFFIX[ticker] ?? 'KS';
    return `${ticker}.${suffix}`;
  }
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}

interface WeeklyClose {
  date: string;
  closeKrw: number;
  currency: string;
}

async function fetchWeeklyCloses(
  ticker: string,
  period1: number,
  period2: number,
  usdKrw: number
): Promise<WeeklyClose[]> {
  const sym = toYahooHistSym(ticker);
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&period1=${period1}&period2=${period2}`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];

    const currency: string = result.meta?.currency ?? 'USD';
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    return timestamps
      .map((ts, i) => {
        const close = closes[i];
        if (!close || close <= 0) return null;
        const date = new Date(ts * 1000).toISOString().slice(0, 10);
        let closeKrw: number;
        if (currency === 'KRW') {
          closeKrw = Math.round(close);
        } else if (ticker === 'GOLD') {
          closeKrw = Math.round((close * usdKrw) / 31.1035);
        } else if (/^\d{4}$/.test(ticker)) {
          closeKrw = Math.round(close * (usdKrw / 7.78));
        } else {
          closeKrw = Math.round(close * usdKrw);
        }
        return { date, closeKrw, currency };
      })
      .filter((v): v is WeeklyClose => v !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

function lookupClose(closes: WeeklyClose[], date: string): number | null {
  let best: WeeklyClose | null = null;
  for (const c of closes) {
    if (c.date <= date) best = c;
    else break;
  }
  return best?.closeKrw ?? null;
}

export async function buildPortfolioHistory(
  transactions: Transaction[],
  usdKrw: number
): Promise<HistoryPoint[]> {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const firstDate = sorted[0].trade_date;
  const period1 = Math.floor(new Date(firstDate).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  const tickers = [...new Set(sorted.map((t) => t.ticker).filter((t) => t !== 'CASH'))];

  const closeMap = new Map<string, WeeklyClose[]>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const closes = await fetchWeeklyCloses(ticker, period1, period2, usdKrw);
      closeMap.set(ticker, closes);
    })
  );

  const weeks: string[] = [];
  const cur = new Date(firstDate);
  const end = new Date();
  while (cur <= end) {
    weeks.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 7);
  }
  const endStr = end.toISOString().slice(0, 10);
  if (weeks[weeks.length - 1] !== endStr) {
    weeks.push(endStr);
  }

  return weeks.map((date) => {
    const holdings = calcHoldingsAtDate(transactions, date);
    let value_krw = 0;
    for (const [ticker, shares] of holdings.entries()) {
      if (ticker === 'CASH') continue;
      const closes = closeMap.get(ticker);
      if (!closes) continue;
      const price = lookupClose(closes, date);
      if (price) value_krw += price * shares;
    }
    const invested_krw = calcInvestedAtDate(transactions, date);
    return { date, value_krw: Math.round(value_krw), invested_krw: Math.round(invested_krw) };
  }).filter((p) => p.value_krw > 0 || p.invested_krw > 0);
}
