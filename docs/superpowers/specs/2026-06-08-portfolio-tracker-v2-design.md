# Portfolio Tracker v2 — Design Spec
Date: 2026-06-08

## Overview

현재 단일 대시보드 페이지에서 사이드바 기반 다중 페이지 앱으로 확장.
총 3개 페이지: 대시보드(개선), 애널리틱스(신규), 거래내역(신규).

---

## 1. 앱 구조 — 사이드바 네비게이션

### 레이아웃
```
┌─────────────────────────────────────────────┐
│ [사이드바 120px] │ [메인 콘텐츠]             │
│                  │                          │
│  📊 대시보드      │  (선택된 페이지)          │
│  📈 애널리틱스    │                          │
│  📄 거래내역      │                          │
└─────────────────────────────────────────────┘
```

### 구현
- `App.tsx`에 `useState<Page>('dashboard')` 라우팅
- `Sidebar.tsx` 컴포넌트 (활성 페이지 하이라이트)
- 외부 라우터 라이브러리 불필요 (단일 사용자 앱)

---

## 2. 대시보드 페이지 개선

### 2-1. 종목명/티커 표시 순서 변경
- **현재**: 티커(bold, 큰 글씨) / 이름(작은 글씨)
- **변경**: **실제 종목명(bold, 큰 글씨)** / 티커(작은 글씨, #8b949e)
- 실제 종목명: Yahoo Finance `meta.longName` 우선, 없으면 `meta.shortName`, 없으면 기존 수동 입력값 fallback

### 2-2. 실제 종목명 fetch
- `prices.ts`의 `fetchYahoo()` 응답에서 `meta.longName` 추출
- `ticker_meta` Supabase 테이블에 캐시 (ticker, display_name, fetched_at)
- fetch 순서: ticker_meta 캐시 → Yahoo Finance → 수동 입력값 fallback
- 한국 ETF는 Yahoo가 영문명 반환 → ticker_meta에 한글명 수동 보정 가능

### 2-3. 종목 클릭 시 TradingView 차트 인라인 확장
- 종목 행 클릭 → 해당 행 아래에 차트 영역 펼쳐짐 (accordion)
- 같은 종목 재클릭 또는 다른 종목 클릭 → 기존 차트 닫힘
- 차트 라이브러리: **TradingView Lightweight Charts** (`lightweight-charts`)
  - 무료 오픈소스, iframe 불필요, TypeScript 지원
- 심볼 매핑 (Yahoo → Lightweight Charts용 실제 시세):
  - 한국 6자리 → `{ticker}.KS` or `.KQ` (Yahoo Finance 과거 시세)
  - 홍콩 4자리 → `{ticker}.HK`
  - GOLD → `XAUUSD=X` (Yahoo) → 차트는 USD/oz 표시
  - 미국 → 그대로
- 차트 데이터: Yahoo Finance historical API (`range=1y&interval=1d`)
- 차트 높이: 300px, 일봉 캔들스틱

### 2-4. 현금(CASH) 표시
- Supabase `cash_balance` 테이블 (amount_krw, note, record_date)
- 합산 잔고 > 0 이면 보유종목 테이블에 CASH 행 표시
- CASH 행: 수량/단가/현재가/손익 = `-`, 평가금액 = 잔고, 비중 = 정상 계산
- **현재 상태**: 코드는 구현됨, Supabase 테이블 생성 필요

### 2-5. GOLD 시세 버그 수정
- 현재 `manual`로 표시되는 원인 파악 후 수정
- `prices.ts`에 GOLD 처리 코드 존재 → DB에 `ticker='GOLD'` 거래 없거나 Yahoo fetch 실패
- 디버그: `XAUUSD=X` Yahoo 응답 로그 → vite proxy 설정 확인

---

## 3. 애널리틱스 페이지 (신규)

### 레이아웃 (2열 그리드)
```
┌──────────────────────────────────────────────┐
│ [IRR] [연환산] [MDD] [보유기간]  ← 4개 카드  │
├─────────────────┬────────────────────────────┤
│  자산 총액 추이  │  수익률 % 추이             │
│  (라인 차트)     │  (라인 차트)               │
├──────────────────────────────────────────────┤
│  종목별 IRR 테이블                            │
└──────────────────────────────────────────────┘
```

### 3-1. 상단 지표 카드
| 지표 | 계산 방법 |
|---|---|
| 포트폴리오 IRR | 거래내역 현금흐름 기반 이분법 솔버 (calc.ts) |
| 연환산 수익률 | `(최종평가/총투자)^(1/보유년수) - 1` |
| MDD | 자산 추이 데이터에서 최대 낙폭 |
| 보유 기간 | 첫 거래일 ~ 오늘 |

### 3-2. 자산 총액 추이 (실제 평가금액)
- **데이터 구성**:
  1. Yahoo Finance에서 각 티커의 과거 주봉 시세 fetch (`interval=1wk`, 기간: 첫 거래일 ~ 오늘, `period1`/`period2` Unix timestamp로 제한)
  2. 각 주(week)마다 그 시점 보유수량 × 종가 합산 → 주별 포트폴리오 시가총액
  3. GOLD는 XAUUSD/트로이온스 → KRW/g 변환
  4. 현금 잔고는 flat line으로 더함
- **시간 범위**: 첫 거래일 ~ 오늘
- **차트**: Lightweight Charts `LineSeries`, Y축 KRW

### 3-3. 수익률 % 추이
- 동일 주별 데이터에서 `(평가금액 / 누적투자금액 - 1) × 100`
- 0% 기준선 표시

### 3-4. 종목별 IRR 테이블
- 각 종목의 매수/매도/배당 현금흐름으로 개별 IRR 계산
- 현재 보유 종목: 현재가를 최종 현금흐름으로 사용
- 컬럼: 종목명 / 투자기간 / 총 투자금 / 현재 평가 / IRR

---

## 4. 거래내역 페이지 (신규)

### 레이아웃
```
[총 N건]  [검색창]  [⬇ CSV 템플릿]  [⬆ CSV 업로드]
──────────────────────────────────────────────────
날짜 | 종목명 | 구분 | 수량 | 단가(KRW) | 섹터 | 지역
──────────────────────────────────────────────────
... (전체 거래내역, 날짜 내림차순)
```

### CSV 템플릿 컬럼 (transactions 테이블 매핑)
```
trade_date, ticker, name, action, shares, price_krw, sector, region, asset_group, funding_source, notes
```
- `action`: buy / sell / dividend / split
- `region`: 한국 / 해외

### CSV 업로드 플로우
1. 파일 선택 → 파싱 → 미리보기 모달 (N건 추가 예정)
2. 확인 클릭 → Supabase `transactions` 테이블에 INSERT (중복은 skip)
3. 업로드 완료 → 대시보드 데이터 자동 새로고침

### 중복 처리
- `trade_date + ticker + action + shares + price_krw` 복합 unique 비교
- 이미 있는 행은 skip (INSERT 안 함), 없는 행만 추가

---

## 5. 기술 결정사항

### 패키지 추가
- `lightweight-charts` — TradingView 차트 (차트 전용)
- `papaparse` — CSV 파싱

### 파일 구조 변경
```
src/
  components/
    Sidebar.tsx          (신규)
    ChartPanel.tsx       (신규 — 인라인 차트 확장)
  pages/
    Dashboard.tsx        (기존 개선)
    Analytics.tsx        (신규)
    Transactions.tsx     (신규)
  lib/
    prices.ts            (longName fetch 추가, GOLD 디버그)
    calc.ts              (IRR 계산 추가)
    history.ts           (신규 — 과거 시세 fetch + 포트폴리오 가치 계산)
    csv.ts               (신규 — CSV 파싱/생성)
    types.ts             (타입 추가)
  hooks/
    usePortfolio.ts      (개선)
    useAnalytics.ts      (신규)
```

### IRR 계산 (이분법 솔버)
```
NPV(r) = Σ cashflow_i / (1 + r)^t_i = 0
```
- cashflow: 매수 = 음수, 매도/배당 = 양수, 현재평가 = 양수
- t_i: 첫 거래일로부터 경과 연수
- 이분법으로 r 수렴 (허용 오차 0.0001, 최대 100회)

---

## 6. 버그 수정 (우선 처리)

### GOLD manual 문제
- 원인 후보 1: transactions 테이블에 GOLD 티커 거래 없음
- 원인 후보 2: Vite proxy `/api/yahoo` 미설정으로 XAUUSD=X fetch 실패
- 수정: Supabase에서 GOLD 거래 존재 확인 → 없으면 테스트 insert → 차트도 확인

### CASH 미표시 문제
- 원인: `cash_balance` 테이블 미생성
- 수정: Supabase에서 CREATE TABLE 실행 필요 (SQL 위에 제공됨)

---

## 7. 구현 순서

1. 버그 수정 (GOLD, CASH 테이블)
2. 사이드바 + 라우팅 (App.tsx, Sidebar.tsx)
3. 대시보드 — 종목명 순서 + Yahoo longName
4. 대시보드 — 차트 인라인 확장 (ChartPanel.tsx)
5. 거래내역 페이지 (Transactions.tsx + csv.ts)
6. 애널리틱스 — IRR 계산 (calc.ts)
7. 애널리틱스 — 과거 시세 fetch (history.ts)
8. 애널리틱스 페이지 UI (Analytics.tsx)
