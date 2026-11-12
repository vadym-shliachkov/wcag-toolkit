// How a page address is shown to the client. In repo mode the crawler visits a local server; the report shows the
// path only, so no localhost address or port ever reaches the client.

export function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function publicPath(url, base) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}${u.hash.startsWith('#/') || u.hash.startsWith('#!/') ? u.hash : ''}`;
    if (isLocal(url) || (base && new URL(base).origin === u.origin)) return p || '/';
    return u.href;
  } catch {
    return String(url);
  }
}

// The full address for links in the PDF: the real site when known, otherwise just the path.
export function publicUrl(url, run) {
  const p = publicPath(url, run.target?.baseUrl);
  if (!p.startsWith('/')) return p;
  if (run.target?.url && !isLocal(run.target.url)) return new URL(p, run.target.url).href;
  return p;
}
