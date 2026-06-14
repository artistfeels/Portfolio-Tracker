import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchPrice, fetchUsdKrw } from '../lib/prices';
import type { WatchlistItem } from '../lib/types';
import StockLogo from '../components/StockLogo';
import TvModal, { toTvSymbol } from '../components/TvModal';

interface Props {
  usdKrw: number;
  isMobile?: boolean;
  theme?: 'light' | 'dark';
}

interface WatchlistRow extends WatchlistItem {
  current_price_krw: number | null;
  current_price_usd: number | null;
  daily_change_pct: number | null;
  loading: boolean;
  editingTarget: boolean;
  editTargetVal: string;
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
CREATE POLICY "Users can manage own watchlist"
  ON watchlist FOR ALL USING (auth.uid() = user_id);`;

const UP   = 'var(--up)';
const DOWN = 'var(--down)';

async function resolveTickerName(ticker: string): Promise<{ name: string; region: '한국' | '해외' }> {
  const sym = /^\d{6}$/.test(ticker) ? `${ticker}.KS`
    : /^\d{4}$/.test(ticker) ? `${ticker}.HK`
    : ticker.toUpperCase();
  try {
    const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`);
    const j = await res.json();
    const meta = j?.chart?.result?.[0]?.meta;
    const name = meta?.longName ?? meta?.shortName ?? '';
    const region: '한국' | '해외' = /^\d{6}$/.test(ticker) ? '한국' : '해외';
    return { name, region };
  } catch {
    return { name: '', region: /^\d{6}$/.test(ticker) ? '한국' : '해외' };
  }
}

