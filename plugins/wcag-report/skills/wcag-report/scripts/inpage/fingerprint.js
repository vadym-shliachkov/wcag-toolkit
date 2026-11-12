// Evaluated in the page as an expression: () => string.
// A structural skeleton of the page, used to group pages built from the same template. Text, ids and hash-like
// classes are ignored; repeated siblings (list items, cards) collapse so a list of 3 and a list of 30 look alike.
// The site-wide header, navigation and footer are left out: they are the same on every page and would make every
// page look like every other.
() => {
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'path', 'br', 'wbr', 'link', 'meta', 'source', 'track']);
  const stable = (c) => /^[A-Za-z][\w-]*$/.test(c) && !/\d{2,}|^(css|sc|jsx|emotion|svelte)-|__[A-Za-z0-9]{5}$|_[a-z0-9]{5,}$/.test(c);
  const out = [];
  const walk = (el, depth) => {
    if (depth > 9 || out.length > 1500) return;
    let last = null;
    for (const child of el.children) {
      const tag = child.localName;
      if (SKIP.has(tag)) continue;
      if (/^(header|footer|nav)$/.test(tag) || /^(banner|contentinfo|navigation)$/.test(child.getAttribute('role') || '')) {
        if (!child.closest('main, article, [role=main]')) continue;
      }
      const cls = [...child.classList].filter(stable).sort().slice(0, 2).join('.');
      const role = child.getAttribute('role');
      const token = `${depth}:${tag}${cls ? `.${cls}` : ''}${role ? `[${role}]` : ''}`;
      if (token === last) continue;
      last = token;
      out.push(token);
      walk(child, depth + 1);
    }
  };
  if (document.body) walk(document.body, 0);
  return out.join(' ');
}
