export type Page = 'dashboard' | 'transactions' | 'analytics' | 'watchlist' | 'tax';

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
  daily_change_pct: number | null;
  prev_close_krw: number;
  source: 'yahoo' | 'naver' | 'cache' | 'manual';
  fetched_at: string;
  display_name?: string;
}

export interface HoldingWithPrice extends Holding {
  current_price_krw: number;
  market_value_krw: number;
  profit_krw: number;
  profit_pct: number;
  price_source: string;
  daily_change_pct: number | null;
  prev_close_krw: number;
}

export interface HistoryPoint {
  date: string;
  value_krw: number;
  invested_krw: number;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  name: string;
  target_price_krw: number | null;
  region: '한국' | '해외';
  created_at: string;
}

export interface IrrResult {
  ticker: string;
  name: string;
  irr: number | null;
  invested_krw: number;
  current_value_krw: number;
  first_date: string;
}
