// src/lib/market.ts

function tsToDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

export async function fetchSofr(period1: number, period2: number): Promise<number> {
  const key = import.meta.env.VITE_FRED_API_KEY as string | undefined;
  if (!key) return 0;
  try {
    const start = tsToDate(period1);
    const end = tsToDate(period2);
    const res = await fetch(
      `/api/fred/fred/series/observations?series_id=SOFR&api_key=${key}` +
      `&observation_start=${start}&observation_end=${end}&file_type=json`
    );
    const j = await res.json();
    const obs: { value: string }[] = j?.observations ?? [];
    const values = obs
      .map((o) => parseFloat(o.value))
      .filter((v) => isFinite(v));
    if (values.length === 0) return 0;
    return (values.reduce((s, v) => s + v, 0) / values.length) / 100;
  } catch {
    return 0;
  }
}

export async function fetchSpxWeekly(
  period1: number,
  period2: number
): Promise<{ date: string; close: number }[]> {
  try {
    const res = await fetch(
      `/api/yahoo/v8/finance/chart/%5EGSPC?interval=1wk&period1=${period1}&period2=${period2}`
    );
    const j = await res.json();
    const result = j?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    return timestamps
      .map((ts, i) => {
        const close = closes[i];
        if (!close || close <= 0) return null;
        return { date: new Date(ts * 1000).toISOString().slice(0, 10), close };
      })
      .filter((v): v is { date: string; close: number } => v !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
