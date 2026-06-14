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

// Korean 6-digit logo sources (tried in order)
const KR_SOURCES = (ticker: string) => [
  `https://thumb.tossinvest.com/image/resized/96x0/https%3A%2F%2Fstatic.toss.im%2Fpng-icons%2Fsecurities%2Ficn-sec-fill-${ticker}.png`,
  `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${ticker}.png`,
];

export default function StockLogo({ ticker, name, size = 28 }: Props) {
  const [krSrcIdx, setKrSrcIdx] = useState(0);
  const [usFailed, setUsFailed] = useState(false);

  const isKorean = /^\d{4,6}$/.test(ticker);
  const isSpecial = ticker === 'GOLD' || ticker === 'CASH';
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

  if (isSpecial) return letterAvatar;

  if (isKorean) {
    const sources = KR_SOURCES(ticker);
    if (krSrcIdx >= sources.length) return letterAvatar;
    return (
      <img
        key={krSrcIdx}
        src={sources[krSrcIdx]}
        alt={ticker}
        width={size} height={size}
        onError={() => setKrSrcIdx(i => i + 1)}
        style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0, background: '#fff', padding: 1 }}
      />
    );
  }

  // US / foreign stocks
  if (usFailed) return letterAvatar;
  return (
    <img
      src={`https://assets.parqet.com/logos/symbol/${encodeURIComponent(ticker)}?format=svg`}
      alt={ticker}
      width={size} height={size}
      onError={() => setUsFailed(true)}
      style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0, background: '#fff' }}
    />
  );
}
