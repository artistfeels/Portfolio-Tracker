import type { Page } from '../lib/types';
import type { Theme } from '../App';
import { supabase } from '../lib/supabaseClient';

interface Props {
  current: Page;
  onNavigate: (p: Page) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard',    icon: '📊', label: '대시보드' },
  { page: 'transactions', icon: '📄', label: '거래내역' },
  { page: 'analytics',    icon: '📈', label: '애널리틱스' },
];

export default function Sidebar({ current, onNavigate, theme, onToggleTheme }: Props) {
  return (
    <nav style={{
      width: 56,
      background: 'var(--bg-primary)',
      borderRight: '1px solid var(--border-primary)',
      padding: '16px 0',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: 0.5, marginBottom: 4, textAlign: 'center' }}>
        PT
      </div>
      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        style={{
          width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: 8,
          color: 'var(--text-secondary)', fontSize: 16, cursor: 'pointer',
          marginBottom: 8,
        }}
      >
        <span aria-label="테마 전환">{theme === 'dark' ? '☀️' : '🌙'}</span>
      </button>
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
            background: current === page ? 'var(--bg-tertiary)' : 'transparent',
            border: 'none',
            borderRadius: 8,
            color: current === page ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 18,
            cursor: 'pointer',
            outline: current === page ? '1px solid var(--border-primary)' : 'none',
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
          color: 'var(--text-secondary)', fontSize: 16, cursor: 'pointer',
          marginBottom: 4,
        }}
      >
        <span aria-label="로그아웃">↩</span>
      </button>
    </nav>
  );
}
