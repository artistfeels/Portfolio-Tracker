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
    .filter((t) => t.trade_date <= date && (t.action === 'buy' || t.action === 'sell'))
    .reduce((s, t) => s + (t.action === 'buy' ? 1 : -1) * t.shares * t.price_krw, 0);
}

function toYahooHistSym(ticker: string): string {
  if (ticker === 'GOLD') return 'GC=F';
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
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=1mo&period1=${period1}&period2=${period2}`,
      { signal: ctrl.signal }
    );
    clearTimeout(tid);
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

/** 월간 히스토리 빌드. maxYears 기본 3년 캡. */
export async function buildPortfolioHistory(
  transactions: Transaction[],
  usdKrw: number,
  maxYears = 3
): Promise<HistoryPoint[]> {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const firstDate = sorted[0].trade_date;

  // 3년 캡: 오래된 포트폴리오도 최근 3년만 계산
  const capMs = maxYears * 365.25 * 24 * 3600 * 1000;
  const startMs = Math.max(new Date(firstDate).getTime(), Date.now() - capMs);
  const period1 = Math.floor(startMs / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  const tickers = [...new Set(sorted.map((t) => t.ticker).filter((t) => t !== 'CASH'))];

  const closeMap = new Map<string, WeeklyClose[]>();
  // 동시 요청을 2개로 제한 (Yahoo rate limit 보호)
  for (let i = 0; i < tickers.length; i += 2) {
    const batch = tickers.slice(i, i + 2);
    await Promise.all(batch.map(async (ticker) => {
      const closes = await fetchWeeklyCloses(ticker, period1, period2, usdKrw);
      closeMap.set(ticker, closes);
    }));
  }

  // 월간 스냅샷 날짜 생성 (매월 1일 기준)
  const startDate = new Date(startMs);
  startDate.setDate(1);
  const months: string[] = [];
  const cur = new Date(startDate);
  const end = new Date();
  // 안전 상한: 월간 + maxYears 캡이면 최대 ~수십 개. 1000은 어떤 경우에도
  // 무한 루프를 차단하기 위한 방어선이다 (정상 경로에서는 절대 도달하지 않음).
  let guard = 0;
  while (cur <= end && guard < 1000) {
    months.push(cur.toISOString().slice(0, 10));
    cur.setMonth(cur.getMonth() + 1);
    guard++;
  }
  const endStr = end.toISOString().slice(0, 10);
  if (months[months.length - 1] !== endStr) months.push(endStr);

  return months.map((date) => {
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
