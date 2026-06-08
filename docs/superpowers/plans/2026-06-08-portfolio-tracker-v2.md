# Portfolio Tracker v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사이드바 네비게이션 기반 3-페이지 앱으로 확장 — 대시보드 개선(실제 종목명·인라인 차트), 거래내역(CSV), 애널리틱스(자산추이·IRR).

**Architecture:** 외부 라우터 없이 `App.tsx`의 `useState<Page>`로 페이지 전환. 모든 시세는 Vite proxy를 통해 Yahoo Finance에서 fetch. 차트는 `lightweight-charts` (TradingView 오픈소스). 순수 계산 함수(IRR·히스토리)는 `lib/`에 분리해 Vitest로 단위 테스트.

**Tech Stack:** React 19, TypeScript, Vite, Supabase, lightweight-charts, papaparse (이미 설치됨), Vitest

---

## File Map

```
src/
  components/
    Sidebar.tsx          신규 — 사이드바 네비게이션
    ChartPanel.tsx       신규 — 종목 인라인 캔들스틱 차트
  pages/
    Dashboard.tsx        수정 — 종목명/티커 순서, 차트 확장, CASH/GOLD
    Analytics.tsx        신규 — 자산추이·수익률·IRR 페이지
    Transactions.tsx     신규 — 거래내역 테이블 + CSV
  lib/
    types.ts             수정 — Page, HistoryPoint, IrrResult 타입 추가
    prices.ts            수정 — fetchYahoo → {price,name} 반환, GOLD 수정
    calc.ts              수정 — IRR 솔버 추가
    history.ts           신규 — Yahoo 주봉 시세 + 포트폴리오 가치 계산
    csv.ts               신규 — CSV 생성·파싱
    supabaseClient.ts    유지
  hooks/
    usePortfolio.ts      수정 — display_name 반영
    useAnalytics.ts      신규 — 애널리틱스 데이터 훅
  App.tsx                수정 — Sidebar + 페이지 라우팅
tests/
  calc.test.ts           신규
  csv.test.ts            신규
  history.test.ts        신규
```

---

## Task 1: 패키지 설치 + Vitest 설정 + types.ts 확장

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/calc.test.ts` (placeholder)
- Modify: `src/lib/types.ts`

- [ ] **Step 1: lightweight-charts 설치**

```bash
npm install lightweight-charts
```

Expected: `node_modules/lightweight-charts` 생성

- [ ] **Step 2: Vitest 설치**

```bash
npm install -D vitest
```

- [ ] **Step 3: vitest.config.ts 생성**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 4: package.json에 test 스크립트 추가**

`package.json`의 `"scripts"` 블록에 추가:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: types.ts 전체 교체**

```typescript
// src/lib/types.ts
export type Page = 'dashboard' | 'analytics' | 'transactions';

export interface Transaction {
  id: string;
  ticker: string;
  name: string;
  action: 'buy' | 'sell' | 'dividend' | 'split';
  shares: number;
  price_krw: number;
  trade_date: string;
  sector: string | null;
  region: '한국' | '해외';
  asset_group: string | null;
  funding_source: string | null;
  notes: string | null;
}

export interface Holding {
  ticker: string;
  name: string;
  shares: number;
  avg_price_krw: number;
  total_principal_krw: number;
  sector: string | null;
  region: '한국' | '해외';
  asset_group: string | null;
}

export interface PriceResult {
  ticker: string;
  price_krw: number;
  source: 'yahoo' | 'cache' | 'manual';
  fetched_at: string;
  display_name?: string;
}

export interface HoldingWithPrice extends Holding {
  current_price_krw: number;
  market_value_krw: number;
  profit_krw: number;
  profit_pct: number;
  price_source: string;
}

export interface HistoryPoint {
  date: string;         // 'YYYY-MM-DD'
  value_krw: number;    // 해당 날짜의 총 포트폴리오 평가금액
  invested_krw: number; // 해당 날짜까지의 누적 투자 원금
}

export interface IrrResult {
  ticker: string;
  name: string;
  irr: number | null;          // 연 IRR (0.143 = 14.3%)
  invested_krw: number;        // 총 투자 원금
  current_value_krw: number;   // 현재 평가금액
  first_date: string;
}
```

- [ ] **Step 6: 빈 테스트 파일 생성해 Vitest 동작 확인**

```typescript
// tests/calc.test.ts
import { describe, it, expect } from 'vitest';
describe('placeholder', () => { it('runs', () => { expect(1).toBe(1); }); });
```

- [ ] **Step 7: 테스트 실행 확인**

```bash
npm test
```

Expected: `✓ tests/calc.test.ts > placeholder > runs`

- [ ] **Step 8: Commit**

```bash
git add package.json vitest.config.ts tests/calc.test.ts src/lib/types.ts
git commit -m "feat: add lightweight-charts, vitest; expand types"
```

---

## Task 2: GOLD 버그 수정 + prices.ts 리팩터

**Files:**
- Modify: `src/lib/prices.ts`

현재 `fetchYahoo`는 `number | null` 반환 → `{ price: number | null; name?: string }` 로 변경.
GOLD가 `manual`로 표시되는 원인: `fetchYahoo` 리팩터 후 callers가 객체를 숫자로 취급해 falsy → price 0 → source='manual'.

- [ ] **Step 1: prices.ts 전체 교체**

```typescript
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

