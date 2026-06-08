// 거래내역 161건 Supabase 임포트 스크립트
// 실행: node import_transactions.js
// 전제: 이 파일과 같은 폴더에 transactions_clean.csv 가 있어야 함

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bhhgskjirmbxdrwhnibz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJoaGdza2ppcm1ieGRyd2huaWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MjAwNjgsImV4cCI6MjA5NjE5NjA2OH0.2x2Ld0CDkfhMxmUjiC3vHZUPixuXX9mlIxviEleKv0M';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function main() {
  // 1) CSV 읽기
  const csvPath = path.join(__dirname, 'transactions_clean.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('X transactions_clean.csv 파일을 찾을 수 없어.');
    console.log('  이 스크립트와 같은 폴더에 transactions_clean.csv 를 넣어줘.');
    process.exit(1);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const { data, errors } = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // 모든 값을 문자열로 — Supabase가 알아서 타입 변환
  });

  if (errors.length > 0) {
    console.log('X CSV 파싱 오류:', errors);
    process.exit(1);
  }

  console.log(`CSV 파싱 완료: ${data.length}건`);

  // 2) 숫자 컬럼만 변환 (shares, price_krw)
  const rows = data.map((r) => ({
    ...r,
    shares: Number(r.shares),
    price_krw: Number(r.price_krw),
    notes: r.notes || null,
    sector: r.sector || null,
    asset_group: r.asset_group || null,
  }));

  // 3) 기존 데이터 있으면 중복 방지를 위해 먼저 비우기
  console.log('기존 transactions 테이블 비우는 중...');
  const { error: delError } = await supabase.from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delError) {
    console.log('X 삭제 오류:', delError.message);
    process.exit(1);
  }
  console.log('O 기존 데이터 삭제 완료');

  // 4) 50건씩 배치 인서트
  const BATCH = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase.from('transactions').insert(batch);
    if (error) {
      console.log(`X 배치 ${i}~${i + batch.length} 삽입 오류:`, error.message);
      process.exit(1);
    }
    inserted += batch.length;
    console.log(`  삽입 중... ${inserted}/${rows.length}`);
  }

  console.log(`\nO 완료: transactions 테이블에 ${inserted}건 삽입됨`);
}

main();
