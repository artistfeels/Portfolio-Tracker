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