// Yahoo Finance 단일 요청 → { price, name, rawPrice }
// rawPrice: 통화 변환 전 원본값 (XAUUSD=X의 경우 USD/oz)
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
  if (/^\d{6}$/.test(ticker)) {
    const suffix = KR_TICKER_SUFFIX[ticker] ?? 'KS';
    return `${ticker}.${suffix}`;
  }
  if (/^\d{4}$/.test(ticker)) return `${ticker}.HK`;
  return ticker.toUpperCase();
}
```

- [ ] **Step 2: usePortfolio.ts에서 display_name 활용 — holding name 덮어쓰기**

`src/hooks/usePortfolio.ts`의 `withPrices` 빌드 부분 수정:

```typescript
const withPrices: HoldingWithPrice[] = rawHoldings.map((h) => {
  const p = prices.get(h.ticker);
  const current = p?.price_krw ?? 0;
  const marketVal = Math.round(current * h.shares);
  const profit = marketVal - h.total_principal_krw;
  const profitPct = h.total_principal_krw > 0 ? (profit / h.total_principal_krw) * 100 : 0;
  return {
    ...h,
    name: p?.display_name ?? h.name,   // ← Yahoo longName 우선
    current_price_krw: current,
    market_value_krw: marketVal,
    profit_krw: profit,
    profit_pct: profitPct,
    price_source: p?.source ?? 'manual',
  };
});
```

- [ ] **Step 3: dev 서버 실행 후 브라우저 확인**

```bash
npm run dev
```

확인 사항:
1. GOLD 행의 `price_source` 컬럼이 `yahoo`로 표시되는지
2. 콘솔에 오류 없는지 (특히 XAUUSD=X fetch)
3. 종목명이 Yahoo longName으로 표시되는지

GOLD가 여전히 manual이면: Supabase에서 `SELECT * FROM transactions WHERE ticker='GOLD'` 확인.
거래가 없으면 GOLD가 목록에 안 나오는 게 정상 → 거래 INSERT 후 재확인.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prices.ts src/hooks/usePortfolio.ts
git commit -m "fix: fetchYahoo returns {price,name}; GOLD/CASH display_name"
```

---

## Task 3: Sidebar.tsx + App.tsx 라우팅

**Files:**
- Create: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Sidebar.tsx 생성**

```tsx
// src/components/Sidebar.tsx
import type { Page } from '../lib/types';

interface Props {
  current: Page;
  onNavigate: (p: Page) => void;
}

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard',    icon: '📊', label: '대시보드' },
  { page: 'analytics',   icon: '📈', label: '애널리틱스' },
  { page: 'transactions', icon: '📄', label: '거래내역' },
];

export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <nav style={{
      width: 140,
      minHeight: '100vh',
      background: '#010409',
      borderRight: '1px solid #21262d',
      padding: '24px 0',
      flexShrink: 0,
    }}>
      <div style={{ padding: '0 16px 24px', fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
        Portfolio
      </div>
      {items.map(({ page, icon, label }) => (
        <button
          key={page}
          onClick={() => onNavigate(page)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '10px 16px',
            background: current === page ? '#21262d' : 'transparent',
            border: 'none',
            borderLeft: current === page ? '2px solid #58a6ff' : '2px solid transparent',
            color: current === page ? '#e6edf3' : '#8b949e',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: App.tsx 업데이트**

```tsx
// src/App.tsx
import { useState } from 'react';
import type { Page } from './lib/types';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Transactions from './pages/Transactions';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'sans-serif' }}>
      <Sidebar current={page} onNavigate={setPage} />
      <main style={{ flex: 1, overflow: 'auto' }}>
        {page === 'dashboard'    && <Dashboard />}
        {page === 'analytics'   && <Analytics />}
        {page === 'transactions' && <Transactions />}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Analytics.tsx, Transactions.tsx 플레이스홀더 생성 (빌드 오류 방지)**

```tsx
// src/pages/Analytics.tsx
export default function Analytics() {
  return <div style={{ padding: 32, color: '#8b949e' }}>애널리틱스 (준비 중)</div>;
}
```

```tsx
// src/pages/Transactions.tsx
export default function Transactions() {
  return <div style={{ padding: 32, color: '#8b949e' }}>거래내역 (준비 중)</div>;
}
```

- [ ] **Step 4: Dashboard.tsx에서 최상위 layout 제거**

`Dashboard.tsx`의 `<div style={{ ... minHeight: '100vh' ... }}>` 에서 `minHeight` 및 `background`, `fontFamily` 스타일 제거 (App.tsx가 담당):

