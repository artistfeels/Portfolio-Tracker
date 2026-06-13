import type { PriceResult } from './types';

const TROY_OZ_TO_GRAM = 31.1035;
const CACHE_TTL_MS = 30 * 1000;

interface CacheEntry {
  price_krw: number;
  daily_change_pct: number | null;
  prev_close_krw: number;
  display_name?: string;
  fetched_at: string;
}

const priceCache = new Map<string, CacheEntry>();

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

interface YahooResult {
  price: number | null;
  name?: string;
  prevClose: number | null;
  source?: 'yahoo' | 'naver';
}

async function fetchYahoo(symbol: string): Promise<YahooResult> {
  try {
    const res = await fetchWithTimeout(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    );
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    // previousClose(비조정)를 우선 사용. chartPreviousClose는 배당/분할 조정된 값이라
    // 브로커 표시값과 달라질 수 있으므로 폴백으로만 사용.
    const prevClose = meta?.previousClose ?? meta?.chartPreviousClose ?? null;
    return {
      price: typeof price === 'number' && price > 0 ? price : null,
      name: meta?.longName ?? meta?.shortName,
      prevClose: typeof prevClose === 'number' && prevClose > 0 ? prevClose : null,
    };
  } catch {
    return { price: null, prevClose: null };
  }
}

interface NaverResult {
  price: number | null;
  name?: string;
  prevClose: number | null;
}

// 네이버 파이낸스 실시간 시세 (한국 주식 .KS/.KQ). 종목코드 6자리.
async function fetchNaver(code: string): Promise<NaverResult> {
  try {
    const res = await fetchWithTimeout(
      `/api/naver/api/realtime?query=SERVICE_ITEM:${encodeURIComponent(code)}`
    );
    // Vite proxy는 raw bytes를 그대로 전달하므로 클라이언트에서도 인코딩 처리
    const buffer = await res.arrayBuffer();
    const ct = res.headers.get('content-type') ?? '';
    const encoding = /euc-kr/i.test(ct) ? 'euc-kr' : 'utf-8';
    let j: unknown;
    try {
      j = JSON.parse(new TextDecoder(encoding).decode(buffer));
    } catch {
      return { price: null, prevClose: null };
    }
    const data = (j as any)?.result?.areas?.[0]?.datas?.[0];
    if (!data) return { price: null, prevClose: null };
    // 네이버 polling API 필드 (실측 검증):
    //   nv  = 현재가 (current price)
    //   sv  = 전일종가 (= pcv, previous close)
    //   pcv = 전일종가
    //   cr  = 등락률(%), cv = 등락폭, ov = 시가, hv/lv = 고가/저가
    // 과거 코드는 sv(현재가)와 nv(전일종가)를 반대로 사용해 등락률 부호가 뒤집혔다.
    const price = Number(data.nv);
    const prevClose = Number(data.pcv ?? data.sv);
    return {
      price: isFinite(price) && price > 0 ? price : null,
      name: typeof data.nm === 'string' ? data.nm : undefined,
      prevClose: isFinite(prevClose) && prevClose > 0 ? prevClose : null,
    };
  } catch {
    return { price: null, prevClose: null };
  }
}

async function fetchKrStock(ticker: string): Promise<YahooResult> {
  // 1순위: 네이버 파이낸스 실시간 시세
  const naver = await fetchNaver(ticker);
  if (naver.price) {
    return {
      price: Math.round(naver.price),
      name: naver.name,
      prevClose: naver.prevClose ? Math.round(naver.prevClose) : null,
      source: 'naver',
    };
  }

  // 폴백: Yahoo Finance (전일 종가 기준)
  const suffix = KR_TICKER_SUFFIX[ticker];
  if (suffix) {
    const r = await fetchYahoo(`${ticker}.${suffix}`);
    if (r.price) return {
      price: Math.round(r.price),
      name: r.name,
      prevClose: r.prevClose ? Math.round(r.prevClose) : null,
    };
  }
  const ks = await fetchYahoo(`${ticker}.KS`);
  if (ks.price) return {
    price: Math.round(ks.price),
    name: ks.name,
    prevClose: ks.prevClose ? Math.round(ks.prevClose) : null,
  };
  const kq = await fetchYahoo(`${ticker}.KQ`);
  if (kq.price) return {
    price: Math.round(kq.price),
    name: kq.name,
    prevClose: kq.prevClose ? Math.round(kq.prevClose) : null,
  };
  return { price: null, prevClose: null };
}

