import { describe, it, expect } from 'vitest';
import { calcIrr, calcPortfolioIrr, calcHoldingIrrs, calcRiskRatios } from '../src/lib/calc';
import type { Transaction, HoldingWithPrice } from '../src/lib/types';

describe('calcIrr', () => {
  it('단순 2년 2배 케이스 → IRR ≈ 41.4%', () => {
    const cfs = [
      { date: new Date('2022-01-01'), amount: -1000 },
      { date: new Date('2024-01-01'), amount: 2000 },
    ];
    const irr = calcIrr(cfs);
    expect(irr).not.toBeNull();
    expect(irr!).toBeCloseTo(0.4145, 3);
  });

  it('현금흐름이 1개이면 null 반환', () => {
    const cfs = [{ date: new Date('2022-01-01'), amount: -1000 }];
    expect(calcIrr(cfs)).toBeNull();
  });

  it('수익 없는 케이스 → IRR < 0', () => {
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
        asset_group: null, price_source: 'yahoo', daily_change_pct: null, prev_close_krw: 0 },
    ];
    const irr = calcPortfolioIrr(txs, holdings);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0);
  });
});

describe('calcHoldingIrrs', () => {
  it('단일 종목 IRR 반환', () => {
    const txs: Transaction[] = [
      { id: '1', ticker: 'AAPL', name: 'Apple', action: 'buy', shares: 10, price_krw: 100000,
        trade_date: '2023-01-01', sector: null, region: '해외', asset_group: null, funding_source: null, notes: null },
    ];
    const holdings: HoldingWithPrice[] = [
      { ticker: 'AAPL', name: 'Apple', shares: 10, avg_price_krw: 100000,
        total_principal_krw: 1000000, current_price_krw: 150000, market_value_krw: 1500000,
        profit_krw: 500000, profit_pct: 50, sector: null, region: '해외',
        asset_group: null, price_source: 'yahoo', daily_change_pct: null, prev_close_krw: 0 },
    ];
    const results = calcHoldingIrrs(txs, holdings);
    expect(results).toHaveLength(1);
    expect(results[0].ticker).toBe('AAPL');
    expect(results[0].irr).not.toBeNull();
    expect(results[0].irr!).toBeGreaterThan(0);
    expect(results[0].invested_krw).toBe(1000000);
    expect(results[0].current_value_krw).toBe(1500000);
  });
});

describe('calcRiskRatios', () => {
  const rets = [0.02, -0.01, 0.03, -0.01, 0.01];
  // 원래 테스트 기대값은 주간(periodsPerYear=52) 기준으로 산출됨.
  const W = 52;

  it('beta = 1 when portfolio returns === market returns', () => {
    const r = calcRiskRatios(rets, rets, 0, W);
    expect(r.beta).toBeCloseTo(1.0, 5);
  });

  it('Treynor = annualized excess return / 1 when beta = 1, rf = 0', () => {
    const r = calcRiskRatios(rets, rets, 0, W);
    expect(r.treynor).toBeCloseTo(0.5035, 3);
  });

  it('Sharpe uses geometric annualized R_p and sample std', () => {
    const r = calcRiskRatios(rets, rets, 0, W);
    expect(r.sharpe).toBeCloseTo(3.90, 1);
  });

  it('Sortino uses geometric R_p and population downside variance', () => {
    const r = calcRiskRatios(rets, rets, 0, W);
    expect(r.sortino).toBeCloseTo(11.0, 0);
  });

  it('returns all-null ratios when fewer than 4 data points', () => {
    const r = calcRiskRatios([0.01, 0.02], [0.01, 0.02], 0.05);
    expect(r).toMatchObject({ sharpe: null, sortino: null, treynor: null, beta: null });
  });

  it('returns all-null ratios when arrays have different lengths', () => {
    const r = calcRiskRatios([0.01, 0.02, 0.03, 0.04, 0.05], [0.01, 0.02, 0.03, 0.04], 0);
    expect(r).toMatchObject({ sharpe: null, sortino: null, treynor: null, beta: null });
  });

  it('returns Treynor null when market has zero variance', () => {
    const flat = [0.01, 0.01, 0.01, 0.01, 0.01];
    const r = calcRiskRatios(rets, flat, 0, W);
    expect(r.treynor).toBeNull();
    expect(r.beta).toBeNull();
  });

  it('Sortino null when no observations fall below rfWeekly', () => {
    const highRets = [0.05, 0.06, 0.07, 0.08, 0.09];
    const r = calcRiskRatios(highRets, highRets, 0, W);
    expect(r.sortino).toBeNull();
  });
});
