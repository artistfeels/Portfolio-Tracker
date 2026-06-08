// src/lib/prices.ts
import type { PriceResult } from './types';

const TROY_OZ_TO_GRAM = 31.1035;

const priceCache = new Map<string, { price_krw: number; display_name?: string; fetched_at: string }>();

export const KR_TICKER_SUFFIX: Record<string, string> = {
  '000660': 'KS',
  '368590': 'KS',
  '379780': 'KS',
  '102110': 'KS',
  '411060': 'KS',
  '218410': 'KQ',
  '270810': 'KS',
  '245710': 'KS',
  '385560': 'KS',
};

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// Yahoo Finance 단일 요청 → { price, name }
async function fetchYahoo(symbol: string): Promise<{ price: number | null; name?: string }> {
  try {
    const res = await fetchWithTimeout(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    );
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    return {
      price: typeof price === 'number' && price > 0 ? price : null,
      name: meta?.longName ?? meta?.shortName,
    };
  } catch {
    return { price: null };
  }
}

async function fetchKrStock(ticker: string): Promise<{ price: number | null; name?: string }> {
  const suffix = KR_TICKER_SUFFIX[ticker];
  if (suffix) {
    const r = await fetchYahoo(`${ticker}.${suffix}`);
    if (r.price) return { price: Math.round(r.price), name: r.name };
  }
  const ks = await fetchYahoo(`${ticker}.KS`);
  if (ks.price) return { price: Math.round(ks.price), name: ks.name };
  const kq = await fetchYahoo(`${ticker}.KQ`);
  if (kq.price) return { price: Math.round(kq.price), name: kq.name };
  return { price: null };
}

function toYahooSym(ticker: string): string {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}

export async function fetchPrice(ticker: string, usdKrwRate: number): Promise<PriceResult> {
  const now = new Date().toISOString();
  const cached = priceCache.get(ticker);
  if (cached) return { ticker, ...cached, source: 'cache' };

  let price_krw: number | null = null;
  let display_name: string | undefined;
  let source: PriceResult['source'] = 'manual';

  if (ticker === 'GOLD') {
    const { price: xauUsd, name } = await fetchYahoo('XAUUSD=X');
    if (xauUsd) {
      price_krw = Math.round((xauUsd * usdKrwRate) / TROY_OZ_TO_GRAM);
      display_name = name ?? '금 현물';
    }
    source = 'yahoo';
  } else if (/^\d{6}$/.test(ticker)) {
    const { price, name } = await fetchKrStock(ticker);
    price_krw = price;
    display_name = name;
    source = 'yahoo';
  } else {
    const { price: raw, name } = await fetchYahoo(toYahooSym(ticker));
    display_name = name;
    source = 'yahoo';
    if (raw) {
      price_krw = /^\d{4}$/.test(ticker)
        ? Math.round(raw * (usdKrwRate / 7.78))
        : Math.round(raw * usdKrwRate);
    }
  }

  const result: PriceResult = {
    ticker,
    price_krw: price_krw ?? 0,
    source: price_krw ? source : 'manual',
    fetched_at: now,
    display_name,
  };
  if (price_krw) priceCache.set(ticker, { price_krw, display_name, fetched_at: now });
  return result;
}

export async function fetchUsdKrw(): Promise<number> {
  const { price } = await fetchYahoo('USDKRW=X');
  return price ?? 1380;
}

export async function fetchAllPrices(
  tickers: string[],
  usdKrwRate: number,
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, PriceResult>> {
  const result = new Map<string, PriceResult>();
  for (let i = 0; i < tickers.length; i++) {
    const r = await fetchPrice(tickers[i], usdKrwRate);
    result.set(tickers[i], r);
    onProgress?.(i + 1, tickers.length);
    if (i < tickers.length - 1) await new Promise((res) => setTimeout(res, 200));
  }
  return result;
}

// 차트용 Yahoo 심볼 반환 (GOLD, KR, HK, US)
export function toChartSymbol(ticker: string): string {
  if (ticker === 'GOLD') return 'XAUUSD=X';
  if (ticker === 'CASH') return '';
  if (/^\d{6}$/.test(ticker)) {
    const suffix = KR_TICKER_SUFFIX[ticker] ?? 'KS';
    return `${ticker}.${suffix}`;
  }
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}
