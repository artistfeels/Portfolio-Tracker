import { useState } from 'react';
import type { Page } from './lib/types';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Transactions from './pages/Transactions';
import { usePortfolio } from './hooks/usePortfolio';

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const portfolio = usePortfolio();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'sans-serif' }}>
      <Sidebar current={page} onNavigate={setPage} />
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {page === 'dashboard'    && <Dashboard portfolio={portfolio} />}
        {page === 'analytics'   && <Analytics />}
        {page === 'transactions' && <Transactions />}
      </main>
    </div>
  );
}
