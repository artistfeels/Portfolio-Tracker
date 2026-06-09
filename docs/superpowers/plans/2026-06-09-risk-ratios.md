# Risk Ratios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Sharpe, Sortino, Treynor ratios and Beta (β) to the Analytics page using SOFR (FRED) as risk-free rate and S&P 500 as market benchmark.

**Architecture:** Pure client-side calculation — `calcRiskRatios` in `calc.ts` takes weekly portfolio/market return arrays and annualized SOFR, computes all four metrics. `market.ts` handles two new fetches (FRED SOFR, Yahoo `^GSPC`). `useAnalytics` fetches both in parallel with the existing history build, aligns dates, and passes returns to `calcRiskRatios`. `Analytics.tsx` renders a second card row.

**Tech Stack:** TypeScript, React, Vite proxy, FRED API (free), Yahoo Finance (existing proxy), Vitest

---

### Task 1: `calcRiskRatios` — pure calculation function + tests

**Files:**
- Modify: `src/lib/calc.ts`
- Modify: `tests/calc.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/calc.test.ts`:

```ts
import { calcRiskRatios } from '../src/lib/calc';

describe('calcRiskRatios', () => {
  // identical portfolio + market → beta = 1, Treynor = excess annual return
  const rets = [0.02, -0.01, 0.03, -0.01, 0.01];

  it('beta = 1 when portfolio returns === market returns', () => {
    const r = calcRiskRatios(rets, rets, 0);
    expect(r.beta).toBeCloseTo(1.0, 5);
  });

  it('Treynor = annualized excess return / 1 when beta = 1, rf = 0', () => {
    const r = calcRiskRatios(rets, rets, 0);
    // mean(rets) = 0.008, R_p_ann = 0.008*52 = 0.416
    expect(r.treynor).toBeCloseTo(0.416, 3);
  });

  it('Sharpe uses sample std annualized', () => {
    const r = calcRiskRatios(rets, rets, 0);
    // sampleStd([0.02,-0.01,0.03,-0.01,0.01]) = 0.017889, *sqrt(52) = 0.12900
    // Sharpe = 0.416 / 0.12900 ≈ 3.225
    expect(r.sharpe).toBeCloseTo(3.22, 1);
  });

  it('Sortino uses population downside variance over all n observations', () => {
    const r = calcRiskRatios(rets, rets, 0);
    // downside: (-0.01)^2 + (-0.01)^2 = 0.0002, /5 = 0.00004
    // σ_d_ann = sqrt(0.00004)*sqrt(52) ≈ 0.04561
    // Sortino = 0.416 / 0.04561 ≈ 9.12
    expect(r.sortino).toBeCloseTo(9.1, 0);
  });

  it('returns all-null when fewer than 4 data points', () => {
    const r = calcRiskRatios([0.01, 0.02], [0.01, 0.02], 0.05);
    expect(r).toEqual({ sharpe: null, sortino: null, treynor: null, beta: null });
  });

  it('returns Treynor null when market has zero variance', () => {
    // flat market returns → var ≈ 0 → beta = null → Treynor = null
    const flat = [0.01, 0.01, 0.01, 0.01, 0.01];
    const r = calcRiskRatios(rets, flat, 0);
    expect(r.treynor).toBeNull();
    expect(r.beta).toBeNull();
  });

  it('Sortino null when no observations fall below rfWeekly', () => {
    // all returns well above rf
    const highRets = [0.05, 0.06, 0.07, 0.08, 0.09];
    const r = calcRiskRatios(highRets, highRets, 0);
    // no downside deviations → σ_d = 0 → Sortino null
    expect(r.sortino).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```
npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: `calcRiskRatios is not a function` or similar import error.

- [ ] **Step 3: Add `RiskRatios` type and `calcRiskRatios` to `src/lib/calc.ts`**

Append after the existing `calcHoldingIrrs` function:

```ts
export interface RiskRatios {
  sharpe: number | null;
  sortino: number | null;
  treynor: number | null;
  beta: number | null;
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function sampleVar(arr: number[]): number {
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function sampleCov(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
}

export function calcRiskRatios(
  portfolioReturns: number[],
  marketReturns: number[],
  rfAnnual: number
): RiskRatios {
  if (portfolioReturns.length < 4 || marketReturns.length < 4) {
    return { sharpe: null, sortino: null, treynor: null, beta: null };
  }

  const n = portfolioReturns.length;
  const rfWeekly = rfAnnual / 52;
  const R_p_ann = mean(portfolioReturns) * 52;
  const σ_p_ann = Math.sqrt(sampleVar(portfolioReturns)) * Math.sqrt(52);

  const downsideVariance =
    portfolioReturns.reduce((s, r) => s + Math.min(r - rfWeekly, 0) ** 2, 0) / n;
  const σ_d_ann = Math.sqrt(downsideVariance) * Math.sqrt(52);

  const varM = sampleVar(marketReturns);
  const beta = varM > 1e-12 ? sampleCov(portfolioReturns, marketReturns) / varM : null;
  const excess = R_p_ann - rfAnnual;

  return {
    sharpe: σ_p_ann > 1e-12 ? excess / σ_p_ann : null,
    sortino: σ_d_ann > 1e-12 ? excess / σ_d_ann : null,
    treynor: beta !== null && Math.abs(beta) > 0.001 ? excess / beta : null,
    beta,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```
npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all `calcRiskRatios` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calc.ts tests/calc.test.ts
git commit -m "feat: calcRiskRatios (Sharpe/Sortino/Treynor/Beta) with tests"
```

---

### Task 2: `src/lib/market.ts` — SOFR and S&P 500 fetchers

**Files:**
- Create: `src/lib/market.ts`

- [ ] **Step 1: Create `src/lib/market.ts`**

```ts
// src/lib/market.ts

function tsToDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export async function fetchSofr(period1: number, period2: number): Promise<number> {
  const key = import.meta.env.VITE_FRED_API_KEY as string | undefined;
  if (!key) return 0;
  try {
    const start = tsToDate(period1);
    const end = tsToDate(period2);
    const res = await fetch(
      `/api/fred/fred/series/observations?series_id=SOFR&api_key=${key}` +
      `&observation_start=${start}&observation_end=${end}&file_type=json`
    );
    const j = await res.json();
    const obs: { value: string }[] = j?.observations ?? [];
    const values = obs
      .map((o) => parseFloat(o.value))
      .filter((v) => isFinite(v));
    if (values.length === 0) return 0;
    return (values.reduce((s, v) => s + v, 0) / values.length) / 100;
  } catch {
    return 0;
  }
}

export async function fetchSpxWeekly(
  period1: number,
  period2: number
): Promise<{ date: string; close: number }[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/%5EGSPC?interval=1wk&period1=${period1}&period2=${period2}`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    return timestamps
      .map((ts, i) => {
        const close = closes[i];
        if (!close || close <= 0) return null;
        return { date: new Date(ts * 1000).toISOString().slice(0, 10), close };
      })
      .filter((v): v is { date: string; close: number } => v !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/market.ts
git commit -m "feat: fetchSofr (FRED) and fetchSpxWeekly (Yahoo) market data fetchers"
```

---

### Task 3: Vite proxy for FRED + `.env` setup

**Files:**
- Modify: `vite.config.ts`
- Modify: `.env`
- Create: `.env.example`

- [ ] **Step 1: Add FRED proxy to `vite.config.ts`**

Replace the `proxy` block:

```ts
    proxy: {
      '/api/yahoo': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yahoo/, ''),
      },
      '/api/fred': {
        target: 'https://api.stlouisfed.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fred/, ''),
      },
    },
```

- [ ] **Step 2: Add FRED API key to `.env`**

Append to `.env`:

```
VITE_FRED_API_KEY=your_fred_api_key_here
```

Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html (instant, no approval needed).

- [ ] **Step 3: Create `.env.example`**

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_FRED_API_KEY=your_fred_api_key_here
```

- [ ] **Step 4: Commit**

```bash
git add vite.config.ts .env.example
git commit -m "feat: add FRED API proxy and document VITE_FRED_API_KEY"
```

Note: `.env` is gitignored — add `VITE_FRED_API_KEY` there manually, do not commit it.

---

### Task 4: Extend `useAnalytics` to compute risk ratios

**Files:**
- Modify: `src/hooks/useAnalytics.ts`

- [ ] **Step 1: Add imports and extend `AnalyticsSummary`**

At the top of `src/hooks/useAnalytics.ts`, add to the existing import line:

```ts
import { calcHoldings, calcSummary, calcPortfolioIrr, calcHoldingIrrs, calcRiskRatios } from '../lib/calc';
import { fetchSofr, fetchSpxWeekly } from '../lib/market';
```

Extend `AnalyticsSummary`:

```ts
export interface AnalyticsSummary {
  portfolioIrr: number | null;
  annualReturn: number | null;
  mdd: number | null;
  holdingYears: number;
  sharpe: number | null;
  sortino: number | null;
  treynor: number | null;
  beta: number | null;
}
```

Update the initial state in `useState`:

```ts
  const [summary, setSummary] = useState<AnalyticsSummary>({
    portfolioIrr: null, annualReturn: null, mdd: null, holdingYears: 0,
    sharpe: null, sortino: null, treynor: null, beta: null,
  });
```

- [ ] **Step 2: Add `lookupSpx` helper inside the hook file (module-level)**

Add this function above `useAnalytics`:

```ts
function lookupSpx(
  closes: { date: string; close: number }[],
  date: string
): number | null {
  let best: { date: string; close: number } | null = null;
  for (const c of closes) {
    if (c.date <= date) best = c;
    else break;
  }
  return best?.close ?? null;
}
```

- [ ] **Step 3: Replace the `buildPortfolioHistory` call with a parallel fetch block**

Inside `load()`, find this line:

```ts
        const hist = await buildPortfolioHistory(txs, usdKrw);
```

Replace with:

```ts
        const period1 = Math.floor(new Date(txs[0].trade_date).getTime() / 1000);
        const period2 = Math.floor(Date.now() / 1000);

        const [hist, rfAnnual, spxCloses] = await Promise.all([
          buildPortfolioHistory(txs, usdKrw),
          fetchSofr(period1, period2),
          fetchSpxWeekly(period1, period2),
        ]);
```

- [ ] **Step 4: Compute returns and call `calcRiskRatios` before `setSummary`**

Add after the `Promise.all` block, before the `if (cancelled) return;` / `setHistory(hist)` lines:

```ts
        if (cancelled) return;
        setHistory(hist);

        const portfolioReturns: number[] = [];
        const marketReturns: number[] = [];
        for (let i = 1; i < hist.length; i++) {
          const prev = hist[i - 1];
          const curr = hist[i];
          if (prev.value_krw <= 0) continue;
          const pr = (curr.value_krw - prev.value_krw) / prev.value_krw;
          const spxPrev = lookupSpx(spxCloses, prev.date);
          const spxCurr = lookupSpx(spxCloses, curr.date);
          if (spxPrev && spxCurr && spxPrev > 0) {
            portfolioReturns.push(pr);
            marketReturns.push((spxCurr - spxPrev) / spxPrev);
          }
        }
        const ratios = calcRiskRatios(portfolioReturns, marketReturns, rfAnnual);
```

- [ ] **Step 5: Add ratios to `setSummary` call**

Find the existing `setSummary({...})` call and update it:

```ts
        setSummary({
          portfolioIrr: calcPortfolioIrr(txs, withPrices),
          annualReturn: calcAnnualReturn(s.totalValue, s.totalPrincipal, firstDate),
          mdd: calcMdd(hist),
          holdingYears: Math.round(years * 10) / 10,
          sharpe: ratios.sharpe,
          sortino: ratios.sortino,
          treynor: ratios.treynor,
          beta: ratios.beta,
        });
```

- [ ] **Step 6: Run tests to confirm nothing broken**

```
npm test 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAnalytics.ts
git commit -m "feat: integrate SOFR + S&P500 into useAnalytics for risk ratios"
```

---

### Task 5: Analytics.tsx — risk ratio card row

**Files:**
- Modify: `src/pages/Analytics.tsx`

- [ ] **Step 1: Add `fmtRatio` helper at the top of Analytics.tsx**

After the existing `fmtPct` function, add:

```ts
function fmtRatio(n: number | null, digits = 2): string {
  if (n === null) return '-';
  return n.toFixed(digits);
}
```

- [ ] **Step 2: Add the risk ratio card row to the JSX**

Find this existing block in the return statement:

```tsx
      {/* 차트 2열 */}
```

Insert the following block immediately before it (after the existing 4-card row):

```tsx
      {/* 리스크 지표 */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 10, letterSpacing: '0.04em' }}>
          리스크 지표 &middot; S&amp;P500 벤치마크 &middot; SOFR 무위험금리
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {[
            { label: '샤프 비율', value: fmtRatio(summary.sharpe), raw: summary.sharpe, neutral: false },
            { label: '소르티노 비율', value: fmtRatio(summary.sortino), raw: summary.sortino, neutral: false },
            { label: '트레이너 비율', value: fmtRatio(summary.treynor), raw: summary.treynor, neutral: false },
            { label: '베타 (β)', value: fmtRatio(summary.beta, 3), raw: summary.beta, neutral: true },
          ].map((c) => {
            const color = c.raw === null
              ? '#8b949e'
              : c.neutral
              ? '#e6edf3'
              : c.raw >= 0 ? '#cf222e' : '#1f6feb';
            return (
              <div key={c.label} style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '16px 20px' }}>
                <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color }}>{c.value}</div>
              </div>
            );
          })}
        </div>
      </div>
```

- [ ] **Step 3: Run TypeScript check**

```
npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Analytics.tsx
git commit -m "feat: risk ratio cards on Analytics page (Sharpe/Sortino/Treynor/Beta)"
```

---

## Self-Review Checklist

- [x] Spec §4 `calcRiskRatios` formulas → Task 1 ✓
- [x] Spec §5 `fetchSofr` / `fetchSpxWeekly` → Task 2 ✓
- [x] Spec §3 FRED proxy, `VITE_FRED_API_KEY` → Task 3 ✓
- [x] Spec §6 `useAnalytics` integration → Task 4 ✓
- [x] Spec §7 UI card row → Task 5 ✓
- [x] Spec §8 `AnalyticsSummary` extended → Task 4 Step 1 ✓
- [x] Spec §9 tests → Task 1 ✓
- [x] Type consistency: `RiskRatios` defined in Task 1, imported via `calcRiskRatios` in Task 4 ✓
- [x] `lookupSpx` defined in Task 4 before use ✓
- [x] `fmtRatio` defined in Task 5 before use ✓