function toYahooSym(ticker: string): string {
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}

export async function fetchPrice(ticker: string, usdKrwRate: number): Promise<PriceResult> {
  const now = new Date().toISOString();
  const cached = priceCache.get(ticker);
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return { ticker, ...cached, source: 'cache' };
  }

  let price_krw: number | null = null;
  let daily_change_pct: number | null = null;
  let prev_close_krw = 0;
  let display_name: string | undefined;
  let source: PriceResult['source'] = 'manual';

  if (ticker === 'GOLD') {
    const { price: gcUsd, name, prevClose } = await fetchYahoo('GC=F');
    source = 'yahoo';
    if (gcUsd) {
      price_krw = Math.round((gcUsd * usdKrwRate) / TROY_OZ_TO_GRAM);
      display_name = name ?? '금 현물';
      if (prevClose) {
        prev_close_krw = Math.round((prevClose * usdKrwRate) / TROY_OZ_TO_GRAM);
        daily_change_pct = (gcUsd - prevClose) / prevClose * 100;
      }
    }
  } else if (/^\d{6}$/.test(ticker)) {
    const { price, name, prevClose, source: krSource } = await fetchKrStock(ticker);
    source = krSource ?? 'yahoo';
    price_krw = price;
    display_name = name;
    if (price && prevClose) {
      prev_close_krw = prevClose;
      daily_change_pct = (price - prevClose) / prevClose * 100;
    }
  } else {
    const isHk = /^\d{4}$/.test(ticker);
    const { price: raw, name, prevClose } = await fetchYahoo(toYahooSym(ticker));
    source = 'yahoo';
    display_name = name;
    if (raw) {
      price_krw = isHk
        ? Math.round(raw * (usdKrwRate / 7.78))
        : Math.round(raw * usdKrwRate);
      if (prevClose) {
        prev_close_krw = isHk
          ? Math.round(prevClose * (usdKrwRate / 7.78))
          : Math.round(prevClose * usdKrwRate);
        daily_change_pct = (raw - prevClose) / prevClose * 100;
      }
    }
  }

  const result: PriceResult = {
    ticker,
    price_krw: price_krw ?? 0,
    daily_change_pct,
    prev_close_krw,
    source: price_krw ? source : 'manual',
    fetched_at: now,
    display_name,
  };

  if (price_krw) {
    priceCache.set(ticker, { price_krw, daily_change_pct, prev_close_krw, display_name, fetched_at: now });
  }
  return result;
}

export async function fetchUsdKrw(): Promise<number> {
  // frankfurter.app: ECB 기반 환율, IP 제한 없음, CORS 허용, 무료
  try {
    const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=KRW');
    const j = await res.json();
    const rate = j?.rates?.KRW;
    if (typeof rate === 'number' && rate > 100) return Math.round(rate);
  } catch { /* fall through */ }
  // Yahoo 폴백
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
    if (i < tickers.length - 1 && r.source !== 'cache') {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  return result;
}

export function toChartSymbol(ticker: string): string {
  if (ticker === 'GOLD') return 'GC=F';
  if (ticker === 'CASH') return '';
  if (/^\d{6}$/.test(ticker)) {
    const suffix = KR_TICKER_SUFFIX[ticker] ?? 'KS';
    return `${ticker}.${suffix}`;
  }
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}