```tsx
// Dashboard.tsx 최상위 div — 기존
<div style={{ padding: '24px 32px', fontFamily: 'sans-serif', background: '#0d1117', minHeight: '100vh', color: '#e6edf3' }}>

// 변경 후
<div style={{ padding: '24px 32px' }}>
```

- [ ] **Step 5: 브라우저에서 사이드바 + 페이지 전환 확인**

```bash
npm run dev
```

확인: 사이드바 3개 메뉴 클릭 시 페이지 전환되는지

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/App.tsx src/pages/Analytics.tsx src/pages/Transactions.tsx
git commit -m "feat: sidebar navigation and page routing"
```

---

## Task 4: Dashboard — 종목명/티커 순서 교체

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: 종목 셀 렌더링 수정**

`Dashboard.tsx`의 `<tbody>` 내 종목 셀을 아래로 교체:

```tsx
<td style={{ padding: '10px 14px' }}>
  <div style={{ fontWeight: 600, fontSize: 14 }}>{h.name}</div>
  <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{h.ticker}</div>
</td>
```

- [ ] **Step 2: 브라우저 확인**

대시보드에서 종목명이 위(bold), 티커가 아래(회색 작은 글씨)로 표시되는지 확인.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "fix: show display name above ticker in holdings table"
```

---

## Task 5: ChartPanel.tsx — 인라인 캔들스틱 차트

**Files:**
- Create: `src/components/ChartPanel.tsx`
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: ChartPanel.tsx 생성**

```tsx
// src/components/ChartPanel.tsx
import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries } from 'lightweight-charts';
import { toChartSymbol } from '../lib/prices';

interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  ticker: string;
  name: string;
}

async function fetchCandles(yahooSym: string): Promise<Candle[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=1y`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const opens: number[] = quote.open ?? [];
    const highs: number[] = quote.high ?? [];
    const lows: number[] = quote.low ?? [];
    const closes: number[] = quote.close ?? [];
    return timestamps
      .map((ts, i) => ({
        time: new Date(ts * 1000).toISOString().slice(0, 10) as string,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
      }))
      .filter((c) => c.open && c.high && c.low && c.close)
      .sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return [];
  }
}

export default function ChartPanel({ ticker, name }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const sym = toChartSymbol(ticker);
    if (!sym) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 300,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d', timeVisible: true },
      rightPriceScale: { borderColor: '#30363d' },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#cf222e',
      downColor: '#1f6feb',
      borderUpColor: '#cf222e',
      borderDownColor: '#1f6feb',
      wickUpColor: '#cf222e',
      wickDownColor: '#1f6feb',
    });

    fetchCandles(sym).then((candles) => {
      if (candles.length === 0) { setError(true); setLoading(false); return; }
      series.setData(candles);
      chart.timeScale().fitContent();
      setLoading(false);
    });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => { chart.remove(); ro.disconnect(); };
  }, [ticker]);

  return (
    <div style={{ padding: '12px 14px 16px', background: '#0d1117', borderTop: '1px solid #21262d' }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>
        {name} — 1년 일봉
      </div>
      {loading && !error && <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>차트 로딩 중...</div>}
      {error && <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>차트 데이터를 불러올 수 없습니다.</div>}
      <div ref={containerRef} style={{ display: loading || error ? 'none' : 'block' }} />
    </div>
  );
}
```

- [ ] **Step 2: Dashboard.tsx에 selectedTicker 상태 + ChartPanel 통합**

`Dashboard.tsx` 상단 import에 추가:
```tsx
import { useState } from 'react';
import ChartPanel from '../components/ChartPanel';
```

`Dashboard()` 함수 내부 상단에 추가:
```tsx
const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
```

`<tbody>` 내 `<tr>`에 onClick 추가:
```tsx
<tr
  key={h.ticker}
  onClick={() => setSelectedTicker(selectedTicker === h.ticker ? null : h.ticker)}
  style={{
    borderTop: '1px solid #21262d',
    background: selectedTicker === h.ticker ? '#1c2128' : (i % 2 === 0 ? 'transparent' : '#0d1117'),
    cursor: isCash ? 'default' : 'pointer',
  }}
>
```

`</tr>` 닫는 태그 뒤에 ChartPanel 행 추가:
```tsx
{selectedTicker === h.ticker && !isCash && (
  <tr key={`${h.ticker}-chart`}>
    <td colSpan={9} style={{ padding: 0 }}>
      <ChartPanel ticker={h.ticker} name={h.name} />
    </td>
  </tr>
)}
```

- [ ] **Step 3: 브라우저에서 차트 확인**

종목 행 클릭 시 아래에 캔들스틱 차트가 펼쳐지는지 확인.
같은 행 재클릭 시 닫히는지 확인.
CASH 행은 클릭해도 차트 안 뜨는지 확인.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChartPanel.tsx src/pages/Dashboard.tsx
git commit -m "feat: inline candlestick chart on holding row click"
```

