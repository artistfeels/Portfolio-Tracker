export default async function handler(req: any, res: any) {
  const pathParts: string[] = Array.isArray(req.query.path)
    ? req.query.path
    : [String(req.query.path ?? '')];

  const pathname = pathParts.join('/');
  const params: Record<string, string> = {};

  for (const [k, v] of Object.entries(req.query as Record<string, string | string[]>)) {
    if (k === 'path') continue;
    params[k] = Array.isArray(v) ? v[0] : v;
  }

  const qs = new URLSearchParams(params).toString();
  // query2 is less rate-limited from datacenter IPs than query1
  const url = `https://query2.finance.yahoo.com/${pathname}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://finance.yahoo.com/',
        'Origin': 'https://finance.yahoo.com',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
    });
    const body = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    res.status(500).json({ error: 'upstream fetch failed' });
  }
}
