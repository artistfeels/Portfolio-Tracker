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
  const url = `https://polling.finance.naver.com/${pathname}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        // Naver rejects requests without a finance.naver.com Referer.
        Referer: 'https://finance.naver.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
    });
    // Naver may return EUC-KR; decode correctly before forwarding.
    const buffer = await upstream.arrayBuffer();
    const ct = upstream.headers.get('content-type') ?? '';
    const encoding = /euc-kr/i.test(ct) ? 'euc-kr' : 'utf-8';
    const body = new TextDecoder(encoding).decode(buffer);
    res.status(upstream.status).setHeader('Content-Type', 'application/json; charset=utf-8').send(body);
  } catch {
    res.status(500).json({ error: 'upstream fetch failed' });
  }
}
