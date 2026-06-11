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
  const url = `https://api.stlouisfed.org/${pathname}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url);
    const body = await upstream.text();
    res.status(upstream.status).setHeader('Content-Type', 'application/json').send(body);
  } catch {
    res.status(500).json({ error: 'upstream fetch failed' });
  }
}
