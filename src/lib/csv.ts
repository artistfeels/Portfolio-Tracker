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
  setTimeout(() => URL.revokeObjectURL(url), 100);
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
