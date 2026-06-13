import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Page } from './lib/types';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Analytics from './pages/Analytics';
import { usePortfolio } from './hooks/usePortfolio';
import { supabase } from './lib/supabaseClient';

export type Theme = 'light' | 'dark';

// ─── 로그인 화면 ───────────────────────────────────────────────────────────────

function LoginPage() {
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
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg-primary)',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 12,
        padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 14,
        width: 320,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Portfolio Tracker</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>로그인하세요</div>

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
            background: loading ? 'var(--bg-tertiary)' : '#1f6feb',
            border: 'none', borderRadius: 6, padding: '10px 0',
            color: '#fff', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'default' : 'pointer', marginTop: 4,
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'sans-serif' }}>
      <Sidebar current={page} onNavigate={setPage} theme={theme} onToggleTheme={onToggleTheme} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        <div style={{ display: page === 'dashboard'    ? 'block' : 'none' }}><Dashboard portfolio={portfolio} /></div>
        <div style={{ display: page === 'transactions' ? 'block' : 'none' }}><Transactions /></div>
        <div style={{ display: page === 'analytics'   ? 'block' : 'none' }}><Analytics portfolio={portfolio} /></div>
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

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  if (session === undefined) return null; // 세션 확인 중 (순간적)
  if (session === null) return <LoginPage />;
  return <AuthenticatedApp theme={theme} onToggleTheme={toggleTheme} />;
}
