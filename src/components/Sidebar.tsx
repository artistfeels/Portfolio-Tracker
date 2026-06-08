// src/components/Sidebar.tsx
import type { Page } from '../lib/types';

interface Props {
  current: Page;
  onNavigate: (p: Page) => void;
}

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard',    icon: '📊', label: '대시보드' },
  { page: 'analytics',   icon: '📈', label: '애널리틱스' },
  { page: 'transactions', icon: '📄', label: '거래내역' },
];

export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <nav style={{
      width: 140,
      background: '#010409',
      borderRight: '1px solid #21262d',
      padding: '24px 0',
      flexShrink: 0,
    }}>
      <div style={{ padding: '0 16px 24px', fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>
        Portfolio
      </div>
      {items.map(({ page, icon, label }) => (
        <button
          key={page}
          aria-current={current === page ? 'page' : undefined}
          onClick={() => onNavigate(page)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            padding: '10px 16px',
            background: current === page ? '#21262d' : 'transparent',
            border: 'none',
            borderLeft: current === page ? '2px solid #58a6ff' : '2px solid transparent',
            color: current === page ? '#e6edf3' : '#8b949e',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span aria-hidden="true">{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
