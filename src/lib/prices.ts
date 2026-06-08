import type { PriceResult } from './types';

const TROY_OZ_TO_GRAM = 31.1035;

const priceCache = new Map<string, { price_krw: number; fetched_at: string }>();

async function fetchWithTimeout(url: string, options: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ── Yahoo Finance (미국/홍콩/환율/금/한국) ─────────────────
async function fetchYahoo(symbol: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    );
    const j = await res.json();
    const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch { return null; }
}

// ── 한국 주식: Yahoo Finance (.KS = KOSPI, .KQ = KOSDAQ) ──
// 가격은 Yahoo가 이미 KRW로 반환 → 환율 변환 불필요
const KR_TICKER_SUFFIX: Record<string, string> = {
  '000660': 'KS', // SK하이닉스
  '368590': 'KS',
  '379780': 'KS',
  '102110': 'KS', // TIGER 미국나스닥100 ETF
  '411060': 'KS', // ACE 미국나스닥100 ETF
  '218410': 'KQ', // RFHIC (코스닥)
  '270810': 'KS', // KODEX 미국S&P500TR ETF
  '245710': 'KS',
  '385560': 'KS', // TIGER 차이나항셍테크 ETF
};

async function fetchKrStock(ticker: string): Promise<number | null> {
  const suffix = KR_TICKER_SUFFIX[ticker];
  if (suffix) {
    const price = await fetchYahoo(`${ticker}.${suffix}`);
    if (price) return Math.round(price);
  }
  // suffix 미등록 종목: .KS 시도 → .KQ 시도
  const fromKs = await fetchYahoo(`${ticker}.KS`);
  if (fromKs) return Math.round(fromKs);
  const fromKq = await fetchYahoo(`${ticker}.KQ`);
  if (fromKq) return Math.round(fromKq);
  return null;
}

function toYahooSym(ticker: string): string {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`; // 홍콩
  return ticker.toUpperCase();                        // 미국
}

// ── 단일 종목 시세 ────────────────────────────────────────
export async function fetchPrice(ticker: string, usdKrwRate: number): Promise<PriceResult> {
  const now = new Date().toISOString();
  const cached = priceCache.get(ticker);
  if (cached) return { ticker, ...cached, source: 'cache' };

  let price_krw: number | null = null;
  let source: PriceResult['source'] = 'manual';

  if (ticker === 'GOLD') {
    // 금현물(그램): XAUUSD=X(온스당$) × USDKRW ÷ 31.1035
    const xauUsd = await fetchYahoo('XAUUSD=X');
    if (xauUsd) price_krw = Math.round((xauUsd * usdKrwRate) / TROY_OZ_TO_GRAM);
    source = 'yahoo';
  } else if (/^\d{6}$/.test(ticker)) {
    // 6자리 숫자 = 한국 주식 (KRW 그대로 반환)
    price_krw = await fetchKrStock(ticker);
    source = 'yahoo';
  } else {
    const raw = await fetchYahoo(toYahooSym(ticker));
    source = 'yahoo';
    if (raw) {
      if (/^\d{4}$/.test(ticker)) {
        // 홍콩: HKD → KRW (HKD ≈ USD/7.78)
        price_krw = Math.round(raw * (usdKrwRate / 7.78));
      } else {
        // 미국: USD → KRW
        price_krw = Math.round(raw * usdKrwRate);
      }
    }
  }

  const result: PriceResult = {
    ticker,
    price_krw: price_krw ?? 0,
    source: price_krw ? source : 'manual',
    fetched_at: now,
  };
  if (price_krw) priceCache.set(ticker, { price_krw, fetched_at: now });
  return result;
}

// ── USD/KRW 환율 (Yahoo Finance USDKRW=X) ────────────────
export async function fetchUsdKrw(): Promise<number> {
  const v = await fetchYahoo('USDKRW=X');
  return v ?? 1380;
}

// ── 전체 종목 순차 fetch ──────────────────────────────────
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