---

## Task 6: csv.ts — CSV 유틸리티

**Files:**
- Create: `src/lib/csv.ts`
- Create: `tests/csv.test.ts`

- [ ] **Step 1: 실패하는 테스트 먼저 작성**

```typescript
// tests/csv.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsvToTransactions, generateTemplateCsv } from '../src/lib/csv';

describe('parseCsvToTransactions', () => {
  it('단일 행 파싱', () => {
    const csv = `trade_date,ticker,name,action,shares,price_krw,sector,region,asset_group,funding_source,notes
2024-01-15,000660,SK하이닉스,buy,10,165000,반도체,한국,,, `;
    const rows = parseCsvToTransactions(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe('000660');
    expect(rows[0].action).toBe('buy');
    expect(rows[0].shares).toBe(10);
    expect(rows[0].price_krw).toBe(165000);
    expect(rows[0].region).toBe('한국');
  });

  it('빈 행 무시', () => {
    const csv = `trade_date,ticker,name,action,shares,price_krw,sector,region,asset_group,funding_source,notes
2024-01-15,NVDA,NVIDIA,buy,5,623000,,해외,,,

`;
    const rows = parseCsvToTransactions(csv);
    expect(rows).toHaveLength(1);
  });

  it('헤더만 있는 경우 빈 배열', () => {
    const csv = `trade_date,ticker,name,action,shares,price_krw,sector,region,asset_group,funding_source,notes`;
    expect(parseCsvToTransactions(csv)).toHaveLength(0);
  });
});

describe('generateTemplateCsv', () => {
  it('헤더 포함 예시 행 2개 반환', () => {
    const csv = generateTemplateCsv();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('trade_date');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../src/lib/csv'`

- [ ] **Step 3: csv.ts 구현**

```typescript
// src/lib/csv.ts
import Papa from 'papaparse';
import type { Transaction } from './types';

const HEADERS = [
  'trade_date', 'ticker', 'name', 'action', 'shares',
  'price_krw', 'sector', 'region', 'asset_group', 'funding_source', 'notes',
] as const;

export function generateTemplateCsv(): string {
  const rows = [
    HEADERS.join(','),
    '2024-01-15,000660,SK하이닉스,buy,10,165000,반도체,한국,주식,,',
    '2024-03-20,NVDA,NVIDIA,buy,5,623000,기술,해외,주식,,',
  ];
  return rows.join('\n') + '\n';
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseCsvToTransactions(csvText: string): Omit<Transaction, 'id'>[] {
  const { data } = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return data
    .filter((row) => row.trade_date && row.ticker && row.action)
    .map((row) => ({
      ticker: row.ticker.trim(),
      name: row.name?.trim() ?? '',
      action: row.action.trim() as Transaction['action'],
      shares: parseFloat(row.shares) || 0,
      price_krw: parseFloat(row.price_krw) || 0,
      trade_date: row.trade_date.trim(),
      sector: row.sector?.trim() || null,
      region: (row.region?.trim() === '해외' ? '해외' : '한국') as Transaction['region'],
      asset_group: row.asset_group?.trim() || null,
      funding_source: row.funding_source?.trim() || null,
      notes: row.notes?.trim() || null,
    }));
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
```

Expected: `✓ tests/csv.test.ts` — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/csv.ts tests/csv.test.ts
git commit -m "feat: csv utilities (template, parse, download) with tests"
```

---

## Task 7: Transactions.tsx — 거래내역 페이지

**Files:**
- Modify: `src/pages/Transactions.tsx`

- [ ] **Step 1: Transactions.tsx 전체 구현**

```tsx
// src/pages/Transactions.tsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateTemplateCsv, downloadCsv, parseCsvToTransactions } from '../lib/csv';
import type { Transaction } from '../lib/types';

