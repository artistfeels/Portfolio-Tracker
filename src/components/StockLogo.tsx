import { useState } from 'react';

interface Props {
  ticker: string;
  name: string;
  size?: number;
}

const PALETTE = ['#a78bfa','#60a5fa','#34d399','#f472b6','#fbbf24','#fb7185','#38bdf8','#4ade80','#c084fc','#f97316'];

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return PALETTE[h % PALETTE.length];
}

export default function StockLogo({ ticker, name, size = 28 }: Props) {
  const [failed, setFailed] = useState(false);
  const isKorean = /^\d{4,6}$/.test(ticker) || ticker === 'GOLD' || ticker === 'CASH';
  const letter = (name || ticker)[0]?.toUpperCase() ?? '?';
  const bg = hashColor(ticker);

  const letterAvatar = (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: bg, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700,
      flexShrink: 0, userSelect: 'none',
    }}>
      {letter}
    </div>
  );

  if (isKorean || failed) return letterAvatar;

  return (
    <img
      src={`https://assets.parqet.com/logos/symbol/${encodeURIComponent(ticker)}?format=svg`}
      alt={ticker}
      width={size} height={size}
      onError={() => setFailed(true)}
      style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0, background: '#fff' }}
    />
  );
}
