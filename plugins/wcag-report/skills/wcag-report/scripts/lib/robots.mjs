// robots.txt: the group for our token ("wcag-report") wins over "*"; the longest matching rule decides, Allow wins ties.
export const UA_TOKEN = 'wcag-report';

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') { if (value) sitemaps.push(value); continue; }
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', path: value });
  }
  return { groups, sitemaps };
}

function ruleRegExp(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function robotsAllows(parsed, url, token = UA_TOKEN) {
  if (!parsed) return true;
  const own = parsed.groups.filter((g) => g.agents.some((a) => a !== '*' && token.toLowerCase().includes(a)));
  const group = own.length ? own : parsed.groups.filter((g) => g.agents.includes('*'));
  const rules = group.flatMap((g) => g.rules).filter((r) => r.path !== '' || !r.allow);
  const u = new URL(url);
  const target = `${u.pathname}${u.search}`;
  let best = null;
  for (const r of rules) {
    if (r.path === '') continue; // "Disallow:" with no path allows everything
    if (!ruleRegExp(r.path).test(target)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}
