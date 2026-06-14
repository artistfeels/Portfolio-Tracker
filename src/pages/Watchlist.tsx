import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchPrice, fetchUsdKrw } from '../lib/prices';
import type { WatchlistItem } from '../lib/types';

interface Props {
  usdKrw: number;
  isMobile?: boolean;
}

interface WatchlistWithPrice extends WatchlistItem {
  current_price_krw: number | null;
  daily_change_pct: number | null;
  loading: boolean;
}

const SETUP_SQL = `-- Supabase SQL Editor에서 실행
CREATE TABLE IF NOT EXISTS watchlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  name text NOT NULL DEFAULT '',
  target_price_krw numeric,
  region text NOT NULL DEFAULT '해외',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ticker)
);
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own watchlist" ON watchlist
  FOR ALL USING (auth.uid() = user_id);`;

const UP = 'var(--up)';
const DOWN = 'var(--down)';

export default function Watchlist({ usdKrw, isMobile }: Props) {
  const [items, setItems] = useState<WatchlistWithPrice[]>([]);
  const [tableExists, setTableExists] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ticker: '', name: '', target_price_krw: '', region: '해외' as '한국' | '해외' });
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);

  const rateRef = { current: usdKrw || 1380 };

  const loadItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist') || error.message.includes('PGRST116') || error.code === 'PGRST116') {
        setTableExists(false);
      } else {
        setTableExists(false);
      }
      return;
    }

    setTableExists(true);
    const withPrices: WatchlistWithPrice[] = (data ?? []).map(d => ({
      ...d,
      target_price_krw: d.target_price_krw ? Number(d.target_price_krw) : null,
      current_price_krw: null,
      daily_change_pct: null,
      loading: true,
    }));
    setItems(withPrices);

    // fetch prices progressively
    const rate = usdKrw > 0 ? usdKrw : await fetchUsdKrw();
    rateRef.current = rate;

    for (const item of withPrices) {
      if (item.ticker === 'CASH') continue;
      fetchPrice(item.ticker, rate).then(p => {
        setItems(prev => prev.map(x =>
          x.ticker === item.ticker
            ? { ...x, current_price_krw: p.price_krw || null, daily_change_pct: p.daily_change_pct, loading: false }
            : x
        ));
      });
      await new Promise(r => setTimeout(r, 150));
    }
  }, [usdKrw]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadItems(); }, [loadItems]);

  async function addItem() {
    if (!form.ticker.trim()) { setFormError('티커를 입력하세요.'); return; }
    if (!form.name.trim()) { setFormError('종목명을 입력하세요.'); return; }
    setFormError('');

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('watchlist').insert({
      user_id: user.id,
      ticker: form.ticker.trim().toUpperCase(),
      name: form.name.trim(),
      target_price_krw: form.target_price_krw ? Number(form.target_price_krw) : null,
      region: form.region,
    });

    if (error) {
      if (error.code === '23505') { setFormError('이미 관심목록에 있는 종목입니다.'); return; }
      setFormError(error.message);
      return;
    }

    setForm({ ticker: '', name: '', target_price_krw: '', region: '해외' });
    setAdding(false);
    loadItems();
  }

  async function removeItem(id: string) {
    await supabase.from('watchlist').delete().eq('id', id);
    setItems(prev => prev.filter(x => x.id !== id));
  }

  const pd = isMobile ? '16px 12px' : '24px 32px';

  const thStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontWeight: 600, fontSize: 11,
    color: 'var(--text-secondary)', whiteSpace: 'nowrap',
    borderBottom: '1px solid var(--border-primary)',
  };
  const tdStyle: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontSize: isMobile ? 12 : 13,
    borderBottom: '1px solid var(--border-primary)',
    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
  };

  return (
    <div style={{ padding: pd, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px' }}>관심종목</h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>목표가 설정 및 현재가 모니터링</p>
        </div>
        {tableExists && (
          <button onClick={() => setAdding(v => !v)} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            background: adding ? 'var(--bg-tertiary)' : 'var(--accent)',
            border: '1px solid var(--border-primary)', cursor: 'pointer',
            color: adding ? 'var(--text-secondary)' : '#fff',
          }}>
            {adding ? '취소' : '+ 종목 추가'}
          </button>
        )}
      </div>

      {/* 테이블 없을 때 설정 안내 */}
      {tableExists === false && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
          borderRadius: 10, padding: 20,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>초기 설정 필요</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
            Supabase Dashboard → SQL Editor에서 아래 SQL을 실행해주세요.
          </div>
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
              borderRadius: 8, padding: '14px 16px', fontSize: 11,
              fontFamily: 'monospace', color: 'var(--text-secondary)',
              overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap',
            }}>
              {SETUP_SQL}
            </pre>
            <button onClick={() => { navigator.clipboard.writeText(SETUP_SQL); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{
                position: 'absolute', top: 8, right: 8,
                padding: '4px 10px', fontSize: 11, borderRadius: 5,
                background: copied ? '#22c55e' : 'var(--bg-tertiary)',
                border: '1px solid var(--border-primary)', cursor: 'pointer',
                color: copied ? '#fff' : 'var(--text-secondary)',
              }}>
              {copied ? '복사됨!' : '복사'}
            </button>
          </div>
          <button onClick={loadItems} style={{
            marginTop: 14, padding: '8px 16px', borderRadius: 8, fontSize: 12,
            background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer',
          }}>
            설정 완료 후 새로고침
          </button>
        </div>
      )}

      {/* 종목 추가 폼 */}
      {adding && tableExists && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--accent)',
          borderRadius: 10, padding: '16px', marginBottom: 16,
          display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr auto auto', gap: 10,
          alignItems: 'end',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>티커 *</div>
            <input value={form.ticker} onChange={e => setForm(f => ({ ...f, ticker: e.target.value }))}
              placeholder="AAPL / 000660" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>종목명 *</div>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Apple Inc." style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>목표가 (원, 선택)</div>
            <input type="number" value={form.target_price_krw} onChange={e => setForm(f => ({ ...f, target_price_krw: e.target.value }))}
              placeholder="200000" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>구분</div>
            <select value={form.region} onChange={e => setForm(f => ({ ...f, region: e.target.value as '한국' | '해외' }))} style={inputStyle}>
              <option value="해외">해외</option>
              <option value="한국">한국</option>
            </select>
          </div>
          <button onClick={addItem} style={{
            padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer',
            alignSelf: 'end',
          }}>
            추가
          </button>
          {formError && <div style={{ fontSize: 11, color: UP, gridColumn: '1/-1' }}>{formError}</div>}
        </div>
      )}

      {/* 관심종목 테이블 */}
      {tableExists && (
        items.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            관심 종목을 추가하세요.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>종목</th>
                  <th style={thStyle}>현재가</th>
                  <th style={thStyle}>목표가</th>
                  <th style={thStyle}>목표까지</th>
                  {!isMobile && <th style={thStyle}>전일대비</th>}
                  <th style={{ ...thStyle, textAlign: 'center' }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const cur = item.current_price_krw;
                  const tgt = item.target_price_krw;
                  const gapPct = cur && tgt ? ((tgt - cur) / cur * 100) : null;
                  const chg = item.daily_change_pct;
                  return (
                    <tr key={item.id}>
                      <td style={{ ...tdStyle, textAlign: 'left' }}>
                        <div style={{ fontWeight: 600 }}>{item.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.ticker} · {item.region}</div>
                      </td>
                      <td style={tdStyle}>
                        {item.loading
                          ? <span className="skeleton" style={{ display: 'inline-block', width: 64, height: 13 }} />
                          : cur ? '₩' + cur.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>
                        {tgt ? '₩' + tgt.toLocaleString('ko-KR') : '-'}
                      </td>
                      <td style={{ ...tdStyle, color: gapPct == null ? 'var(--text-muted)' : gapPct >= 0 ? UP : DOWN, fontWeight: gapPct != null ? 600 : 400 }}>
                        {gapPct == null ? '-' : (gapPct >= 0 ? '+' : '') + gapPct.toFixed(2) + '%'}
                      </td>
                      {!isMobile && (
                        <td style={{ ...tdStyle, color: chg == null ? 'var(--text-muted)' : chg >= 0 ? UP : DOWN }}>
                          {chg == null ? '-' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}
                        </td>
                      )}
                      <td style={{ ...tdStyle, textAlign: 'center' }}>
                        <button onClick={() => removeItem(item.id)} style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 14, padding: '2px 6px',
                        }}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)', borderRadius: 6,
  padding: '8px 12px', color: 'var(--text-primary)', fontSize: 13,
  outline: 'none', boxSizing: 'border-box',
};
