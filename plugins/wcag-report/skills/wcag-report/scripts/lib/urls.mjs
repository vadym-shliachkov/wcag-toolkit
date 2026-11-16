// URL normalisation and filtering for the crawler.
const TRACKING = /^(utm_[a-z_]+|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|mc_cid|mc_eid|ref|ref_src|_ga|_gl|igshid|si|spm)$/i;
const ASSET_EXT = /\.(css|js|mjs|map|json|xml|txt|rss|atom|ico|png|jpe?g|gif|webp|avif|svg|bmp|tiff?|woff2?|ttf|otf|eot|mp4|webm|ogg|ogv|mp3|wav|m4a|aac|flac|mov|avi|mkv|zip|gz|tgz|rar|7z|exe|dmg|msi|apk|iso|bin|wasm)$/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub|csv)$/i;
const LOGOUT = /(log|sign)[-_ ]?(out|off)|abmelden|выход|вийти|deconnexion|d[ée]connexion|cerrar[-_ ]?sesi[oó]n|wyloguj|uitloggen/i;

export function isLocalHost(host) {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i.test(host);
}

function bareHost(host) {
  return host.toLowerCase().replace(/^www\./, '');
}

// Same site = same host ignoring "www.", any scheme (http→https upgrades are common); ports must match for local hosts.
export function sameSite(a, b) {
  const ua = new URL(a);
  const ub = new URL(b);
  if (bareHost(ua.hostname) !== bareHost(ub.hostname)) return false;
  if (isLocalHost(ua.hostname)) return ua.port === ub.port;
  return true;
}

// One key per page however it was reached: "www." and the scheme do not make a second page (example.com/ redirects to
// www.example.com/, and the sitemap lists the www address again).
export function pageKey(url) {
  try {
    const u = new URL(url);
    return `${bareHost(u.hostname)}${isLocalHost(u.hostname) ? `:${u.port}` : ''}${u.pathname}${u.search}${u.hash}`;
  } catch { return url; }
}

export function urlKind(url) {
  const p = new URL(url).pathname;
  if (DOC_EXT.test(p)) return 'document';
  if (ASSET_EXT.test(p)) return 'asset';
  return 'page';
}

export function isLogout(url, text = '') {
  let u;
  try { u = new URL(url); } catch { return false; }
  return LOGOUT.test(u.pathname + u.search) || LOGOUT.test(text);
}

// Hash routes ("#/about", "#!/about") are separate pages in single-page apps; plain anchors are not.
export function normalize(raw, { base, hashRoutes = false } = {}) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  if (!(hashRoutes && /^#!?\//.test(u.hash))) u.hash = '';
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k));
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of params) u.searchParams.append(k, v);
  u.pathname = u.pathname.replace(/\/{2,}/g, '/');
  return u.href;
}

// The page "shape" groups URLs that are the same page type with different ids: /events/2026/11/03 → /events/:n/:n/:n.
export function pathShape(url) {
  const u = new URL(url);
  const seg = u.pathname.split('/').map((s) => {
    if (!s) return s;
    if (/^\d+$/.test(s)) return ':n';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return ':uuid';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ':date';
    if (/^[0-9a-f]{16,}$/i.test(s)) return ':hash';
    if (/\d{3,}/.test(s)) return ':id';
    return s.toLowerCase();
  });
  const hash = /^#!?\//.test(u.hash) ? u.hash.replace(/\d+/g, ':n') : '';
  return seg.join('/') + hash;
}

// The path prefixes a page belongs to, outermost first: /colors/browser/red/ → ["/colors", "/colors/browser",
// "/colors/browser/red"]. The crawl uses them to share the page limit fairly between the sections of a site.
export function sectionPrefixes(url) {
  let p;
  try { p = new URL(url).pathname; } catch { return []; }
  const seg = p.split('/').filter(Boolean).map((s) => s.toLowerCase());
  return seg.map((_, i) => `/${seg.slice(0, i + 1).join('/')}`);
}

// Picks the queue entry from the least-covered part of the site: the start page first, then the entry whose
// outermost section has had the fewest pages so far, then the next level down, and so on (queue order breaks ties).
// A sitemap that lists thousands of pages of one section first can no longer use up the whole page limit on it.
export function pickFair(queue, served, prefixesOf = (q) => sectionPrefixes(q.url)) {
  let best = -1;
  let bestKey = null;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    const pre = prefixesOf(q);
    const key = [q.depth === 0 ? 0 : 1, ...pre.map((x) => served[x] || 0)];
    if (bestKey === null || lessKey(key, bestKey)) { best = i; bestKey = key; }
  }
  return best;
}

// Tuple order; a missing element sorts before any count, so a section's own page comes before its sub-pages.
function lessKey(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a[i] : -1;
    const y = i < b.length ? b[i] : -1;
    if (x !== y) return x < y;
  }
  return false;
}

export function markServed(served, url) {
  for (const x of sectionPrefixes(url)) served[x] = (served[x] || 0) + 1;
}

// Pages that differ only in query values are variants (filters, sort orders, pagination): one per parameter-name set.
export function variantKey(url) {
  const u = new URL(url);
  const names = [...new Set([...u.searchParams.keys()])].sort().join(',');
  return `${u.origin}${u.pathname}${u.hash}?${names}`;
}

// Glob on the URL path: "*" matches within a segment, "**" across segments, and "**/" also matches no segment at all.
// A pattern that does not start with "/" (or "*") matches at any depth but only from a segment start: "admin"
// matches "/admin" and "/x/admin" but not "/superadmin", and "blog/x" also matches "/a/blog/x".
export function globToRegExp(glob) {
  let g = glob.trim();
  if (!g.startsWith('/') && !g.startsWith('*')) g = `**/${g}`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        // "**/" is any number of whole segments, so what follows it starts a segment.
        if (g[i + 1] === '/') { re += '(?:.*/)?'; i++; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

export function makePathFilter(include = [], exclude = []) {
  const inc = include.map(globToRegExp);
  const exc = exclude.map(globToRegExp);
  return (url) => {
    const p = new URL(url).pathname;
    if (exc.some((r) => r.test(p))) return 'excluded';
    if (inc.length && !inc.some((r) => r.test(p))) return 'excluded';
    return null;
  };
}

// For the report: a local dev-server address is shown as its path only.
export function displayUrl(url, base) {
  try {
    const u = new URL(url);
    if (isLocalHost(u.hostname) || (base && new URL(base).origin === u.origin && isLocalHost(new URL(base).hostname))) {
      return `${u.pathname}${u.search}${u.hash}` || '/';
    }
    return u.href;
  } catch { return url; }
}
