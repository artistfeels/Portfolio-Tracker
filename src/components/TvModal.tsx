import { useEffect } from 'react';

const TV_MAP: Record<string, string> = {
  '^GSPC': 'SP:SPX',
  '^IXIC': 'NASDAQ:IXIC',
  '^DJI': 'DJ:DJI',
  '^KS11': 'KRX:KOSPI',
  '^KQ11': 'KRX:KOSDAQ',
  '^VIX': 'CBOE:VIX',
  '^N225': 'TVC:NI225',
  'DX-Y.NYB': 'TVC:DXY',
  'USDKRW=X': 'FX_IDC:USDKRW',
  'EURUSD=X': 'FX:EURUSD',
  'USDJPY=X': 'FX:USDJPY',
};

export function toTvSymbol(ticker: string): string {
  if (ticker.includes(':')) return ticker;   // already a TradingView symbol
  if (TV_MAP[ticker]) return TV_MAP[ticker];
  if (/^\d{6}$/.test(ticker)) return `KRX:${ticker}`;
  return ticker.replace(/=X$/, '').replace(/^\^/, '');
}

interface Props {
  ticker: string | null;
  name: string;
  theme: 'light' | 'dark';
  onClose: () => void;
}

export default function TvModal({ ticker, name, theme, onClose }: Props) {
  useEffect(() => {
    if (!ticker) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [ticker, onClose]);

  if (!ticker) return null;

  const sym = toTvSymbol(ticker);
  const tvTheme = theme === 'dark' ? 'dark' : 'light';
  const src = `https://www.tradingview.com/widgetembed/?symbol=${encodeURIComponent(sym)}&interval=D&locale=kr&theme=${tvTheme}&style=1&timezone=Asia%2FSeoul&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=1`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, animation: 'fadeSlideIn 0.18s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 960, height: '82vh',
          background: 'var(--bg-card)', borderRadius: 14,
          border: '1px solid var(--border-primary)',
          overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 18px', borderBottom: '1px solid var(--border-primary)', flexShrink: 0,
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{sym}</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              borderRadius: 6, width: 30, height: 30, cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >✕</button>
        </div>
        {/* Chart iframe */}
        <iframe
          src={src}
          style={{ flex: 1, border: 'none', display: 'block' }}
          title={name}
          allowFullScreen
        />
      </div>
    </div>
  );
}
