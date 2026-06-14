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
      width: 152,
      background: 'var(--bg-primary)',
      borderRight: '1px solid var(--border-primary)',
      padding: '16px 0 12px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: 2,
    }}>
      {/* 앱 로고 */}
      <div style={{ padding: '0 16px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <img src="/favicon.svg" width={28} height={28} style={{ borderRadius: 7, flexShrink: 0 }} alt="logo" />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: -0.3 }}>Portfolio</span>
      </div>

      {/* 테마 토글 */}
      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        style={{
          margin: '0 8px',
          height: 36,
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
          background: 'transparent', border: 'none', borderRadius: 8,
          color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>
          {theme === 'dark' ? '☀️' : '🌙'}
        </span>
        <span>{theme === 'dark' ? '라이트 모드' : '다크 모드'}</span>
      </button>

      <div style={{ height: 1, background: 'var(--border-primary)', margin: '6px 8px' }} />

      {/* 네비게이션 */}
      {items.map(({ page, icon, label }) => {
        const active = current === page;
        return (
          <button
            key={page}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(page)}
            style={{
              margin: '0 8px',
              height: 38,
              display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px',
              background: active ? 'var(--bg-tertiary)' : 'transparent',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              outline: active ? '1px solid var(--border-primary)' : 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-secondary)'; }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{
              fontSize: 12,
              fontWeight: active ? 700 : 400,
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              letterSpacing: -0.2,
              transition: 'color 0.15s, font-weight 0.1s',
            }}>{label}</span>
            {active && (
              <div style={{
                width: 3, height: 18, borderRadius: 2,
                background: 'var(--accent)',
                marginLeft: 'auto', flexShrink: 0,
              }} />
            )}
          </button>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* 로그아웃 */}
      <button
        onClick={() => supabase.auth.signOut()}
        style={{
          margin: '0 8px',
          height: 36,
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px',
          background: 'transparent', border: 'none', borderRadius: 8,
          color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>↩</span>
        <span>로그아웃</span>
      </button>
    </nav>
  );
}
