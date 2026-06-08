// src/pages/Transactions.tsx
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateTemplateCsv, downloadCsv, parseCsvToTransactions } from '../lib/csv';
import type { Transaction } from '../lib/types';

const ACTION_LABEL: Record<string, string> = {
  buy: '매수', sell: '매도', dividend: '배당', split: '분할',
};
const ACTION_COLOR: Record<string, string> = {
  buy: '#cf222e', sell: '#1f6feb', dividend: '#3fb950', split: '#8b949e',
};

function fmt(n: number) {
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
}

export default function Transactions() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .order('trade_date', { ascending: false });
    if (mountedRef.current) {
      setRows((data ?? []) as Transaction[]);
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function handleDownload() {
    downloadCsv('transactions_template.csv', generateTemplateCsv());
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

  async function handleConfirmUpload() {
    if (!preview) return;
    setUploading(true);
    const { error } = await supabase.from('transactions').insert(preview);
    if (!mountedRef.current) return;
    if (error) {
      setUploadResult(`오류: ${error.message}`);
      setUploadError(true);
    } else {
      setUploadResult(`✓ ${preview.length}건 추가됨`);
      setUploadError(false);
      setPreview(null);
      load();
    }
    setUploading(false);
  }

  function handleModalKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') setPreview(null);
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      {/* 헤더 툴바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>거래내역</span>
        <span style={{ color: '#8b949e', fontSize: 13, flex: 1 }}>총 {rows.length}건</span>
        <button
          onClick={handleDownload}
          style={{ background: '#238636', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬇ CSV 템플릿
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          style={{ background: '#1f6feb', border: 'none', color: '#fff', padding: '7px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
        >
          ⬆ CSV 업로드
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFileChange} />
      </div>

      {uploadResult && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 13, color: uploadError ? '#cf222e' : '#3fb950' }}>
          {uploadResult}
        </div>
      )}

      {/* 업로드 미리보기 모달 */}
      {preview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="업로드 미리보기"
          onKeyDown={handleModalKeyDown}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 24, width: 600, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>업로드 미리보기 — {preview.length}건</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#21262d', color: '#8b949e' }}>
                  {['날짜', '티커', '종목명', '구분', '수량', '단가'].map((h) => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #21262d' }}>
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
            {preview.length > 20 && <div style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>… 외 {preview.length - 20}건</div>}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={handleConfirmUpload}
                disabled={uploading}
                style={{ background: '#238636', border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                {uploading ? '업로드 중...' : '확인 — Supabase에 추가'}
              </button>
              <button
                onClick={() => setPreview(null)}
                style={{ background: '#21262d', border: '1px solid #30363d', color: '#e6edf3', padding: '8px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거래내역 테이블 */}
      {loading ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>로딩 중...</div>
      ) : (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#21262d', color: '#8b949e' }}>
                {['날짜', '종목명', '티커', '구분', '수량', '단가(KRW)', '섹터', '지역'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} style={{ borderTop: '1px solid #21262d', background: i % 2 === 0 ? 'transparent' : '#0d1117' }}>
                  <td style={{ padding: '8px 14px' }}>{r.trade_date}</td>
                  <td style={{ padding: '8px 14px', fontWeight: 500 }}>{r.name}</td>
                  <td style={{ padding: '8px 14px', color: '#8b949e', fontSize: 11 }}>{r.ticker}</td>
                  <td style={{ padding: '8px 14px', color: ACTION_COLOR[r.action] }}>{ACTION_LABEL[r.action]}</td>
                  <td style={{ padding: '8px 14px' }}>{r.shares.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{fmt(r.price_krw)}</td>
                  <td style={{ padding: '8px 14px', color: '#8b949e' }}>{r.sector ?? '-'}</td>
                  <td style={{ padding: '8px 14px' }}>{r.region}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
