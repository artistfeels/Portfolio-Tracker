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
}

export interface HoldingWithPrice extends Holding {
  current_price_krw: number;
  market_value_krw: number;
  profit_krw: number;
  profit_pct: number;
  price_source: string;
}