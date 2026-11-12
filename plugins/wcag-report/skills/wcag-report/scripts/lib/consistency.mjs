// Requirements about how pages relate to each other, decided from the collected links of every reviewed page:
// 3.2.3 Consistent Navigation (links repeated on most pages keep their relative order), 3.2.4 Consistent
// Identification (the same destination has the same name everywhere it is repeated), 3.2.6 Consistent Help (help and
// contact links stay in the same relative place) and 2.4.5 Multiple Ways (every page can be reached in two ways).
// "Repeated" means present on at least 80 % of the reviewed pages: the shared header, navigation and footer.
import { inProfile } from './criteria.mjs';

const HELP = /contact|support|help|faq|chat|kontakt|hilfe|помощ|контакт|tel:|mailto:|start a conversation|get in touch/i;

const keyOf = (href) => { try { const u = new URL(href); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '') || '/'}`; } catch { return null; } };
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

function sig(base, f) {
  return {
    source: 'site', check: f.check, sc: [f.sc], status: f.status, pageId: base.pageId, url: base.url, templateId: null, state: 'default', viewport: [1280, 900],
    selector: f.selector ?? null, html: f.html ?? null, bbox: null, description: f.description, measured: f.measured ?? null, barrier: f.barrier ?? 'minor',
    trust: f.status === 'needs_review' ? 'review' : 'confirmed', evidence: ['collect/'], expected: f.expected, ...(f.question ? { question: f.question } : {}),
    ...(f.confidence ? { confidence: f.confidence, confidenceNote: f.confidenceNote } : {}),
    steps: ['Read the links of every reviewed page in the order they appear.', 'Keep the links repeated on at least 80 % of pages (header, navigation, footer).', 'Compare their order, their names and the place of help links across pages, and count the ways each page can be reached.'],
  };
}

export function consistencySignals(collects, pages, { level }) {
  const out = [];
  const byId = new Map(pages.map((p) => [p.id, p]));
  const home = pages.find((p) => p.depth === 0) ?? pages[0];
  const base = (pid) => ({ pageId: pid, url: byId.get(pid)?.finalUrl || byId.get(pid)?.url });
  const add = (s) => { if (inProfile(s.sc[0], level)) out.push(s); };
  if (collects.length < 2) {
    for (const sc of ['3.2.3', '3.2.4', '3.2.6']) add(sig(base(home.id), { check: 'consistency', sc, status: 'not_applicable', description: 'Only one page was reviewed, so nothing is repeated across pages.' }));
    return out;
  }
  // Per page: its links in document order, without links to the page itself (skip links, anchors).
  const seqs = new Map();
  for (const c of collects) {
    const own = keyOf(byId.get(c.pageId)?.finalUrl || byId.get(c.pageId)?.url);
    // Anchors within the page (a skip link) are not navigation; a link to the page itself (the logo on the home
    // page) is, and keeps its place in the block.
    seqs.set(c.pageId, (c.links ?? []).map((l) => ({ k: keyOf(l.href), name: norm(l.name || l.text), anchor: /#./.test(l.href ?? '') && keyOf(l.href) === own }))
      .filter((t) => t.k && !t.anchor).map((t) => ({ ...t, id: `${t.k}|${t.name}` })));
  }
  // The repeated blocks: the header and navigation open the link list of nearly every page, the footer closes it.
  // Each block is the longest run of destinations, position by position, shared by at least 80 % of pages.
  const block = (fromEnd) => {
    const ref = [];
    for (let i = 0; i < 200; i++) {
      const votes = new Map();
      for (const seq of seqs.values()) { const t = fromEnd ? seq[seq.length - 1 - i] : seq[i]; if (t) votes.set(t.id, (votes.get(t.id) ?? 0) + 1); }
      const [k, n] = [...votes].sort((a, b) => b[1] - a[1])[0] ?? [];
      if (!k || n < 0.8 * collects.length) break;
      ref.push(k);
    }
    return fromEnd ? ref.reverse() : ref;
  };
  const head = block(false);
  const foot = block(true);
  const shared = new Set([...head, ...foot].map((id) => id.split('|')[0]));
  const expected = {
    '3.2.3': 'Navigation repeated on several pages keeps the same relative order.',
    '3.2.4': 'The same function or destination has the same name everywhere it is repeated.',
    '3.2.6': 'Help offered on several pages stays in the same relative place.',
    '2.4.5': 'Every page can be reached in more than one way.',
  };
  // A page follows a block when the block's destinations it has appear in the block's order at its start (or end).
  const follows = (seq, ref, fromEnd) => {
    const part = fromEnd ? seq.slice(-Math.ceil(ref.length * 1.5) - 3) : seq.slice(0, Math.ceil(ref.length * 1.5) + 3);
    // The header's links are taken at their first appearance, the footer's at their last: both blocks can repeat a
    // link (a contact link in the header and again in the footer).
    const got = [];
    for (const t of fromEnd ? [...part].reverse() : part) if (ref.includes(t.id) && !got.includes(t.id)) got.push(t.id);
    if (fromEnd) got.reverse();
    // A block can hold the same link twice in a row (a desktop and a compact copy): order is compared once per link.
    return got.join(' ') === [...new Set(ref)].filter((k) => got.includes(k)).join(' ');
  };

  // 3.2.3
  const reordered = [...seqs].filter(([, seq]) => !follows(seq, head, false) || !follows(seq, foot, true)).map(([pid]) => pid);
  if (!shared.size) add(sig(base(home.id), { check: 'consistency', sc: '3.2.3', status: 'not_applicable', description: 'No block of links is repeated across most pages, so there is no repeated navigation to compare.', expected: expected['3.2.3'] }));
  else if (reordered.length) add(sig(base(reordered[0]), { check: 'consistency', sc: '3.2.3', status: 'fail', description: `The navigation links repeated on every page appear in a different order on ${reordered.length} page(s), for example ${byId.get(reordered[0])?.finalUrl ?? reordered[0]}.`, measured: { pages: reordered.slice(0, 10) }, barrier: 'minor', expected: expected['3.2.3'] }));
  else add(sig(base(home.id), { check: 'consistency', sc: '3.2.3', status: 'pass', description: `The ${head.length} links of the header and navigation and the ${foot.length} links of the footer appear in the same order on all ${collects.length} pages.`, expected: expected['3.2.3'] }));

  // 3.2.4 — each slot of a repeated block keeps one name on every page.
  const renamed = [];
  for (const [ref, fromEnd] of [[head, false], [foot, true]]) {
    // Walk each page's links along the block: a slot is matched to the next link with the same destination nearby,
    // so one extra link in a page's header does not shift every later comparison.
    const vals = ref.map(() => new Map());
    for (const [pid, seq] of seqs) {
      const list = fromEnd ? [...seq].reverse() : seq;
      const slots = fromEnd ? [...ref].reverse() : ref;
      let j = 0;
      slots.forEach((id, i) => {
        const k = id.split('|')[0];
        const at = list.slice(j, j + 4).findIndex((t) => t.k === k);
        if (at < 0) return;
        const t = list[j + at];
        j += at + 1;
        const slot = fromEnd ? ref.length - 1 - i : i;
        if (t.name) vals[slot].set(t.name, [...(vals[slot].get(t.name) ?? []), pid]);
      });
    }
    vals.forEach((v, i) => {
      if (v.size > 1) renamed.push({ k: ref[i].split('|')[0], variants: [...v.keys()].slice(0, 3), pid: [...v.values()].sort((a, b) => a.length - b.length)[0][0] });
    });
  }
  if (shared.size && renamed.length) add(sig(base(renamed[0].pid), { check: 'consistency', sc: '3.2.4', status: 'fail', description: `A navigation link repeated on every page is named differently on some pages: ${renamed.slice(0, 2).map((r) => r.variants.map((v) => `"${v}"`).join(' / ')).join('; ')}.`, measured: { renamed: renamed.slice(0, 5) }, barrier: 'minor', expected: expected['3.2.4'] }));
  else if (shared.size) add(sig(base(home.id), { check: 'consistency', sc: '3.2.4', status: 'pass', description: `Each of the ${shared.size} repeated navigation links keeps the same name on every page.`, expected: expected['3.2.4'] }));

  // 3.2.6 — help and contact links inside the repeated blocks keep their place with them.
  const help = [...new Set([...head, ...foot].filter((id) => HELP.test(id)).map((id) => id.split('|')[0]))];
  if (!help.length) add(sig(base(home.id), { check: 'consistency', sc: '3.2.6', status: 'not_applicable', description: 'No help or contact link is part of the navigation repeated on every page.', expected: expected['3.2.6'] }));
  else if (reordered.length) add(sig(base(reordered[0]), { check: 'consistency', sc: '3.2.6', status: 'fail', description: `The repeated navigation that holds the contact link changes order on ${reordered.length} page(s), so the contact link does not stay in the same place.`, measured: { help }, barrier: 'minor', expected: expected['3.2.6'] }));
  else add(sig(base(home.id), { check: 'consistency', sc: '3.2.6', status: 'pass', description: `The contact and help link${help.length > 1 ? 's' : ''} (${help.map((h) => h.split('/').slice(1).join('/') || '/').join(', ')}) sit${help.length > 1 ? '' : 's'} in the same place in the header or footer of every page.`, expected: expected['3.2.6'] }));

  // 2.4.5 — the ways to a page: the repeated navigation (directly, or through a listing page the navigation leads
  // to), each other page that links to it from its own content, search, and a site map. A page linked only from its
  // listing has one way; a page that related pages also link to has two.
  const search = collects.some((c) => (c.forms ?? []).some((f) => f.purpose === 'search'));
  const sitemap = pages.some((p) => /site ?map|карта сайта/i.test(`${p.title ?? ''} ${p.finalUrl ?? p.url}`) && !/\.xml$/i.test(p.finalUrl ?? p.url));
  const linkers = new Map();
  for (const [pid, seq] of seqs) {
    const from = keyOf(byId.get(pid)?.finalUrl || byId.get(pid)?.url);
    // Links between the header block and the footer block are the page's own content.
    for (const t of seq.slice(Math.min(head.length, seq.length), Math.max(head.length, seq.length - foot.length))) {
      if (t.k === from) continue;
      if (!linkers.has(t.k)) linkers.set(t.k, new Set());
      linkers.get(t.k).add(from);
    }
  }
  const oneWay = [];
  for (const c of collects) {
    const k = keyOf(byId.get(c.pageId)?.finalUrl || byId.get(c.pageId)?.url);
    const from = linkers.get(k)?.size ?? 0;
    const ways = (shared.has(k) ? 1 : 0) + Math.min(2, from) + (search ? 1 : 0) + (sitemap ? 1 : 0);
    // 2.4.5 exempts a page that is the result of, or a step in, a process ("Thanks for signing up").
    const h1 = (c.headings ?? []).find((h) => h.level === 1)?.text ?? '';
    const processStep = /\b(thank(s| you)|confirm(ation|ed)|success(ful(ly)?)?|submitted|received|unsubscribed|subscribed)\b/i.test(`${c.title ?? byId.get(c.pageId)?.title ?? ''} ${h1}`);
    if (ways < 2 && c.pageId !== home.id && !processStep) oneWay.push({ pid: c.pageId, via: [...(linkers.get(k) ?? [])][0] ?? null, menu: shared.has(k) });
  }
  if (oneWay.length) {
    const ex = oneWay[0];
    const via = ex.via ? ex.via.split('/').slice(1).join('/') || '/' : null;
    // One signal per page, so the problem's reach and the pages appendix name every page it affects.
    for (const o of oneWay.slice(1)) add(sig(base(o.pid), { check: 'multiple-ways', sc: '2.4.5', status: 'fail', description: `This page can be found in only one way: ${o.menu ? 'it is reached only from the menu repeated on every page' : `only ${o.via ? `/${o.via.split('/').slice(1).join('/')}` : 'one other page'} links to it`}, and the site has no search and no site map.`, barrier: 'minor', expected: expected['2.4.5'], confidence: 'medium', confidenceNote: 'Some reviewers count a listing page reached from the menu as enough on its own; WCAG names the menu, related links, search and a site map as separate ways, and these pages have only one of them.' }));
    add(sig(base(ex.pid), { check: 'multiple-ways', sc: '2.4.5', status: 'fail', description: `${oneWay.length} page(s) can be found in only one way: the site has no search and no site map, and each is reached either only from the menu or only from one other page${via ? ` (for ${byId.get(ex.pid)?.finalUrl ?? ex.pid}, only /${via})` : ex.menu ? ` (for ${byId.get(ex.pid)?.finalUrl ?? ex.pid}, only the menu)` : ''}. Pages that related pages also link to are fine.`, measured: { pages: oneWay.map((o) => o.pid).slice(0, 20), search, sitemap }, barrier: 'minor', expected: expected['2.4.5'], confidence: 'medium', confidenceNote: 'Some reviewers count a listing page reached from the menu as enough on its own; WCAG names the menu, related links, search and a site map as separate ways, and these pages have only one of them.' }));
  } else add(sig(base(home.id), { check: 'multiple-ways', sc: '2.4.5', status: 'pass', description: `Every reviewed page can be reached in at least two ways: ${[shared.size && 'the navigation repeated on every page', linkers.size && 'links from the content of other pages', search && 'search', sitemap && 'a site map'].filter(Boolean).join(', ')}.`, expected: expected['2.4.5'] }));
  return out;
}