const ACTION_LABEL: Record<string, string> = {
  buy: '매수', sell: '매도', dividend: '배당', split: '분할',
};
const ACTION_COLOR: Record<string, string> = {
  buy: '#cf222e', sell: '#1f6feb', dividend: '#3fb950', split: '#8b949e',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export default function Transactions() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<Omit<Transaction, 'id'>[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .order('trade_date', { ascending: false });
    setRows((data ?? []) as Transaction[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function handleDownload() {
    downloadCsv('transactions_template.csv', generateTemplateCsv());
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsvToTransactions(text);
      setPreview(parsed);
      setUploadResult(null);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  async function handleConfirmUpload() {
    if (!preview) return;
    setUploading(true);
    const { error } = await supabase.from('transactions').insert(preview);
    if (error) {
      setUploadResult(`오류: ${error.message}`);
    } else {
      setUploadResult(`✓ ${preview.length}건 추가됨`);
      setPreview(null);
      load();
    }
    setUploading(false);
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* 헤더 툴바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>거래내역</span>
        <span style={{ color: '#8b949e', fontSize: 13, flex: 1 }}>총 {rows.length}건</span>
        <button
          onClick={handleDownload}
          style={{ background: '#238636', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬇ CSV 템플릿
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          style={{ background: '#1f6feb', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬆ CSV 업로드
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {uploadResult && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 13, color: uploadResult.startsWith('오류') ? '#cf222e' : '#3fb950' }}>
          {uploadResult}
        </div>
      )}

      {/* 업로드 미리보기 모달 */}
      {preview && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 24, width: 600, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>업로드 미리보기 — {preview.length}건</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#21262d', color: '#8b949e' }}>
                  {['날짜', '티커', '종목명', '구분', '수량', '단가'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
                    <td style={{ padding: '5px 10px' }}>{r.trade_date}</td>
                    <td style={{ padding: '5px 10px' }}>{r.ticker}</td>
                    <td style={{ padding: '5px 10px' }}>{r.name}</td>
                    <td style={{ padding: '5px 10px', color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action]}</td>
                    <td style={{ padding: '5px 10px' }}>{r.shares}</td>
                    <td style={{ padding: '5px 10px' }}>{fmt(r.price_krw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 && <div style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>… 외 {preview.length - 20}건</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={handleConfirmUpload}
                disabled={uploading}
                style={{ background: '#238636', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                {uploading ? '업로드 중...' : '확인 — Supabase에 추가'}
              </button>
              <button
                onClick={() => setPreview(null)}
                style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거래내역 테이블 */}
      {loading ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>로딩 중...</div>
      ) : (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#21262d', color: '#8b949e' }}>
                {['날짜', '종목명', '티커', '구분', '수량', '단가(KRW)', '섹터', '지역'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ borderTop: '1px solid #21262d', background: i % 2 === 0 ? 'transparent' : '#0d1117' }}>
                  <td style={{ padding: '8px 14px' }}>{r.trade_date}</td>
                  <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                  <td style={{ padding: '8px 14px', color: '#8b949e', fontSize: 11 }}>{r.ticker}</td>
                  <td style={{ padding: '8px 14px', color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action]}</td>
                  <td style={{ padding: '8px 14px' }}>{r.shares.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{fmt(r.price_krw)}</td>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>{r.sector ?? '-'}</td>
                  <td style={{ padding: '8px 14px' }}>{r.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 브라우저에서 거래내역 페이지 확인**

1. 사이드바 "거래내역" 클릭 → 테이블 로드
2. "CSV 템플릿" 버튼 → `transactions_template.csv` 다운로드 확인
3. 템플릿 수정 후 "CSV 업로드" → 미리보기 모달 → 확인

- [ ] **Step 3: Commit**

```bash
git add src/pages/Transactions.tsx
git commit -m "feat: transactions page with CSV download/upload"
```

---

## Task 8: calc.ts — IRR 솔버

**Files:**
- Modify: `src/lib/calc.ts`
- Modify: `tests/calc.test.ts`

- [ ] **Step 1: IRR 테스트 작성**

`tests/calc.test.ts` 전체 교체:

```typescript
import { describe, it, expect } from 'vitest';
import { calcIrr, calcPortfolioIrr, calcHoldingIrrs } from '../src/lib/calc';
import type { Transaction, HoldingWithPrice } from '../src/lib/types';

describe('calcIrr', () => {
  it('단순 2년 2배 케이스 → IRR ≈ 41.4%', () => {
    // 매수 -1000, 2년 후 매도 +2000
    const cfs = [
      { date: new Date('2022-01-01'), amount: -1000 },
      { date: new Date('2024-01-01'), amount: 2000 },
    ];
    const irr = calcIrr(cfs);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.414, 2);
  });

  it('현금흐름이 1개이면 null 반환', () => {
    const cfs = [{ date: new Date('2022-01-01'), amount: -1000 }];
    expect(calcIrr(cfs)).toBeNull();
  });

  it('수익 없는 케이스 → IRR = -100% 근처', () => {
    const cfs = [
      { date: new Date('2022-01-01'), amount: -1000 },
      { date: new Date('2024-01-01'), amount: 10 },
    ];
    const irr = calcIrr(cfs);
    expect(irr).not.toBeNull();
    expect(irr!).toBeLessThan(0);
  });
});

describe('calcPortfolioIrr', () => {
  it('단순 포트폴리오 IRR 반환', () => {
    const txs: Transaction[] = [
      { id: '1', ticker: 'AAPL', name: 'Apple', action: 'buy', shares: 10, price_krw: 100000,
        trade_date: '2023-01-01', sector: null, region: '해외', asset_group: null, funding_source: null, notes: null },
    ];
    const holdings: HoldingWithPrice[] = [
      { ticker: 'AAPL', name: 'Apple', shares: 10, avg_price_krw: 100000,
        total_principal_krw: 1000000, current_price_krw: 150000, market_value_krw: 1500000,
        profit_krw: 500000, profit_pct: 50, sector: null, region: '해외',
        asset_group: null, price_source: 'yahoo' },
    ];
    const irr = calcPortfolioIrr(txs, holdings);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test
```

Expected: FAIL — `calcIrr is not exported`

- [ ] **Step 3: calc.ts에 IRR 함수 추가**

먼저 `src/lib/calc.ts` 상단 import 줄을 교체:
```typescript
// 기존
import type { Transaction, Holding } from './types';
// 변경
import type { Transaction, Holding, HoldingWithPrice, IrrResult } from './types';
```

그 다음 파일 끝에 아래 코드 추가:

```typescript
interface Cashflow {
  date: Date;
  amount: number; // 매수 = 음수, 매도/배당/현재가 = 양수
}

// 이분법으로 IRR 계산. 해를 찾지 못하면 null 반환.
export function calcIrr(cashflows: Cashflow[]): number | null {
  if (cashflows.length < 2) return null;
  const sorted = [...cashflows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

  function npv(r: number): number {
    return sorted.reduce((s, cf) => {
      const years = (cf.date.getTime() - t0) / MS_PER_YEAR;
      return s + cf.amount / Math.pow(1 + r, years);
    }, 0);
  }

  let lo = -0.999, hi = 100;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid; else hi = mid;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

export function calcPortfolioIrr(
  transactions: Transaction[],
  holdings: HoldingWithPrice[]
): number | null {
  const cashflows: Cashflow[] = [];
  const today = new Date();

  for (const tx of transactions) {
    const date = new Date(tx.trade_date);
    if (tx.action === 'buy') {
      cashflows.push({ date, amount: -(tx.shares * tx.price_krw) });
    } else if (tx.action === 'sell' || tx.action === 'dividend') {
      cashflows.push({ date, amount: tx.shares * tx.price_krw });
    }
  }
  // 현재 보유 종목의 평가금액을 오늘 날짜 현금흐름으로 추가
  for (const h of holdings) {
    if (h.ticker === 'CASH') continue;
    if (h.market_value_krw > 0) {
      cashflows.push({ date: today, amount: h.market_value_krw });
    }
  }
  return calcIrr(cashflows);
}

export function calcHoldingIrrs(
  transactions: Transaction[],
  holdings: HoldingWithPrice[]
): IrrResult[] {
  return holdings
    .filter((h) => h.ticker !== 'CASH')
    .map((h) => {
      const txs = transactions.filter((t) => t.ticker === h.ticker);
      const cfs: Cashflow[] = txs.map((t) => ({
        date: new Date(t.trade_date),
        amount:
          t.action === 'buy' ? -(t.shares * t.price_krw) :
          t.action === 'sell' || t.action === 'dividend' ? t.shares * t.price_krw : 0,
      })).filter((cf) => cf.amount !== 0);

      if (h.market_value_krw > 0) {
        cfs.push({ date: new Date(), amount: h.market_value_krw });
      }

      const firstTx = txs.sort((a, b) => a.trade_date.localeCompare(b.trade_date))[0];
      return {
        ticker: h.ticker,
        name: h.name,
        irr: calcIrr(cfs),
        invested_krw: h.total_principal_krw,
        current_value_krw: h.market_value_krw,
        first_date: firstTx?.trade_date ?? '',
      };
    });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
```

Expected: 모든 테스트 통과

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc.ts tests/calc.test.ts
git commit -m "feat: IRR bisection solver with portfolio and per-holding variants"
```

---

## Task 9: history.ts — 포트폴리오 역사 시세

**Files:**
- Create: `src/lib/history.ts`
- Create: `tests/history.test.ts`

- [ ] **Step 1: history 테스트 작성**

```typescript
// tests/history.test.ts
import { describe, it, expect } from 'vitest';
import { calcHoldingsAtDate } from '../src/lib/history';
import type { Transaction } from '../src/lib/types';

describe('calcHoldingsAtDate', () => {
  const txs: Transaction[] = [
    { id: '1', ticker: 'AAPL', name: 'Apple', action: 'buy', shares: 10, price_krw: 100000,
      trade_date: '2023-01-01', sector: null, region: '해외', asset_group: null, funding_source: null, notes: null },
    { id: '2', ticker: 'AAPL', name: 'Apple', action: 'buy', shares: 5, price_krw: 110000,
      trade_date: '2023-06-01', sector: null, region: '해외', asset_group: null, funding_source: null, notes: null },
    { id: '3', ticker: 'AAPL', name: 'Apple', action: 'sell', shares: 3, price_krw: 120000,
      trade_date: '2023-09-01', sector: null, region: '해외', asset_group: null, funding_source: null, notes: null },
  ];

  it('2023-03-01 기준: 10주만 보유', () => {
    const h = calcHoldingsAtDate(txs, '2023-03-01');
    expect(h.get('AAPL')).toBe(10);
  });

  it('2023-07-01 기준: 15주 보유', () => {
    const h = calcHoldingsAtDate(txs, '2023-07-01');
    expect(h.get('AAPL')).toBe(15);
  });

  it('2023-10-01 기준: 12주 보유 (15-3)', () => {
    const h = calcHoldingsAtDate(txs, '2023-10-01');
    expect(h.get('AAPL')).toBe(12);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm test
```

Expected: FAIL — `calcHoldingsAtDate is not exported`

- [ ] **Step 3: history.ts 구현**

```typescript
// src/lib/history.ts
import type { Transaction, HistoryPoint } from './types';
import { KR_TICKER_SUFFIX } from './prices';

// 특정 날짜 기준 각 티커 보유 수량 계산
export function calcHoldingsAtDate(
  transactions: Transaction[],
  date: string // 'YYYY-MM-DD'
): Map<string, number> {
  const holdings = new Map<string, number>();
  for (const tx of transactions) {
    if (tx.trade_date > date) continue;
    const prev = holdings.get(tx.ticker) ?? 0;
    if (tx.action === 'buy') {
      holdings.set(tx.ticker, prev + tx.shares);
    } else if (tx.action === 'sell') {
      const next = prev - tx.shares;
      if (next <= 0) holdings.delete(tx.ticker);
      else holdings.set(tx.ticker, next);
    }
  }
  return holdings;
}

// 누적 투자금액 계산 (특정 날짜까지)
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
  date: string;   // 'YYYY-MM-DD'
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
          // XAUUSD=X → KRW/g
          closeKrw = Math.round((close * usdKrw) / 31.1035);
        } else if (/^\d{4}$/.test(ticker)) {
          // 홍콩 HKD → KRW
          closeKrw = Math.round(close * (usdKrw / 7.78));
        } else {
          // USD → KRW
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

// 날짜 배열에서 특정 날짜 이전의 가장 최근 값 찾기
function lookupClose(closes: WeeklyClose[], date: string): number | null {
  let best: WeeklyClose | null = null;
  for (const c of closes) {
    if (c.date <= date) best = c;
    else break;
  }
  return best?.closeKrw ?? null;
}

// 주별 포트폴리오 가치 + 누적 투자금액 계산
export async function buildPortfolioHistory(
  transactions: Transaction[],
  usdKrw: number
): Promise<HistoryPoint[]> {
  if (transactions.length === 0) return [];

  const sorted = [...transactions].sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  const firstDate = sorted[0].trade_date;
  const period1 = Math.floor(new Date(firstDate).getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  // 모든 티커 목록
  const tickers = [...new Set(sorted.map((t) => t.ticker).filter((t) => t !== 'CASH'))];

  // 각 티커 주봉 시세 fetch (병렬)
  const closeMap = new Map<string, WeeklyClose[]>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const closes = await fetchWeeklyCloses(ticker, period1, period2, usdKrw);
      closeMap.set(ticker, closes);
    })
  );

  // 주별 날짜 생성 (firstDate ~ today, 1주 간격)
  const weeks: string[] = [];
  const cur = new Date(firstDate);
  const end = new Date();
  while (cur <= end) {
    weeks.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 7);
  }
  if (weeks[weeks.length - 1] !== end.toISOString().slice(0, 10)) {
    weeks.push(end.toISOString().slice(0, 10));
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
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npm test
```

Expected: history 테스트 3개 통과

- [ ] **Step 5: Commit**

```bash
git add src/lib/history.ts tests/history.test.ts
git commit -m "feat: portfolio history builder with Yahoo weekly prices"
```

---

## Task 10: useAnalytics.ts + Analytics.tsx

**Files:**
- Create: `src/hooks/useAnalytics.ts`
- Modify: `src/pages/Analytics.tsx`

- [ ] **Step 1: useAnalytics.ts 생성**

```typescript
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
  annualReturn: number | null;  // (현재가/투자원금)^(1/years) - 1
  mdd: number | null;           // 최대 낙폭 (음수)
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
```

- [ ] **Step 2: Analytics.tsx 전체 구현**

```tsx
// src/pages/Analytics.tsx
import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useAnalytics } from '../hooks/useAnalytics';

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + '원';
}
function fmtPct(n: number | null): string {
  if (n === null) return '-';
  const sign = n >= 0 ? '+' : '';
  return sign + (n * 100).toFixed(2) + '%';
}

function LineChart({ data, color, label }: {
  data: { time: string; value: number }[];
  color: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || data.length === 0) return;
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 220,
      layout: { background: { color: '#0d1117' }, textColor: '#8b949e' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { borderColor: '#30363d' },
      rightPriceScale: { borderColor: '#30363d' },
    });
    const series = chart.addSeries(LineSeries, { color, lineWidth: 2 });
    series.setData(data);
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => { chart.remove(); ro.disconnect(); };
  }, [data, color]);

  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 8 }}>{label}</div>
      {data.length === 0
        ? <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 12 }}>데이터 없음</div>
        : <div ref={ref} />}
    </div>
  );
}

export default function Analytics() {
  const { status, history, summary, holdingIrrs, error } = useAnalytics();

  if (status === 'error') return <div style={{ padding: 32, color: '#cf222e' }}>오류: {error}</div>;
  if (status === 'loading' || status === 'idle') {
    return <div style={{ padding: 32, color: '#8b949e' }}>애널리틱스 데이터 로딩 중... (Yahoo Finance 과거 시세 fetch)</div>;
  }

  const valueData = history.map((p) => ({ time: p.date as `${number}-${number}-${number}`, value: p.value_krw }));
  const returnData = history.map((p) => ({
    time: p.date as `${number}-${number}-${number}`,
    value: p.invested_krw > 0 ? ((p.value_krw - p.invested_krw) / p.invested_krw) * 100 : 0,
  }));

  const cards = [
    { label: '포트폴리오 IRR', value: fmtPct(summary.portfolioIrr), positive: (summary.portfolioIrr ?? 0) >= 0 },
    { label: '연환산 수익률', value: fmtPct(summary.annualReturn), positive: (summary.annualReturn ?? 0) >= 0 },
    { label: 'MDD', value: fmtPct(summary.mdd), positive: false },
    { label: '보유 기간', value: `${summary.holdingYears}년`, positive: true },
  ];

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>애널리틱스</div>

      {/* 상단 지표 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.label === 'MDD' ? '#1f6feb' : (c.positive ? '#cf222e' : '#1f6feb') }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* 차트 2열 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <LineChart data={valueData} color="#58a6ff" label="자산 총액 추이 (KRW)" />
        <LineChart data={returnData} color="#3fb950" label="수익률 % 추이" />
      </div>

      {/* 종목별 IRR 테이블 */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', fontSize: 13, fontWeight: 600 }}>종목별 IRR</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#21262d', color: '#8b949e' }}>
              {['종목명', '티커', '최초 매수', '투자 원금', '현재 평가', 'IRR'].map((h) => (
                <th key={h} style={{ padding: '8px 14px', textAlign: h === 'IRR' || h === '투자 원금' || h === '현재 평가' ? 'right' : 'left', fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {holdingIrrs
              .sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity))
              .map((r, i) => {
                const irrColor = r.irr === null ? '#8b949e' : r.irr >= 0 ? '#cf222e' : '#1f6feb';
                return (
                  <tr key={r.ticker} style={{ borderTop: '1px solid #21262d', background: i % 2 === 0 ? 'transparent' : '#0d1117' }}>
                    <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 14px', color: '#8b949e', fontSize: 11 }}>{r.ticker}</td>
                    <td style={{ padding: '8px 14px', color: '#8b949e' }}>{r.first_date}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{fmt(r.invested_krw)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right' }}>{fmt(r.current_value_krw)}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, color: irrColor }}>
                      {r.irr === null ? '-' : fmtPct(r.irr)}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 브라우저에서 애널리틱스 페이지 확인**

1. 사이드바 "애널리틱스" 클릭 → 로딩 중 표시
2. 완료 후: 4개 지표 카드, 자산 추이/수익률 라인 차트, 종목별 IRR 테이블 확인
3. 차트 hover 시 값 표시 확인

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAnalytics.ts src/pages/Analytics.tsx
git commit -m "feat: analytics page with portfolio history charts and IRR table"
```

---

## Task 11: Supabase — cash_balance 테이블 생성 (수동 작업)

- [ ] **Step 1: Supabase SQL Editor에서 실행**

```sql
CREATE TABLE IF NOT EXISTS cash_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_krw bigint NOT NULL,
  note text,
  record_date date NOT NULL DEFAULT current_date,
  created_at timestamptz DEFAULT now()
);

-- 현금 잔고 예시 입력 (실제 잔고로 수정)
-- INSERT INTO cash_balance (amount_krw, note) VALUES (5000000, '초기 현금');
```

- [ ] **Step 2: 대시보드에서 CASH 행 확인**

잔고 INSERT 후 `npm run dev` → 대시보드 새로고침 → CASH 행 표시 확인

---

## 자체 검토 (Spec Coverage)

| Spec 요구사항 | 구현 Task |
|---|---|
| 사이드바 네비게이션 | Task 3 |
| 종목명 위/티커 아래 | Task 4 |
| Yahoo longName fetch | Task 2 |
| 종목 클릭 인라인 차트 | Task 5 |
| GOLD 버그 수정 | Task 2 |
| CASH 표시 | Task 11 + 기존 구현 |
| 거래내역 테이블 | Task 7 |
| CSV 템플릿 다운로드 | Task 6+7 |
| CSV 업로드 | Task 6+7 |
| 포트폴리오 IRR | Task 8 |
| 자산 추이 차트 (실제 시세) | Task 9+10 |
| 수익률 추이 차트 | Task 10 |
| 종목별 IRR | Task 8+10 |
| MDD, 연환산 수익률 | Task 10 |
