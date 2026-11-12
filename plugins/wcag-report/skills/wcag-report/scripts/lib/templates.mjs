// Groups pages into templates (page types) by the similarity of their structural skeletons, so the deep checks can
// run once per template and the report can say "this problem is on every product page".
import { globToRegExp } from './urls.mjs';

const SHINGLE = 4;
const THRESHOLD = 0.62;

export function shingles(fingerprint) {
  const tokens = String(fingerprint || '').split(' ').filter(Boolean);
  const set = new Set();
  if (tokens.length < SHINGLE) { if (tokens.length) set.add(tokens.join(' ')); return set; }
  for (let i = 0; i + SHINGLE <= tokens.length; i++) set.add(tokens.slice(i, i + SHINGLE).join(' '));
  return set;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Greedy single pass, then each page moves to the cluster whose members it resembles most on average.
// items: [{ id, fingerprint, shape }] → [[id, …], …]
export function cluster(items, threshold = THRESHOLD) {
  const sets = new Map(items.map((it) => [it.id, shingles(it.fingerprint)]));
  const clusters = [];
  for (const it of items) {
    const s = sets.get(it.id);
    let best = null;
    let bestSim = -1;
    for (const c of clusters) {
      // Same path shape (e.g. /events/:n/:n/:n) is the same page type even when content blocks differ.
      const sim = c.shapes.has(it.shape) && it.shape.includes(':') ? 1 : jaccard(s, sets.get(c.seed));
      if (sim > bestSim) { bestSim = sim; best = c; }
    }
    if (best && bestSim >= threshold) {
      best.members.push(it.id);
      best.shapes.add(it.shape);
    } else {
      clusters.push({ seed: it.id, members: [it.id], shapes: new Set([it.shape]) });
    }
  }
  return clusters.map((c) => c.members);
}

// The member most similar to the others (the medoid); ties go to the page with more content.
export function representative(memberIds, fingerprints, weight = () => 0) {
  if (memberIds.length <= 2) return [...memberIds].sort((a, b) => weight(b) - weight(a))[0];
  const sets = new Map(memberIds.map((id) => [id, shingles(fingerprints.get(id))]));
  const sample = memberIds.slice(0, 40);
  let best = memberIds[0];
  let bestScore = -1;
  for (const a of sample) {
    let sum = 0;
    for (const b of sample) if (a !== b) sum += jaccard(sets.get(a), sets.get(b));
    const score = sum / (sample.length - 1) + weight(a) * 1e-6;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

const KIND_NAMES = {
  home: 'Home page', article: 'Article pages', listing: 'Listing pages', product: 'Product pages', form: 'Form pages',
  search: 'Search pages', cart: 'Cart pages', checkout: 'Checkout pages', account: 'Account and sign-in pages', error: 'Error pages', other: 'Other pages',
};

// Classification of one page from its URL and what the collector saw; first match wins.
export function classifyPage(page, collect) {
  const x = new URL(page.finalUrl || page.url).pathname.toLowerCase();
  const purposes = new Set((collect?.forms || []).map((f) => f.purpose));
  const has = (re) => re.test(x);
  if (page.depth === 0 || /^\/(index(\.html?)?)?$/.test(x)) return 'home';
  if (page.status >= 400) return 'error';
  if (has(/\/(checkout|payment|order)(\/|$)/) || purposes.has('checkout')) return 'checkout';
  if (has(/\/(cart|basket|bag|warenkorb|korzina|корзина)(\/|$)/)) return 'cart';
  if (has(/\/(login|log-in|signin|sign-in|account|register|signup|sign-up|my-account|profile)(\/|$)/) || purposes.has('login') || purposes.has('signup')) return 'account';
  if (has(/\/(search|suche|poisk)(\/|$)/) || /[?&](q|query|s|search)=/.test(page.url)) return 'search';
  if (has(/\/(product|products\/[^/]+|p\/[^/]+|item|shop\/[^/]+\/[^/]+)/)) return 'product';
  if (purposes.has('contact') || has(/\/(contact|kontakt|contacts|feedback|apply|enquiry|inquiry)(\/|$)/)) return 'form';
  if (has(/\/(blog|news|articles?|posts?|stories|insights|press)\/[^/]+/)) return 'article';
  if (has(/\/(blog|news|articles|posts|events|category|categories|tag|tags|products|shop|catalog|collections?)(\/(page\/\d+)?)?$/)) return 'listing';
  return 'other';
}

const KIND_PRIORITY = ['home', 'checkout', 'cart', 'account', 'search', 'form', 'product', 'article', 'listing', 'error', 'other'];

// A template's kind is what most of its pages are; ties go to the kind that matters more for key tasks.
export function classify(pages, collects) {
  const votes = {};
  pages.forEach((p, i) => { const k = classifyPage(p, collects[i]); votes[k] = (votes[k] || 0) + 1; });
  return Object.keys(votes).sort((a, b) => votes[b] - votes[a] || KIND_PRIORITY.indexOf(a) - KIND_PRIORITY.indexOf(b))[0];
}

function commonPrefix(paths) {
  if (!paths.length) return '/';
  const split = paths.map((p) => p.split('/').filter(Boolean));
  const out = [];
  for (let i = 0; ; i++) {
    const seg = split[0][i];
    if (seg == null || !split.every((s) => s[i] === seg)) break;
    out.push(seg);
  }
  return `/${out.join('/')}`;
}

export function templateName(kind, pages) {
  const base = KIND_NAMES[kind] || 'Pages';
  if (kind === 'home') return base;
  const paths = pages.map((p) => new URL(p.finalUrl || p.url).pathname);
  if (pages.length === 1) return `${base.replace(/s$/, '').replace(/ pages$/, ' page')} (${paths[0]})`;
  const prefix = commonPrefix(paths);
  return prefix === '/' ? base : `${base} (${prefix}/…)`;
}

const KEY_KINDS = new Set(['home', 'form', 'search', 'cart', 'checkout', 'account']);

// pages: reviewed page entries; collects: Map id → collect json; returns { templates, assignment: Map pageId → tid }.
export function buildTemplates(pages, collects, { maxTemplates = 60, journeys = [] } = {}) {
  const items = pages.map((p) => ({ id: p.id, fingerprint: collects.get(p.id)?.fingerprint || '', shape: p.shape || '/' }));
  // The start page is always its own page type: it is unique and always part of the key tasks.
  const start = pages.find((p) => p.depth === 0);
  const groups = [
    ...(start ? [[start.id]] : []),
    ...cluster(items.filter((it) => it.id !== start?.id)),
  ];
  const fps = new Map(items.map((it) => [it.id, it.fingerprint]));
  const byId = new Map(pages.map((p) => [p.id, p]));
  const contentWeight = (id) => (collects.get(id)?.textSample || '').length + (collects.get(id)?.focusableCount || 0) * 10;
  const journeyRes = journeys.map(globToRegExp);

  let templates = groups.map((ids) => {
    const members = ids.map((id) => byId.get(id));
    const kind = classify(members, ids.map((id) => collects.get(id)));
    const inJourney = members.some((m) => journeyRes.some((r) => r.test(new URL(m.finalUrl || m.url).pathname)));
    return {
      kind,
      name: templateName(kind, members),
      pageIds: ids,
      representative: representative(ids, fps, contentWeight),
      keyFlow: KEY_KINDS.has(kind) || inJourney,
    };
  });
  // Biggest first, but the home page always leads.
  templates.sort((a, b) => (b.kind === 'home') - (a.kind === 'home') || b.pageIds.length - a.pageIds.length);
  // Same name twice reads like a mistake in the report, and "… 2" says nothing about the difference: page types that
  // share a name are told apart by their example page.
  const byName = new Map();
  for (const t of templates) byName.set(t.name, [...(byName.get(t.name) ?? []), t]);
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (const t of list) {
      const rep = byId.get(t.representative);
      t.name = `${t.name}, like ${new URL(rep.finalUrl || rep.url).pathname}`;
    }
  }
  const seen = {};
  for (const t of templates) {
    seen[t.name] = (seen[t.name] || 0) + 1;
    if (seen[t.name] > 1) t.name = `${t.name} ${seen[t.name]}`;
  }
  const deepOrder = [...templates].sort((a, b) => b.keyFlow - a.keyFlow || b.pageIds.length - a.pageIds.length);
  const deepSet = new Set(deepOrder.slice(0, maxTemplates));
  templates = templates.map((t, i) => ({
    id: `t${String(i + 1).padStart(2, '0')}`,
    name: t.name,
    kind: t.kind,
    pageIds: t.pageIds,
    representative: t.representative,
    keyFlow: t.keyFlow,
    deep: deepSet.has(t),
    skippedReason: deepSet.has(t) ? null : `Only ${maxTemplates} page types get the in-depth checks; this one had fewer pages.`,
  }));
  const assignment = new Map();
  for (const t of templates) for (const id of t.pageIds) assignment.set(id, t.id);
  return { templates, assignment };
}
