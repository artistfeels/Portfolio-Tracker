import type { Page } from '../lib/types';
import { supabase } from '../lib/supabaseClient';

interface Props {
  current: Page;
  onNavigate: (p: Page) => void;
}

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard',    icon: '📊', label: '대시보드' },
  { page: 'transactions', icon: '📄', label: '거래내역' },
];

export default function Sidebar({ current, onNavigate }: Props) {
  return (
    <nav style={{
      width: 56,
      background: '#010409',
      borderRight: '1px solid #21262d',
      padding: '16px 0',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: '#58a6ff', letterSpacing: 0.5, marginBottom: 12, textAlign: 'center' }}>
        PT
      </div>
      {items.map(({ page, icon, label }) => (
        <button
          key={page}
          aria-current={current === page ? 'page' : undefined}
          onClick={() => onNavigate(page)}
          title={label}
          style={{
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: current === page ? '#21262d' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: current === page ? '#e6edf3' : '#8b949e',
            fontSize: 18,
            cursor: 'pointer',
            outline: current === page ? '1px solid #30363d' : 'none',
          }}
        >
          <span aria-label={label}>{icon}</span>
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <button
        onClick={() => supabase.auth.signOut()}
        title="로그아웃"
        style={{
          width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: 8,
          color: '#8b949e', fontSize: 16, cursor: 'pointer',
          marginBottom: 4,
        }}
      >
        <span aria-label="로그아웃">↩</span>
      </button>
    </nav>
  );
}
