// src/lib/csv.ts
import Papa from 'papaparse';
import type { Transaction } from './types';

const HEADERS = [
  'trade_date', 'ticker', 'name', 'action', 'shares',
  'price_krw', 'sector', 'region', 'asset_group', 'funding_source', 'notes',
] as const;

export function generateTemplateCsv(): string {
  const rows = [
    HEADERS.join(','),
    '2024-01-15,000660,SK하이닉스,buy,10,165000,반도체,한국,주식,,',
    '2024-03-20,NVDA,NVIDIA,buy,5,623000,기술,해외,주식,,',
  ];
  return rows.join('\n') + '\n';
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ── 티커 패턴 기반 자동 분류 ─────────────────────────────────────────

const BOND_ETF = new Set(['BIL','SHY','IEI','IEF','TLT','AGG','BND','LQD','HYG','TIP','VTIP','SCHO','SCHR','SPTS','SPTI','SPTL','VGSH','VGIT','VGLT','BSV','BIV','BLV','BNDX','EMB','MBB','MUB','FLOT','NEAR','JPST','ICSH','TFLO','SGOV','USFR','CSHI','TBIL','BILS']);
const INDEX_ETF = new Set(['SPY','IVV','VOO','QQQ','VTI','VEA','VWO','EFA','EEM','IWM','DIA','GLD','IAU','SLV','USO','VNQ','VIG','VYM','SCHD','JEPI','JEPQ','QYLD','XYLD','RYLD','ARKK','ARKG','ARKW','ARKF','ARKQ','TQQQ','SQQQ','UPRO','SPXU','SOXL','SOXS','TNA','TZA','FNGU','FNGD','TECL','TECS','LABU','LABD','NAIL','DRN','ERX','ERY','GUSH','DRIP','BOIL','KOLD','CWEB','YINN','YANG','FXI','MCHI','KWEB','VGT','XLK','XLF','XLV','XLE','XLI','XLU','XLP','XLRE','XLB','XLY','XLC','SOXX','SMH','IGV','BOTZ','ROBO','HACK','CIBR','FINX','ICLN','TAN','QCLN','PBW','CLOU','SKYY','BUG','DRIV','MOTO','PTLC','VUG','VTV','VBK','VBR','VO','VOE','VOT','MGK','MGV','IWB','IWD','IWF','ITOT','IWN','IWO','IWP','IWR','IWS','IWV','IJH','IJR','IEF','AGG','BND']);
const SECTOR_MAP: Record<string, string> = {
  // 반도체
  NVDA:'반도체', AMD:'반도체', INTC:'반도체', MU:'반도체', AMAT:'반도체', LRCX:'반도체', KLAC:'반도체', ASML:'반도체', TSM:'반도체', AVGO:'반도체', MRVL:'반도체', TXN:'반도체', ADI:'반도체', QCOM:'반도체', ARM:'반도체', ON:'반도체', MPWR:'반도체', ENTG:'반도체', WOLF:'반도체', SMCI:'반도체',
  // 빅테크/기술
  AAPL:'기술', MSFT:'기술', GOOG:'기술', GOOGL:'기술', META:'기술', AMZN:'기술', NFLX:'기술', CRM:'기술', NOW:'기술', ORCL:'기술', IBM:'기술', ADBE:'기술', INTU:'기술', PANW:'기술', CRWD:'기술', ZS:'기술', OKTA:'기술', SNOW:'기술', DDOG:'기술', MDB:'기술', NET:'기술', HUBS:'기술', TWLO:'기술', ZM:'기술', SHOP:'기술', SQ:'기술', PYPL:'기술', COIN:'기술', ABNB:'기술', UBER:'기술', LYFT:'기술', SNAP:'기술', PINS:'기술', RBLX:'기술', TTWO:'기술', EA:'기술', ATVI:'기술', NTES:'기술', BIDU:'기술', BABA:'기술', JD:'기술', PDD:'기술', SE:'기술', GRAB:'기술', GOTO:'기술',
  // 금융
  JPM:'금융', BAC:'금융', WFC:'금융', GS:'금융', MS:'금융', C:'금융', BRK:'금융', 'BRK.B':'금융', 'BRK.A':'금융', V:'금융', MA:'금융', AXP:'금융', BX:'금융', KKR:'금융', APO:'금융', SCHW:'금융', TFC:'금융', USB:'금융', PNC:'금융', COF:'금융',
  // 헬스케어
  JNJ:'헬스케어', PFE:'헬스케어', MRK:'헬스케어', ABBV:'헬스케어', LLY:'헬스케어', BMY:'헬스케어', GILD:'헬스케어', AMGN:'헬스케어', BIIB:'헬스케어', REGN:'헬스케어', MRNA:'헬스케어', BNTX:'헬스케어', UNH:'헬스케어', CVS:'헬스케어', CI:'헬스케어', HUM:'헬스케어', MDT:'헬스케어', ABT:'헬스케어', TMO:'헬스케어', DHR:'헬스케어', ISRG:'헬스케어', SYK:'헬스케어', BSX:'헬스케어', EW:'헬스케어',
  // 에너지
  XOM:'에너지', CVX:'에너지', COP:'에너지', EOG:'에너지', SLB:'에너지', MPC:'에너지', PSX:'에너지', VLO:'에너지', OXY:'에너지', DVN:'에너지',
  // 소비재
  TSLA:'소비재', HD:'소비재', LOW:'소비재', MCD:'소비재', SBUX:'소비재', NKE:'소비재', TGT:'소비재', WMT:'소비재', COST:'소비재', PG:'소비재', KO:'소비재', PEP:'소비재', PM:'소비재', MO:'소비재', CL:'소비재',
  // 귀금속/원자재
  GOLD:'귀금속', GLD:'귀금속', IAU:'귀금속', SLV:'귀금속',
};

function autoClassify(ticker: string, csvRegion: string, csvSector: string, csvAssetGroup: string): {
  region: Transaction['region'];
  sector: string | null;
  asset_group: string | null;
} {
  const t = ticker.trim().toUpperCase();

  // region: CSV에 명시된 경우 우선
  let region: Transaction['region'];
  if (csvRegion === '한국') region = '한국';
  else if (csvRegion === '해외') region = '해외';
  else if (/^\d{6}$/.test(t)) region = '한국';          // KRX 종목코드
  else if (t === 'CASH') region = '한국';
  else region = '해외';                                  // 영문티커, 홍콩(4자리), GOLD 등

  // asset_group: CSV에 있으면 유지, 없으면 추론
  let asset_group = csvAssetGroup || null;
  if (!asset_group) {
    if (t === 'GOLD' || t === 'GLD' || t === 'IAU' || t === 'SLV') asset_group = '금현물';
    else if (BOND_ETF.has(t)) asset_group = '채권ETF';
    else if (INDEX_ETF.has(t)) asset_group = '지수ETF';
    else asset_group = '주식';
  }

  // sector: CSV에 있으면 유지, 없으면 추론
  let sector = csvSector || null;
  if (!sector) {
    sector = SECTOR_MAP[t] ?? null;
    if (!sector && BOND_ETF.has(t)) sector = '채권';
    if (!sector && /^\d{6}$/.test(t)) sector = null; // 한국 종목은 추론 어려움
  }

  return { region, sector, asset_group };
}

export function parseCsvToTransactions(csvText: string): Omit<Transaction, 'id'>[] {
  const { data } = Papa.parse<Record<string, string>>(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
  });
  return data
    .filter((row) => row.trade_date && row.ticker && row.action)
    .map((row) => {
      const { region, sector, asset_group } = autoClassify(
        row.ticker ?? '',
        row.region?.trim() ?? '',
        row.sector?.trim() ?? '',
        row.asset_group?.trim() ?? '',
      );
      return {
        ticker: row.ticker.trim(),
        name: row.name?.trim() ?? '',
        action: row.action.trim() as Transaction['action'],
        shares: parseFloat(row.shares) || 0,
        price_krw: parseFloat(row.price_krw) || 0,
        trade_date: row.trade_date.trim(),
        sector,
        region,
        asset_group,
        funding_source: row.funding_source?.trim() || null,
        notes: row.notes?.trim() || null,
      };
    });
}
