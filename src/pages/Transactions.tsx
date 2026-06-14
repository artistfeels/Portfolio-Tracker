// src/pages/Transactions.tsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateTemplateCsv, downloadCsv, parseCsvToTransactions } from '../lib/csv';
import type { Transaction } from '../lib/types';

const ACTION_LABEL: Record<string, string> = {
  buy: '매수', sell: '매도', dividend: '배당', split: '분할',
};
const ACTION_COLOR: Record<string, string> = {
  buy: 'var(--up)', sell: 'var(--down)', dividend: '#3fb950', split: 'var(--text-secondary)',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

// ── 편집 폼 타입 ──────────────────────────────────────────────────────
type EditForm = {
  trade_date: string;
  ticker: string;
  name: string;
  action: Transaction['action'];
  shares: string;
  price_krw: string;
  region: '한국' | '해외';
  sector: string;
  asset_group: string;
  notes: string;
};

function makeForm(r?: Transaction): EditForm {
  return {
    trade_date: r?.trade_date ?? new Date().toISOString().slice(0, 10),
    ticker: r?.ticker ?? '',
    name: r?.name ?? '',
    action: r?.action ?? 'buy',
    shares: r != null ? String(r.shares) : '',
    price_krw: r != null ? String(r.price_krw) : '',
    region: r?.region ?? '해외',
    sector: r?.sector ?? '',
    asset_group: r?.asset_group ?? '',
    notes: r?.notes ?? '',
  };
}

function inferRegion(ticker: string): '한국' | '해외' {
  return /^\d{6}$/.test(ticker.trim()) ? '한국' : '해외';
}

const INP: React.CSSProperties = {
  background: 'var(--bg-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 4,
  padding: '5px 8px',
  color: 'var(--text-primary)',
  fontSize: 12,
  outline: 'none',
};

// ── 인라인 거래 폼 컴포넌트 ───────────────────────────────────────────
interface TxFormProps {
  title: string;
  form: EditForm;
  saving: boolean;
  onChange: (field: keyof EditForm, val: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function TxForm({ title, form, saving, onChange, onSave, onCancel }: TxFormProps) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--accent)',
      borderRadius: 8, padding: '12px 16px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>날짜</span>
          <input type="date" value={form.trade_date}
            onChange={e => onChange('trade_date', e.target.value)}
            style={{ ...INP, width: 130 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>티커</span>
          <input type="text" placeholder="NVDA / 000660" value={form.ticker}
            onChange={e => onChange('ticker', e.target.value)}
            style={{ ...INP, width: 100 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>종목명</span>
          <input type="text" placeholder="NVIDIA" value={form.name}
            onChange={e => onChange('name', e.target.value)}
            style={{ ...INP, width: 140 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>구분</span>
          <select value={form.action} onChange={e => onChange('action', e.target.value)}
            style={{ ...INP, width: 78 }}>
            <option value="buy">매수</option>
            <option value="sell">매도</option>
            <option value="dividend">배당</option>
            <option value="split">분할</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>수량</span>
          <input type="number" placeholder="0" min="0" value={form.shares}
            onChange={e => onChange('shares', e.target.value)}
            style={{ ...INP, width: 80 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>단가 (KRW)</span>
          <input type="number" placeholder="0" min="0" value={form.price_krw}
            onChange={e => onChange('price_krw', e.target.value)}
            style={{ ...INP, width: 120 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>지역</span>
          <select value={form.region} onChange={e => onChange('region', e.target.value)}
            style={{ ...INP, width: 72 }}>
            <option value="해외">해외</option>
            <option value="한국">한국</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>섹터</span>
          <input type="text" placeholder="선택사항" value={form.sector}
            onChange={e => onChange('sector', e.target.value)}
            style={{ ...INP, width: 90 }} />
        </label>
        <div style={{ display: 'flex', gap: 6, alignSelf: 'flex-end' }}>
          <button onClick={onSave} disabled={saving}
            style={{
              background: '#238636', border: 'none', color: '#fff',
              padding: '6px 16px', borderRadius: 5, fontSize: 12,
              cursor: saving ? 'default' : 'pointer', fontWeight: 600,
            }}>
            {saving ? '저장 중...' : '저장'}
          </button>
          <button onClick={onCancel}
            style={{
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)', padding: '6px 12px', borderRadius: 5,
              fontSize: 12, cursor: 'pointer',
            }}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────
export default function Transactions() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingNew, setAddingNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>(makeForm());
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [preview, setPreview] = useState<Omit<Transaction, 'id'>[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .order('trade_date', { ascending: false });
    if (mountedRef.current) {
      setRows((data ?? []) as Transaction[]);
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // ── CSV ────────────────────────────────────────────────────────────
  function handleDownloadTemplate() {
    downloadCsv('transactions_template.csv', generateTemplateCsv());
  }

  function handleExportCsv() {
    const headers = ['trade_date', 'ticker', 'name', 'action', 'shares', 'price_krw',
      'sector', 'region', 'asset_group', 'funding_source', 'notes'];
    const lines = [
      headers.join(','),
      ...[...rows].reverse().map(r =>
        [r.trade_date, r.ticker, r.name, r.action, r.shares, r.price_krw,
          r.sector ?? '', r.region, r.asset_group ?? '', r.funding_source ?? '', r.notes ?? ''
        ].join(',')
      ),
    ];
    downloadCsv(`transactions_${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n') + '\n');
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsvToTransactions(text);
      if (parsed.length === 0) {
        setUploadResult('오류: 유효한 행이 없습니다. CSV 형식을 확인하세요.');
        setUploadError(true);
        return;
      }
      setPreview(parsed);
      setUploadResult(null);
      setUploadError(false);
    };
    reader.onerror = () => {
      setUploadResult('오류: 파일을 읽을 수 없습니다.');
      setUploadError(true);
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  }

  async function handleConfirmUpload(replace: boolean) {
    if (!preview) return;
    setUploading(true);
    if (replace) {
      const { error: delErr } = await supabase
        .from('transactions').delete().gte('trade_date', '1900-01-01');
      if (delErr) {
        if (mountedRef.current) { setUploadResult(`삭제 오류: ${delErr.message}`); setUploadError(true); }
        setUploading(false);
        return;
      }
    }
    const { error } = await supabase.from('transactions').insert(preview);
    if (!mountedRef.current) return;
    if (error) {
      setUploadResult(`오류: ${error.message}`);
      setUploadError(true);
    } else {
      setUploadResult(replace ? `✓ 전체 교체 완료 — ${preview.length}건` : `✓ ${preview.length}건 추가됨`);
      setUploadError(false);
      setPreview(null);
      load();
    }
    setUploading(false);
  }

  function handleModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setPreview(null);
  }

  // ── 추가 / 수정 ────────────────────────────────────────────────────
  function startAdding() {
    setAddingNew(true);
    setEditingId(null);
    setDeleteConfirm(null);
    setForm(makeForm());
  }

  function startEditing(r: Transaction) {
    setEditingId(r.id);
    setAddingNew(false);
    setDeleteConfirm(null);
    setForm(makeForm(r));
  }

  function cancelEdit() {
    setAddingNew(false);
    setEditingId(null);
  }

  function updateForm(field: keyof EditForm, val: string) {
    setForm(prev => {
      const next = { ...prev, [field]: val };
      if (field === 'ticker') next.region = inferRegion(val);
      return next;
    });
  }

  async function handleSave() {
    const ticker = form.ticker.trim().toUpperCase();
    const shares = parseFloat(form.shares);
    const price_krw = parseFloat(form.price_krw);
    if (!ticker || !form.name.trim() || !form.trade_date || isNaN(shares) || isNaN(price_krw)) return;

    const payload: Omit<Transaction, 'id'> = {
      ticker,
      name: form.name.trim(),
      action: form.action,
      shares,
      price_krw,
      trade_date: form.trade_date,
      region: inferRegion(ticker),
      sector: form.sector.trim() || null,
      asset_group: form.asset_group.trim() || null,
      notes: form.notes.trim() || null,
      funding_source: null,
    };

    setSaving(true);
    if (editingId) {
      await supabase.from('transactions').update(payload).eq('id', editingId);
      setRows(prev => prev.map(r => r.id === editingId ? { ...r, ...payload } : r));
    } else {
      const { data } = await supabase.from('transactions').insert(payload).select().single();
      if (data) setRows(prev => [data as Transaction, ...prev]);
    }
    setSaving(false);
    cancelEdit();
    load(true);
  }

  async function handleDelete(id: string) {
    setRows(prev => prev.filter(r => r.id !== id));
    setDeleteConfirm(null);
    await supabase.from('transactions').delete().eq('id', id);
    load(true);
  }

  // ── 렌더 ──────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px 32px' }}>
      {/* 헤더 툴바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>거래내역</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 13, flex: 1 }}>총 {rows.length}건</span>
        <button
          onClick={startAdding}
          style={{ background: 'var(--accent, #1f6feb)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          + 새 거래
        </button>
        <button
          onClick={handleExportCsv}
          style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬇ CSV 내보내기
        </button>
        <button
          onClick={handleDownloadTemplate}
          style={{ background: '#238636', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬇ CSV 템플릿
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          style={{ background: 'var(--down)', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬆ CSV 업로드
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {/* 새 거래 폼 */}
      {addingNew && (
        <div style={{ marginBottom: 16 }}>
          <TxForm
            title="새 거래 추가"
            form={form}
            saving={saving}
            onChange={updateForm}
            onSave={handleSave}
            onCancel={cancelEdit}
          />
        </div>
      )}

      {uploadResult && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 6, fontSize: 13, color: uploadError ? 'var(--up)' : '#3fb950' }}>
          {uploadResult}
        </div>
      )}

      {/* CSV 업로드 미리보기 모달 */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="업로드 미리보기"
          onKeyDown={handleModalKeyDown}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 10, padding: 24, width: 600, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>업로드 미리보기 — {preview.length}건</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                  {['날짜', '티커', '종목명', '구분', '수량', '단가'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--bg-tertiary)' }}>
                    <td style={{ padding: '5px 10px' }}>{r.trade_date}</td>
                    <td style={{ padding: '5px 10px' }}>{r.ticker}</td>
                    <td style={{ padding: '5px 10px' }}>{r.name}</td>
                    <td style={{ padding: '5px 10px', color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action]}</td>
                    <td style={{ padding: '5px 10px' }}>{r.shares}</td>
                    <td style={{ padding: '5px 10px' }}>{fmt(r.price_krw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 20 && <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>… 외 {preview.length - 20}건</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button onClick={() => handleConfirmUpload(false)} disabled={uploading}
                style={{ background: '#238636', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: uploading ? 'default' : 'pointer' }}>
                {uploading ? '업로드 중...' : '추가'}
              </button>
              <button onClick={() => handleConfirmUpload(true)} disabled={uploading}
                style={{ background: 'var(--up, #cf222e)', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: uploading ? 'default' : 'pointer' }}>
                {uploading ? '처리 중...' : '전체 교체 (기존 삭제 후 업로드)'}
              </button>
              <button onClick={() => setPreview(null)}
                style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거래내역 테이블 */}
      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>로딩 중...</div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                {['날짜', '종목명', '티커', '구분', '수량', '단가(KRW)', '섹터', '지역', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 14px', textAlign: h === '' ? 'center' : 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isEditing = editingId === r.id;
                const isDeleteConfirm = deleteConfirm === r.id;

                if (isEditing) {
                  return (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--bg-tertiary)', background: 'var(--bg-primary)' }}>
                      <td colSpan={9} style={{ padding: 12 }}>
                        <TxForm
                          title="수정"
                          form={form}
                          saving={saving}
                          onChange={updateForm}
                          onSave={handleSave}
                          onCancel={cancelEdit}
                        />
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--bg-tertiary)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-primary)' }}>
                    <td style={{ padding: '8px 14px' }}>{r.trade_date}</td>
                    <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', fontSize: 11 }}>{r.ticker}</td>
                    <td style={{ padding: '8px 14px', color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action]}</td>
                    <td style={{ padding: '8px 14px' }}>{r.shares.toLocaleString()}</td>
                    <td style={{ padding: '8px 14px' }}>{fmt(r.price_krw)}</td>
                    <td style={{ padding: '8px 14px', color: 'var(--text-secondary)' }}>{r.sector ?? '-'}</td>
                    <td style={{ padding: '8px 14px' }}>{r.region}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {isDeleteConfirm ? (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => handleDelete(r.id)}
                            style={{ background: 'var(--up)', border: 'none', color: '#fff', padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                            삭제 확인
                          </button>
                          <button onClick={() => setDeleteConfirm(null)}
                            style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                            취소
                          </button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 4 }}>
                          <button onClick={() => startEditing(r)}
                            style={{ background: 'none', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                            수정
                          </button>
                          <button onClick={() => setDeleteConfirm(r.id)}
                            style={{ background: 'none', border: '1px solid var(--border-primary)', color: 'var(--up)', padding: '3px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
                            삭제
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
