import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Page } from './lib/types';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import { usePortfolio } from './hooks/usePortfolio';
import { useIsMobile } from './hooks/useIsMobile';
import { supabase } from './lib/supabaseClient';

export type Theme = 'light' | 'dark';

// ─── 로그인 화면 ───────────────────────────────────────────────────────────────

function LoginPage({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleLogin() {
    if (!email || !password) return;
    setLoading(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) setError(err.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 틀렸습니다.' : err.message);
    setLoading(false);
  }

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: '100%', minHeight: '100vh', background: 'var(--bg-primary)',
    }}>
      {/* 테마 토글 버튼 */}
      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
        style={{
          position: 'absolute', top: 20, right: 20, zIndex: 10,
          background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 10, width: 40, height: 40,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18, transition: 'all 0.2s ease',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        }}
      >
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      {/* Aurora 배경 */}
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      <div className="aurora-orb aurora-orb-3" />
      <div className="aurora-orb aurora-orb-4" />
      <div className="aurora-orb aurora-orb-5" />

      {/* 글래스 카드 */}
      <div
        className="glass-card"
        style={{
          position: 'relative', zIndex: 2,
          borderRadius: 18,
          padding: '44px 52px',
          display: 'flex', flexDirection: 'column', gap: 14,
          width: 340,
          animation: 'fadeSlideIn 0.5s ease',
        }}
      >
        {/* 로고 영역 */}
        <div style={{ marginBottom: 4 }}>
          <div style={{
            fontSize: 24, fontWeight: 800, letterSpacing: '-0.04em',
            background: 'linear-gradient(120deg, #a78bfa 0%, #38bdf8 55%, #34d399 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            marginBottom: 4,
          }}>
            Portfolio Tracker
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>계정으로 로그인하세요</div>
        </div>

        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="이메일"
          autoFocus
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          placeholder="비밀번호"
          style={inputStyle}
        />

        {error && <div style={{ fontSize: 12, color: 'var(--up)' }}>{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            background: loading
              ? 'var(--bg-tertiary)'
              : 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)',
            border: 'none', borderRadius: 8, padding: '11px 0',
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer', marginTop: 4,
            boxShadow: loading ? 'none' : '0 4px 20px rgba(124,58,237,0.4)',
            transition: 'all 0.2s ease',
          }}
        >
          {loading ? '로그인 중...' : '로그인'}
        </button>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 6,
  padding: '10px 14px', color: 'var(--text-primary)', fontSize: 14, outline: 'none',
};

// ─── 인증된 메인 앱 ────────────────────────────────────────────────────────────

function AuthenticatedApp({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  const [page, setPage] = useState<Page>('dashboard');
  const portfolio = usePortfolio();
  const isMobile = useIsMobile();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'sans-serif' }}>
      <Sidebar current={page} onNavigate={setPage} theme={theme} onToggleTheme={onToggleTheme} isMobile={isMobile} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0, paddingBottom: isMobile ? 64 : 0 }}>
        <div style={{ display: page === 'dashboard'    ? 'block' : 'none' }}><Dashboard portfolio={portfolio} theme={theme} isMobile={isMobile} /></div>
        <div style={{ display: page === 'transactions' ? 'block' : 'none' }}><Transactions isMobile={isMobile} /></div>
        <div style={{ display: page === 'analytics'   ? 'block' : 'none' }}><Analytics portfolio={portfolio} isMobile={isMobile} /></div>
      </main>
    </div>
  );
}

// ─── 루트 ─────────────────────────────────────────────────────────────────────

export default function App() {
  // undefined = 아직 로딩 중, null = 비로그인, Session = 로그인됨
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('portfolio_theme') as Theme | null) ?? 'dark'
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('portfolio_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    document.documentElement.classList.add('theme-transitioning');
    setTheme(t => (t === 'dark' ? 'light' : 'dark'));
    setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 700);
  };

  if (session === undefined) return null; // 세션 확인 중 (순간적)
  if (session === null) return <LoginPage theme={theme} onToggleTheme={toggleTheme} />;
  return <AuthenticatedApp theme={theme} onToggleTheme={toggleTheme} />;
}
