# Risk Ratios Design: Sharpe / Sortino / Treynor + Beta

**Date:** 2026-06-09  
**Status:** Approved

---

## 1. Goal

Add Sharpe, Sortino, Treynor ratios and portfolio Beta (β) to the Analytics page.  
These are universal metrics regardless of portfolio composition — fixed data sources, no per-user configuration.

---

## 2. Data Sources

| Data | Source | Fetch method |
|------|--------|--------------|
| Risk-free rate (Rf) | US SOFR daily — FRED series `SOFR` | New Vite proxy `/api/fred` → `api.stlouisfed.org` |
| Market benchmark | S&P 500 weekly (`^GSPC`) | Existing Yahoo proxy `/api/yahoo` |
| Portfolio returns | Derived from existing `HistoryPoint[]` | Already in `useAnalytics` |

**FRED API key:** `VITE_FRED_API_KEY` in `.env`. Fetched client-side via Vite proxy.

---

## 3. Vite Proxy Addition

`vite.config.ts` — add alongside existing `/api/yahoo`:

```
/api/fred → https://api.stlouisfed.org
```

---

## 4. Calculation Logic

All functions added to `src/lib/calc.ts`.

### 4.1 Inputs

- `portfolioReturns: number[]` — weekly returns `(v_t - v_{t-1}) / v_{t-1}` from `HistoryPoint[]`
- `marketReturns: number[]` — S&P 500 weekly returns over the same date range
- `rfAnnual: number` — period-average annualized SOFR (e.g. 0.053)

### 4.2 Formulas

```
rfWeekly      = rfAnnual / 52

R_p_ann       = mean(portfolioReturns) × 52
σ_p_ann       = stddev(portfolioReturns) × √52
σ_d_ann       = stddev(portfolioReturns where r < rfWeekly) × √52  [Sortino downside]

β             = cov(portfolioReturns, marketReturns) / var(marketReturns)

Sharpe        = (R_p_ann − rfAnnual) / σ_p_ann
Sortino       = (R_p_ann − rfAnnual) / σ_d_ann
Treynor       = (R_p_ann − rfAnnual) / β
```

### 4.3 Guard conditions → return `null`

- `portfolioReturns.length < 4`
- `σ_p_ann === 0` (Sharpe)
- `σ_d_ann === 0` (Sortino)
- `|β| < 0.001` (Treynor)

---

## 5. New fetch functions (`src/lib/market.ts`)

### `fetchSofr(period1: number, period2: number): Promise<number>`
- `period1`/`period2` are Unix timestamps; convert to `YYYY-MM-DD` strings for FRED query params
- Calls `/api/fred/fred/series/observations?series_id=SOFR&api_key=${key}&observation_start=YYYY-MM-DD&observation_end=YYYY-MM-DD&file_type=json`
- FRED returns values as percent strings (e.g. `"5.31"`) → divide by 100 → average across observations
- Returns average annualized SOFR over the period (0–1 scale)

### `fetchSpxWeekly(period1: number, period2: number): Promise<{ date: string; close: number }[]>`
- Calls `/api/yahoo/v8/finance/chart/%5EGSPC?interval=1wk&period1=...&period2=...`
- Returns sorted weekly closes

---

## 6. `useAnalytics` Changes

In the existing `load()` function, after `buildPortfolioHistory` resolves:

1. Compute `portfolioReturns` from `HistoryPoint[]` consecutive pairs
2. Fetch `fetchSofr(period1, period2)` and `fetchSpxWeekly(period1, period2)` in parallel
3. Align S&P 500 weekly closes to portfolio history dates (same lookback strategy as `lookupClose`)
4. Compute `marketReturns` from aligned S&P closes
5. Call `calcRiskRatios(portfolioReturns, marketReturns, rfAnnual)` → `{ sharpe, sortino, treynor, beta }`
6. Merge into `summary` state (extend `AnalyticsSummary` interface)

---

## 7. UI Changes (`src/pages/Analytics.tsx`)

Add a second card row below the existing four summary cards:

```
[ 샤프 비율 ]  [ 소르티노 비율 ]  [ 트레이너 비율 ]  [ 베타 (β) ]
```

- Section label above the row: `리스크 지표 · S&P500 벤치마크 · SOFR 무위험금리`
- Same card style as existing cards (`#161b22` bg, `#30363d` border)
- Color: positive → `#cf222e`, negative → `#1f6feb`, null → `-` in `#8b949e`
- β card: always neutral color (it's a measure, not good/bad)

---

## 8. Types

Extend `AnalyticsSummary` in `useAnalytics.ts`:

```ts
sharpe: number | null;
sortino: number | null;
treynor: number | null;
beta: number | null;
```

---

## 9. Tests

Add to existing test file (or `calc.test.ts`):

- `calcRiskRatios` with known inputs → verify Sharpe/Sortino/Treynor/beta values
- Guard: returns all-null when `< 4` data points
- Guard: Treynor null when β ≈ 0

---

## 10. Files Changed

| File | Change |
|------|--------|
| `vite.config.ts` | Add `/api/fred` proxy |
| `.env` / `.env.example` | Add `VITE_FRED_API_KEY` |
| `src/lib/calc.ts` | Add `calcRiskRatios` |
| `src/lib/market.ts` | New file: `fetchSofr`, `fetchSpxWeekly` |
| `src/hooks/useAnalytics.ts` | Extend `AnalyticsSummary`, call new fetches + calc |
| `src/pages/Analytics.tsx` | Add risk ratio card row |
| `src/lib/calc.test.ts` | Add `calcRiskRatios` tests |
