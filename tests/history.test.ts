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
