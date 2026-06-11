import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Page } from './lib/types';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import { usePortfolio } from './hooks/usePortfolio';
import { supabase } from './lib/supabaseClient';

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
      minHeight: '100vh', background: '#0d1117',
    }}>
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
        padding: '40px 48px', display: 'flex', flexDirection: 'column', gap: 14,
        width: 320,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#e6edf3' }}>Portfolio Tracker</div>
        <div style={{ fontSize: 13, color: '#8b949e', marginBottom: 4 }}>로그인하세요</div>

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

        {error && <div style={{ fontSize: 12, color: '#cf222e' }}>{error}</div>}

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            background: loading ? '#21262d' : '#1f6feb',
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
  background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
  padding: '10px 14px', color: '#e6edf3', fontSize: 14, outline: 'none',
};

// ─── 인증된 메인 앱 ────────────────────────────────────────────────────────────

function AuthenticatedApp() {
  const [page, setPage] = useState<Page>('dashboard');
  const portfolio = usePortfolio();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#0d1117', color: '#e6edf3', fontFamily: 'sans-serif' }}>
      <Sidebar current={page} onNavigate={setPage} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {page === 'dashboard'    && <Dashboard portfolio={portfolio} />}
        {page === 'transactions' && <Transactions />}
      </main>
    </div>
  );
}

// ─── 루트 ─────────────────────────────────────────────────────────────────────

export default function App() {
  // undefined = 아직 로딩 중, null = 비로그인, Session = 로그인됨
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // 세션 확인 중 (순간적)
  if (session === null) return <LoginPage />;
  return <AuthenticatedApp />;
}
