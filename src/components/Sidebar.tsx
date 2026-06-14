import type { Page } from '../lib/types';
import type { Theme } from '../App';
import { supabase } from '../lib/supabaseClient';

interface Props {
  current: Page;
  onNavigate: (p: Page) => void;
  theme: Theme;
  onToggleTheme: () => void;
  isMobile?: boolean;
}

const items: { page: Page; icon: string; label: string }[] = [
  { page: 'dashboard',    icon: '📊', label: '대시보드' },
  { page: 'transactions', icon: '📄', label: '거래내역' },
  { page: 'analytics',    icon: '📈', label: '애널리틱스' },
  { page: 'market',       icon: '🌐', label: '시장'     },
  { page: 'watchlist',    icon: '⭐', label: '관심종목' },
  { page: 'dividend',     icon: '💵', label: '배당'     },
  { page: 'tax',          icon: '🧾', label: '세금'     },
];

export default function Sidebar({ current, onNavigate, theme, onToggleTheme, isMobile }: Props) {
  if (isMobile) {
    return (
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--glass-border)',
        display: 'flex', flexDirection: 'row',
        alignItems: 'stretch',
        height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)',
        overflowX: 'auto',
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      } as React.CSSProperties}>
        {items.map(({ page, icon, label }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            style={{
              flex: '0 0 auto', minWidth: 52, height: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              background: 'none', border: 'none', cursor: 'pointer',
              color: current === page ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 18, padding: '0 4px',
            }}
          >
            <span>{icon}</span>
            <span style={{ fontSize: 8, fontWeight: current === page ? 700 : 400, whiteSpace: 'nowrap' }}>{label}</span>
          </button>
        ))}
        <div style={{ flex: '0 0 1px', background: 'var(--border-primary)', margin: '10px 2px' }} />
        <button
          onClick={onToggleTheme}
          style={{
            flex: '0 0 auto', minWidth: 44, height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 16, padding: '0 4px',
          }}
        >
          <span>{theme === 'dark' ? '☀️' : '🌙'}</span>
          <span style={{ fontSize: 8 }}>테마</span>
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            flex: '0 0 auto', minWidth: 44, height: '100%',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 16, padding: '0 4px',
          }}
        >
          <span>↩</span>
          <span style={{ fontSize: 8 }}>로그아웃</span>
        </button>
      </nav>
    );
  }

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
            width: 40, height: 40,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: current === page ? 'var(--bg-tertiary)' : 'transparent',
            border: 'none', borderRadius: 8,
            color: current === page ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 18, cursor: 'pointer',
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
