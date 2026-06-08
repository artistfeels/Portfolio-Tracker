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
  it('헤더 포함 예시 행 2개 이상 반환', () => {
    const csv = generateTemplateCsv();
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('trade_date');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });
});