export default function Watchlist({ usdKrw, isMobile, theme = 'dark' }: Props) {
  const [items, setItems]             = useState<WatchlistRow[]>([]);
  const [tableExists, setTableExists] = useState<boolean | null>(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [ticker, setTicker]           = useState('');
  const [name,   setName]             = useState('');
  const [region, setRegion]           = useState<'한국' | '해외'>('해외');
  const [resolving, setResolving]     = useState(false);
  const [formErr, setFormErr]         = useState('');
  const [copied, setCopied]           = useState(false);
  const [tvTicker, setTvTicker]       = useState<string | null>(null);
  const [tvName,   setTvName]         = useState('');
  const rateRef = useRef(usdKrw || 1380);

  useEffect(() => { rateRef.current = usdKrw || 1380; }, [usdKrw]);

  const loadItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('watchlist')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) { setTableExists(false); return; }
    setTableExists(true);

    const rows: WatchlistRow[] = (data ?? []).map(d => ({
      ...d,
      target_price_krw: d.target_price_krw ? Number(d.target_price_krw) : null,
      current_price_krw: null,
      current_price_usd: null,
      daily_change_pct: null,
      loading: true,
      editingTarget: false,
      editTargetVal: '',
    }));
    setItems(rows);

    const rate = rateRef.current > 0 ? rateRef.current : await fetchUsdKrw();
    rateRef.current = rate;

    for (const row of rows) {
      fetchPrice(row.ticker, rate).then(p => {
        const isKorean = /^\d{6}$/.test(row.ticker);
        const usdPrice = !isKorean && rate > 0 && p.price_krw ? p.price_krw / rate : null;
        setItems(prev => prev.map(x =>
          x.id === row.id
            ? { ...x, current_price_krw: p.price_krw || null, current_price_usd: usdPrice, daily_change_pct: p.daily_change_pct, loading: false }
            : x
        ));
      });
      await new Promise(r => setTimeout(r, 180));
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  async function handleTickerBlur() {
    const t = ticker.trim().toUpperCase();
    if (!t || resolving) return;
    setResolving(true);
    setName('...');
    const { name: resolved, region: detectedRegion } = await resolveTickerName(t);
    setName(resolved || '');
    setRegion(detectedRegion);
    setResolving(false);
  }

  async function addItem() {
    const t = ticker.trim().toUpperCase();
    if (!t) { setFormErr('티커를 입력하세요.'); return; }
    setFormErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('watchlist').insert({
      user_id: user.id, ticker: t, name: name.trim() || t, target_price_krw: null, region,
    });
    if (error) {
      if (error.code === '23505') { setFormErr('이미 관심목록에 있는 종목입니다.'); return; }
      setFormErr(error.message); return;
    }
    setTicker(''); setName(''); setRegion('해외');
    setShowAdd(false);
    loadItems();
  }

  async function removeItem(id: string) {
    await supabase.from('watchlist').delete().eq('id', id);
    setItems(prev => prev.filter(x => x.id !== id));
  }

  function startEditTarget(id: string, current: number | null) {
    setItems(prev => prev.map(x => x.id === id
      ? { ...x, editingTarget: true, editTargetVal: current ? String(current) : '' }
      : { ...x, editingTarget: false }
    ));
  }

  async function saveTarget(id: string) {
    const item = items.find(x => x.id === id);
    if (!item) return;
    const val = item.editTargetVal.trim() ? Number(item.editTargetVal) : null;
    await supabase.from('watchlist').update({ target_price_krw: val }).eq('id', id);
    setItems(prev => prev.map(x => x.id === id ? { ...x, target_price_krw: val, editingTarget: false } : x));
  }

  const pd = isMobile ? '16px 12px' : '24px 28px';
  const thSt: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontWeight: 600, fontSize: 11,
    color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-primary)', whiteSpace: 'nowrap',
  };
  const tdSt: React.CSSProperties = {
    padding: isMobile ? '8px 8px' : '9px 14px',
    textAlign: 'right', fontSize: isMobile ? 12 : 13,
    borderBottom: '1px solid var(--border-primary)',
    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--text-primary)',
  };

  return (
    <div style={{ padding: pd, color: 'var(--text-primary)' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>관심종목</h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>실시간 시세 · 목표가 · 종목명 클릭 시 TradingView 차트</p>
        </div>
        {tableExists && (
          <button
            onClick={() => { setShowAdd(v => !v); setFormErr(''); setTicker(''); setName(''); }}
            style={{ padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: showAdd ? 'var(--bg-tertiary)' : 'var(--accent)', border: '1px solid var(--border-primary)', color: showAdd ? 'var(--text-secondary)' : '#fff' }}
          >
            {showAdd ? '취소' : '+ 종목 추가'}
          </button>
        )}
      </div>

      {/* SQL 설정 안내 */}
      {tableExists === false && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>초기 설정 필요</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>Supabase Dashboard → SQL Editor에서 아래 SQL을 실행하세요.</div>
          <div style={{ position: 'relative' }}>
            <pre style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)', borderRadius: 8, padding: '14px 16px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap' }}>{SETUP_SQL}</pre>
            <button onClick={() => { navigator.clipboard.writeText(SETUP_SQL); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{ position: 'absolute', top: 8, right: 8, padding: '4px 10px', fontSize: 11, borderRadius: 5, background: copied ? '#22c55e' : 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', cursor: 'pointer', color: copied ? '#fff' : 'var(--text-secondary)' }}>
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <button onClick={() => loadItems()} style={{ marginTop: 14, padding: '8px 16px', borderRadius: 8, fontSize: 12, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer' }}>
            설정 완료 후 새로고침
          </button>
        </div>
      )}

      {/* 추가 폼 */}
      {showAdd && tableExists && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: 10, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14 }}>종목 추가</div>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 5 }}>티커 *</div>
              <input value={ticker} onChange={e => setTicker(e.target.value)} onBlur={handleTickerBlur} onKeyDown={e => e.key === 'Enter' && handleTickerBlur()} placeholder="AAPL / 005930" style={{ ...inputSt, width: isMobile ? '100%' : 130 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 5 }}>종목명 {resolving && <span style={{ color: 'var(--text-muted)' }}>조회 중...</span>}</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="자동 입력" style={{ ...inputSt, width: '100%' }} />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 5 }}>구분</div>
              <select value={region} onChange={e => setRegion(e.target.value as '한국' | '해외')} style={{ ...inputSt, width: 80 }}>
                <option value="해외">해외</option>
                <option value="한국">한국</option>
              </select>
            </div>
            <button onClick={addItem} disabled={resolving} style={{ padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, flexShrink: 0, background: 'var(--accent)', border: 'none', color: '#fff', cursor: resolving ? 'default' : 'pointer', opacity: resolving ? 0.6 : 1 }}>
              추가
            </button>
          </div>
          {formErr && <div style={{ fontSize: 11, color: UP, marginTop: 8 }}>{formErr}</div>}
        </div>
      )}

      {/* 빈 상태 */}
      {tableExists && items.length === 0 && !showAdd && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⭐</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>관심종목이 없습니다</div>
          <div style={{ fontSize: 12, marginBottom: 20 }}>티커를 추가하면 실시간 시세와 목표가를 모니터링할 수 있습니다</div>
          <button onClick={() => setShowAdd(true)} style={{ padding: '10px 24px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer' }}>
            + 첫 종목 추가하기
          </button>
        </div>
      )}

      {/* 목록 — 모바일은 카드 */}
      {tableExists && items.length > 0 && isMobile && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => {
            const cur = item.current_price_krw;
            const tgt = item.target_price_krw;
            const gap = cur && tgt ? ((tgt - cur) / cur * 100) : null;
            const chg = item.daily_change_pct;
            const reached = gap != null && Math.abs(gap) < 0.5;
            const isKorean = /^\d{6}$/.test(item.ticker);
            return (
              <div key={item.id} style={{ background: reached ? 'rgba(207,34,46,0.06)' : 'var(--bg-card)', border: `1px solid ${reached ? 'var(--up)' : 'var(--border-primary)'}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0 }}
                    onClick={() => { setTvTicker(toTvSymbol(item.ticker)); setTvName(item.name || item.ticker); }}
                  >
                    <StockLogo ticker={item.ticker} name={item.name} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.name || item.ticker}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.ticker} · {item.region} · 📊 차트</div>
                    </div>
                  </div>
                  <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, padding: '4px 6px', flexShrink: 0, minHeight: 36 }}>✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px 8px' }}>
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>현재가 (원)</div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {item.loading ? <span className="skeleton" style={{ display: 'inline-block', width: 70, height: 13 }} /> : cur ? '₩' + cur.toLocaleString('ko-KR') : '–'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>현재가 ($)</div>
                    <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {item.loading ? <span className="skeleton" style={{ display: 'inline-block', width: 50, height: 13 }} /> : isKorean ? '–' : item.current_price_usd ? '$' + item.current_price_usd.toFixed(2) : '–'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>전일대비</div>
                    <div style={{ fontSize: 14, fontWeight: chg != null ? 700 : 400, color: chg == null ? 'var(--text-muted)' : chg >= 0 ? UP : DOWN, fontVariantNumeric: 'tabular-nums' }}>
                      {chg == null ? '–' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>목표까지</div>
                    <div style={{ fontSize: 14, fontWeight: gap != null ? 700 : 400, color: gap == null ? 'var(--text-muted)' : gap >= 0 ? UP : DOWN, fontVariantNumeric: 'tabular-nums' }}>
                      {gap == null ? '–' : reached ? '🎯 도달!' : (gap >= 0 ? '+' : '') + gap.toFixed(2) + '%'}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>목표가</span>
                  {item.editingTarget ? (
                    <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                      <input
                        type="number" autoFocus value={item.editTargetVal}
                        onChange={e => setItems(prev => prev.map(x => x.id === item.id ? { ...x, editTargetVal: e.target.value } : x))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveTarget(item.id);
                          if (e.key === 'Escape') setItems(prev => prev.map(x => x.id === item.id ? { ...x, editingTarget: false } : x));
                        }}
                        style={{ ...inputSt, flex: 1, padding: '7px 8px', fontSize: 13, minHeight: 36 }}
                        placeholder="목표가(원)"
                      />
                      <button onClick={() => saveTarget(item.id)} style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer', minHeight: 36 }}>저장</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditTarget(item.id, item.target_price_krw)}
                      style={{ background: 'none', border: `1px dashed ${tgt ? 'var(--border-primary)' : 'var(--text-muted)'}`, borderRadius: 6, padding: '7px 12px', cursor: 'pointer', color: tgt ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 13, fontVariantNumeric: 'tabular-nums', minHeight: 36, flex: 1, textAlign: 'left' }}
                    >
                      {tgt ? '₩' + tgt.toLocaleString('ko-KR') : '+ 목표가 설정'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 목록 테이블 (데스크탑) */}
      {tableExists && items.length > 0 && !isMobile && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thSt, textAlign: 'left' }}>종목</th>
                <th style={thSt}>현재가 (원)</th>
                {!isMobile && <th style={thSt}>현재가 ($)</th>}
                <th style={thSt}>전일대비</th>
                <th style={thSt}>목표가</th>
                <th style={thSt}>목표까지</th>
                <th style={{ ...thSt, textAlign: 'center' }}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const cur = item.current_price_krw;
                const tgt = item.target_price_krw;
                const gap = cur && tgt ? ((tgt - cur) / cur * 100) : null;
                const chg = item.daily_change_pct;
                const reached = gap != null && Math.abs(gap) < 0.5;
                const isKorean = /^\d{6}$/.test(item.ticker);

                return (
                  <tr key={item.id} style={{ background: reached ? 'rgba(207,34,46,0.05)' : undefined }}>
                    <td style={{ ...tdSt, textAlign: 'left' }}>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                        onClick={() => { setTvTicker(toTvSymbol(item.ticker)); setTvName(item.name || item.ticker); }}
                        title="TradingView 차트 보기"
                      >
                        <StockLogo ticker={item.ticker} name={item.name} size={30} />
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--accent)', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
                            {item.name || item.ticker}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.ticker} · {item.region}</div>
                        </div>
                      </div>
                    </td>
                    <td style={tdSt}>
                      {item.loading
                        ? <span className="skeleton" style={{ display: 'inline-block', width: 70, height: 13 }} />
                        : cur ? '₩' + cur.toLocaleString('ko-KR') : '–'}
                    </td>
                    {!isMobile && (
                      <td style={tdSt}>
                        {item.loading
                          ? <span className="skeleton" style={{ display: 'inline-block', width: 55, height: 13 }} />
                          : isKorean ? '–'
                          : item.current_price_usd ? '$' + item.current_price_usd.toFixed(2) : '–'}
                      </td>
                    )}
                    <td style={{ ...tdSt, color: chg == null ? 'var(--text-muted)' : chg >= 0 ? UP : DOWN, fontWeight: chg != null ? 600 : 400 }}>
                      {chg == null ? '–' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}
                    </td>
                    <td style={tdSt}>
                      {item.editingTarget ? (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <input
                            type="number" autoFocus value={item.editTargetVal}
                            onChange={e => setItems(prev => prev.map(x => x.id === item.id ? { ...x, editTargetVal: e.target.value } : x))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveTarget(item.id);
                              if (e.key === 'Escape') setItems(prev => prev.map(x => x.id === item.id ? { ...x, editingTarget: false } : x));
                            }}
                            style={{ ...inputSt, width: 90, padding: '4px 8px', fontSize: 12 }}
                            placeholder="목표가(원)"
                          />
                          <button onClick={() => saveTarget(item.id)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, background: 'var(--accent)', border: 'none', color: '#fff', cursor: 'pointer' }}>저장</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEditTarget(item.id, item.target_price_krw)}
                          style={{ background: 'none', border: `1px dashed ${tgt ? 'var(--border-primary)' : 'var(--text-muted)'}`, borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: tgt ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {tgt ? '₩' + tgt.toLocaleString('ko-KR') : '+ 설정'}
                        </button>
                      )}
                    </td>
                    <td style={{ ...tdSt, color: gap == null ? 'var(--text-muted)' : gap >= 0 ? UP : DOWN, fontWeight: gap != null ? 700 : 400 }}>
                      {gap == null ? '–' : reached ? '🎯 도달!' : (gap >= 0 ? '+' : '') + gap.toFixed(2) + '%'}
                    </td>
                    <td style={{ ...tdSt, textAlign: 'center' }}>
                      <button onClick={() => removeItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 6px' }}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TvModal ticker={tvTicker} name={tvName} theme={theme} onClose={() => setTvTicker(null)} />
    </div>
  );
}

const inputSt: React.CSSProperties = {
  background: 'var(--bg-primary)', border: '1px solid var(--border-primary)',
  borderRadius: 6, padding: '8px 12px', color: 'var(--text-primary)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
