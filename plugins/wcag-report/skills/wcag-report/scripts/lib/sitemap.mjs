// Sitemaps: urlset and sitemapindex, plain or gzipped, followed to a bounded depth.
import { gunzipSync } from 'node:zlib';

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

export function parseSitemap(xml) {
  const text = String(xml);
  const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decode(m[1].trim()));
  return /<sitemapindex[\s>]/i.test(text) ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}

export function bodyText(buffer, contentType = '', url = '') {
  const b = Buffer.from(buffer);
  const gz = b[0] === 0x1f && b[1] === 0x8b;
  if (gz || /gzip/.test(contentType) || /\.gz$/i.test(url)) {
    try { return gunzipSync(b).toString('utf8'); } catch { /* not really gzipped */ }
  }
  return b.toString('utf8');
}

// fetchText(url) → string|null. Returns page URLs, capped, without following loops.
export async function collectSitemapUrls(starts, fetchText, { maxUrls = 20000, maxSitemaps = 50 } = {}) {
  const seen = new Set();
  const queue = [...starts];
  const urls = [];
  while (queue.length && seen.size < maxSitemaps && urls.length < maxUrls) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const text = await fetchText(sm);
    if (!text) continue;
    const parsed = parseSitemap(text);
    queue.push(...parsed.sitemaps);
    for (const u of parsed.urls) if (urls.length < maxUrls) urls.push(u);
  }
  return { urls, sitemaps: [...seen] };
}
