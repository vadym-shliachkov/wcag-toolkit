#!/usr/bin/env node
// Builds the renderer's sample input: real screenshots of a small fake shop rendered in Chromium (so overlays sit on
// real pixels), plus sample-report.json and sample-report-fix.json (--fix).
//   node tests/fixtures/report/make-sample.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = path.resolve(here, '..', '..', '..', 'skills', 'wcag-report', 'scripts', 'lib');
const { getBrowser, closeBrowser } = await import(pathToFileURL(path.join(skill, 'browser.mjs')).href);
const { readJson, writeJson } = await import(pathToFileURL(path.join(skill, 'io.mjs')).href);
const KB = path.resolve(skill, '..', '..', 'kb', 'data', 'criteria.json');
const SHOTS = path.join(here, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const SITE = `<!doctype html><html><head><style>
body{margin:0;font:16px/1.5 Georgia,serif;color:#222;background:#fff}
header{display:flex;align-items:center;gap:24px;padding:18px 40px;background:#1d3b2a;color:#fff}
.logo{font:700 24px Arial;letter-spacing:.5px} nav a{color:#e7f0e9;margin-right:18px;text-decoration:none;font:15px Arial}
.icons{margin-left:auto;display:flex;gap:16px}.icon{width:36px;height:36px;border-radius:50%;background:#2f5a41;display:grid;place-items:center}
.icon svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2}
.hero{padding:56px 40px;background:linear-gradient(120deg,#e8efe6,#d7e5db)}.hero h1{font-size:40px;margin:0 0 8px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;padding:32px 40px}
.card{border:1px solid #ddd;border-radius:6px;overflow:hidden}.ph{height:150px}.card p{margin:8px 12px;font:15px Arial}
.price{font-weight:700}.btn{display:inline-block;margin:0 12px 12px;padding:8px 14px;background:#1d3b2a;color:#fff;font:14px Arial;border-radius:4px}
form{padding:24px 40px;background:#f6f6f2}input{font:16px Arial;padding:10px;border:1px solid #ccc;width:280px}input::placeholder{color:#c4c4c4}
.err{color:#d11;font:14px Arial;margin-top:6px} input.bad{border-color:#d11}
footer{padding:28px 40px;background:#fafafa;color:#b9b9b9;font:13px Arial}
.cookie{position:fixed;left:40px;right:40px;bottom:24px;padding:18px 22px;background:#222;color:#fff;font:15px Arial;border-radius:8px;display:flex;gap:18px;align-items:center}
.cookie a{color:#9fd3ad}.cbtn{padding:8px 16px;background:#9fd3ad;color:#111;border-radius:4px}
.pager{padding:8px 40px 24px;font:12px Arial}.pager span{display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border:1px solid #999;margin-right:2px}
.video{margin:24px 40px;height:220px;background:#333 linear-gradient(45deg,#2b4a38,#5f8a6d);border-radius:6px;display:grid;place-items:center;color:#fff;font:20px Arial}
.links a{outline:none}
</style></head><body>
<header><span class="logo">Northwind Outdoor</span><nav class="links"><a href="#">Hiking</a><a href="#">Camping</a><a href="#">Climbing</a><a id="sale" href="#">Sale</a></nav>
<div class="icons"><span class="icon" id="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></span>
<span class="icon" id="cart"><svg viewBox="0 0 24 24"><path d="M3 4h2l2.5 11h11L21 7H7"/><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/></svg></span></div></header>
<section class="hero"><h1>Gear for every trail</h1><p>Free returns for 60 days on everything you order.</p></section>
<div class="video" id="video">▶ Meet the founders (2:04)</div>
<div class="grid" id="grid">${['#7a9b76', '#b3826b', '#6b86b3', '#c9b26a'].map((c, i) => `<div class="card"><div class="ph" id="img${i}" style="background:${c}"></div><p>${['Trail runner 2', 'Down jacket', 'Day pack 22 L', 'Camp stove'][i]}</p><p class="price">€${[129, 189, 79, 49][i]}</p><span class="btn">Add to cart</span></div>`).join('')}</div>
<div class="pager" id="pager"><span>1</span><span>2</span><span>3</span><span>›</span></div>
<form id="form"><label style="font:15px Arial;display:block;margin-bottom:6px">Newsletter</label><input class="bad" id="email" placeholder="Email address"><div class="err" id="err">●</div></form>
<footer id="footer">© 2026 Northwind Outdoor · Returns within 60 days · Prices include VAT</footer>
<div class="cookie" id="cookie">We use cookies to improve your visit. <a href="#">Settings</a> <a href="#">Privacy</a><span class="cbtn" id="accept">Accept</span><span class="cbtn" id="reject">Reject</span></div>
</body></html>`;

const { browser } = await getBrowser();
async function capture(name, { width = 1280, height = 900, dsf = 2, clipSel, pad = 24, boxes = [], focus = null, minW = 560, minH = 200, scrollTo } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.setContent(SITE);
  if (focus) { await page.focus(focus).catch(() => {}); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab'); }
  if (scrollTo) await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), scrollTo);
  const rect = async (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }; }, sel);
  let clip;
  if (clipSel) {
    const r = await rect(clipSel);
    clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(width, Math.max(minW, r.w + 2 * pad)), height: Math.max(minH, r.h + 2 * pad) };
    if (clip.x + clip.width > width) clip.x = Math.max(0, width - clip.width);
  } else {
    clip = { x: 0, y: 0, width, height };
  }
  const file = path.join(SHOTS, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 78, clip, fullPage: true });
  const bs = [];
  for (const [i, sel] of boxes.entries()) {
    const r = await rect(sel);
    bs.push({ x: Math.round((r.x - clip.x - 3) * dsf), y: Math.round((r.y - clip.y - 3) * dsf), w: Math.round((r.w + 6) * dsf), h: Math.round((r.h + 6) * dsf), n: i + 1 });
  }
  await ctx.close();
  return { file: `shots/${name}.jpg`, width: Math.round(clip.width * dsf), height: Math.round(clip.height * dsf), boxes: bs };
}

const home = await capture('home', { width: 1280, height: 800, dsf: 1 });
const S = {
  cookie: await capture('cookie', { clipSel: '#cookie', boxes: ['#accept', '#reject'], pad: 20 }),
  cart: await capture('cart', { clipSel: 'header', boxes: ['#cart'], pad: 0, minW: 1280 }),
  photos: await capture('photos', { clipSel: '#grid', boxes: ['#img0', '#img1', '#img2'], pad: 0 }),
  wide: await capture('reflow-wide', { clipSel: '#grid', pad: 0, boxes: ['#grid .card:nth-child(4)'] }),
  narrow: await capture('reflow-narrow', { width: 320, height: 640, clipSel: '#grid', pad: 0, minW: 320, boxes: ['#grid .card:nth-child(1) .price'] }),
  focusOff: await capture('focus-before', { clipSel: 'nav', pad: 16, minW: 420, minH: 90, boxes: ['#sale'] }),
  focusOn: await capture('focus-after', { clipSel: 'nav', pad: 16, minW: 420, minH: 90, boxes: ['#sale'], focus: '#sale' }),
  error: await capture('form-error', { clipSel: '#form', boxes: ['#err'], pad: 0 }),
  hint: await capture('form-hint', { clipSel: '#form', boxes: ['#email'], pad: 0 }),
  footer: await capture('footer', { clipSel: '#footer', boxes: ['#footer'], pad: 0, minH: 120 }),
  video: await capture('video', { clipSel: '#video', boxes: ['#video'], pad: 12 }),
  pager: await capture('pager', { clipSel: '#pager', boxes: ['#pager span:nth-child(1)', '#pager span:nth-child(2)', '#pager span:nth-child(3)', '#pager span:nth-child(4)'], pad: 12, minW: 420, minH: 110 }),
  map: await capture('map', { clipSel: '.hero', pad: 0 }),
};
await closeBrowser();

// ------------------------------------------------------------------------------------------------- texts
const BASE = 'https://northwind-outdoor.example';
const U = (p) => `${BASE}${p}`;
const T = JSON.parse(fs.readFileSync(path.join(here, 'sample-texts.json'), 'utf8'));

function issues(lang, fix) {
  const tx = T[lang].issues;
  const spec = [
    ['I-01', 'critical', 'interactive', '2.1.2', [], 'site_wide', 38, null, 38, [S.cookie], null, ['keyboard', 'screen_reader'], ['blocks', 'blocks'], ['buy', 'newsletter']],
    ['I-02', 'critical', 'automated', '4.1.2', ['2.5.3'], 'site_wide', 38, null, 38, [S.cart], { kind: 'screen_reader', announced: 'button', expected: 'Cart, 2 items, button' }, ['screen_reader', 'keyboard'], ['blocks', 'harder'], ['buy']],
    ['I-03', 'serious', 'automated', '1.1.1', [], 'template', 24, null, 214, [S.photos], null, ['screen_reader'], ['blocks'], ['buy']],
    ['I-04', 'serious', 'interactive', '1.4.10', ['1.4.4'], 'template', 1, 26, 26, [{ ...S.wide, kind: 'pair' }], null, ['low_vision'], ['blocks'], ['buy']],
    ['I-05', 'serious', 'interactive', '2.4.7', [], 'site_wide', 1, 38, 38, [{ ...S.focusOff, kind: 'pair' }], null, ['keyboard', 'cognitive'], ['harder', 'harder'], ['buy', 'newsletter']],
    ['I-06', 'serious', 'measured', '1.4.1', ['3.3.1'], 'pages', 3, null, 3, [S.error], null, ['colour', 'screen_reader', 'cognitive'], ['blocks', 'harder', 'harder'], ['newsletter']],
    ['I-07', 'moderate', 'measured', '1.4.3', [], 'pages', 6, null, 9, [S.hint], { kind: 'contrast', fg: '#C4C4C4', bg: '#FFFFFF', ratio: 1.74, required: 4.5, sample: 'Email address' }, ['low_vision', 'cognitive'], ['harder', 'harder'], ['newsletter']],
    ['I-08', 'moderate', 'measured', '1.4.3', [], 'site_wide', 38, null, 38, [S.footer], { kind: 'contrast', fg: '#B9B9B9', bg: '#FAFAFA', ratio: 1.97, required: 4.5, sample: 'Prices include VAT' }, ['low_vision'], ['harder'], []],
    ['I-09', 'moderate', 'ai_review', '1.2.2', [], 'pages', 2, null, 2, [S.video], null, ['deaf', 'cognitive'], ['blocks', 'harder'], []],
    ['I-10', 'moderate', 'automated', '2.4.2', [], 'template', 24, null, 24, [], { kind: 'source', lines: ['<head>', '  <title>Northwind Outdoor</title>', '  <meta charset="utf-8">'], mark: 1 }, ['screen_reader', 'cognitive'], ['harder', 'harder'], ['buy']],
    ['I-11', 'minor', 'measured', '2.5.8', [], 'template', 6, null, 24, [S.pager], null, ['dexterity'], ['harder'], []],
    ['I-12', 'minor', 'automated', '3.1.1', [], 'pages', 2, null, 2, [], { kind: 'source', lines: ['<!doctype html>', '<html>', '<head>'], mark: 1 }, ['screen_reader'], ['harder'], []],
  ];
  const crit = critIndex();
  return spec.map(([id, sev, method, sc, rel, scope, conf, likely, inst, shots, evidence, groups, levels, journeys], k) => {
    const t = tx[id];
    const shotsOut = shots.map((s, j) => {
      const base = { file: s.file, width: s.width, height: s.height, boxes: s.boxes, kind: s.kind ?? 'crop', alt: t.alt[j] ?? t.alt[0], caption: t.caption[j] ?? t.caption[0], url: U(t.url ?? '/'), label: null, pair: null };
      if (id === 'I-04') return { ...base, label: T[lang].labels.wide, pair: { ...S.narrow, alt: t.alt[1], label: T[lang].labels.narrow } };
      if (id === 'I-05') return { ...base, label: T[lang].labels.unfocused, pair: { ...S.focusOn, alt: t.alt[1], label: T[lang].labels.focused } };
      return base;
    });
    const examples = (t.examples ?? ['/']).map(U);
    return {
      id, key: `WR-${(1e6 + k * 7919).toString(36)}`, rank: k + 1, severity: sev, severity_reason: t.severity_reason, method,
      title: t.title,
      where: { scope, summary: t.where, component: t.component ?? null, template_ids: t.templates ?? [], pages_confirmed: conf, pages_likely: likely, pages_reviewed: 38, instances: inst, example_urls: examples.slice(0, 3), more: Math.max(0, (likely ?? conf) - examples.length) },
      journeys, observed: t.observed, cause: t.cause,
      impacts: groups.map((g, j) => ({ group: g, level: levels[j], text: t.impacts[j] })),
      criteria: { primary: crit(sc, lang), related: rel.map((r) => crit(r, lang)) },
      shots: shotsOut, evidence,
      fix: fix ? t.fix : null,
      dev_ref: { csv_rows: inst },
    };
  });
}

let kb = null;
function critIndex() {
  kb ??= readJson(KB);
  return (id, lang) => {
    const c = kb.find((x) => x.id === id);
    return { id, name: c.title_en, level: c.level, url: c.normative_url };
  };
}

function reviewItems(lang) {
  const tx = T[lang].review;
  const crit = critIndex();
  const spec = [
    ['R-01', '1.1.1', 'serious', ['screen_reader'], [S.photos], 'template', 24],
    ['R-02', '1.1.1', 'moderate', ['screen_reader', 'keyboard'], [S.map], 'pages', 1],
    ['R-03', '2.2.1', 'serious', ['cognitive', 'dexterity', 'screen_reader'], [], 'pages', 2],
    ['R-04', '2.4.4', 'minor', ['screen_reader'], [], 'template', 5],
  ];
  return spec.map(([id, sc, sev, groups, shots, scope, conf]) => {
    const t = tx[id];
    return {
      id, key: `WR-r${id.slice(2)}`, title: t.title,
      where: { scope, summary: t.where, pages_confirmed: conf, pages_likely: null, pages_reviewed: 38, instances: conf, example_urls: [U(t.url)], more: Math.max(0, conf - 1) },
      observed: t.observed, why_uncertain: t.why_uncertain, what_to_check: t.what_to_check,
      if_confirmed: { severity: sev, groups },
      criteria: { primary: crit(sc, lang), related: [] },
      shots: shots.map((s) => ({ file: s.file, width: s.width, height: s.height, boxes: id === 'R-01' ? s.boxes.slice(0, 1) : [], kind: 'crop', alt: t.alt, caption: t.caption, url: U(t.url), label: null, pair: null })),
    };
  });
}

function build(lang, fix) {
  const L = T[lang];
  const is = issues(lang, fix);
  const ri = reviewItems(lang);
  const crit = critIndex();
  const fails = new Map();
  for (const i of is) for (const c of [i.criteria.primary, ...i.criteria.related]) fails.set(c.id, [...(fails.get(c.id) ?? []), i.id]);
  const reviews = new Map();
  for (const r of ri) reviews.set(r.criteria.primary.id, [...(reviews.get(r.criteria.primary.id) ?? []), r.id]);
  const NA = { '1.2.1': L.notes.no_audio_only, '1.2.4': L.notes.no_live, '1.2.5': null, '1.4.2': L.notes.no_autoplay, '2.5.4': L.notes.no_motion, '3.3.8': L.notes.no_login, '2.5.7': L.notes.no_drag };
  const NT = { '1.2.3': L.notes.media_watch, '1.2.5': L.notes.media_watch, '2.3.1': L.notes.flash, '3.2.6': L.notes.help };
  const criteria = crit && kb.filter((c) => c.id !== '4.1.1').map((c) => {
    const lvlOk = c.level !== 'AAA';
    let status = 'pass';
    let note = null;
    if (fails.has(c.id)) status = 'fail';
    else if (reviews.has(c.id)) status = 'needs_review';
    else if (c.id in NT) { status = 'not_tested'; note = NT[c.id]; }
    else if (c.id in NA) { status = 'not_applicable'; note = NA[c.id]; }
    else if (['1.3.2', '1.3.3', '2.4.5', '3.2.3', '3.2.4', '3.3.4', '4.1.3', '1.4.13', '3.3.7'].includes(c.id)) { status = 'not_tested'; note = L.notes.manual; }
    return { id: c.id, name: c.title_en, plain: L.plain[c.id] ?? null, level: c.level, principle: ['', 'perceivable', 'operable', 'understandable', 'robust'][c.id[0]], in_profile: lvlOk, status: lvlOk ? status : 'not_tested', note: lvlOk ? note : null, issue_ids: fails.get(c.id) ?? [], review_ids: reviews.get(c.id) ?? [] };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  const inProf = criteria.filter((c) => c.in_profile);
  const count = (s) => inProf.filter((c) => c.status === s).length;

  const GROUPS = ['screen_reader', 'low_vision', 'colour', 'deaf', 'keyboard', 'dexterity', 'cognitive', 'seizure_motion'];
  const groups = GROUPS.map((g) => {
    const mine = is.filter((i) => i.impacts.some((m) => m.group === g));
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const i of mine) counts[i.severity] += 1;
    return { id: g, counts: { ...counts, total: mine.length }, issue_ids: mine.map((i) => i.id), hardest_issue_id: mine[0]?.id ?? null, blocked_journeys: [...new Set(mine.filter((i) => i.severity === 'critical').flatMap((i) => i.journeys))], summary: L.group_summary[g] ?? null };
  });
  const worst = (journey, g) => {
    const list = is.filter((i) => i.journeys.includes(journey) && i.impacts.some((m) => m.group === g));
    if (!list.length) return { state: 'no_barrier_found', issue_ids: [] };
    const s = list[0].severity;
    return { state: s === 'critical' ? 'blocked' : s === 'serious' ? 'very_hard' : 'some_problems', issue_ids: list.map((i) => i.id) };
  };
  const journeys = [
    { id: 'buy', name: L.journeys.buy, tested: true, not_tested_reason: null, by_group: Object.fromEntries(GROUPS.map((g) => [g, worst('buy', g)])) },
    { id: 'newsletter', name: L.journeys.newsletter, tested: true, not_tested_reason: null, by_group: Object.fromEntries(GROUPS.map((g) => [g, worst('newsletter', g)])) },
    { id: 'store', name: L.journeys.store, tested: false, not_tested_reason: L.journeys.store_reason, by_group: {} },
  ];
  const tpl = [['t01', L.templates.home, 1, '/'], ['t02', L.templates.product, 24, '/p/trail-runner-2'], ['t03', L.templates.category, 6, '/c/hiking'], ['t04', L.templates.content, 5, '/about'], ['t05', L.templates.form, 2, '/contact'], ['t06', L.templates.cart, 2, '/cart']];
  const templates = tpl.map(([id, name, count, ex]) => ({ id, name, page_count: count, deep_tested: true, example_url: U(ex), issue_ids: is.filter((i) => i.where.template_ids.includes(id) || i.where.scope === 'site_wide').map((i) => i.id), review_ids: [] }));
  const productNames = ['trail-runner-2', 'down-jacket', 'day-pack-22', 'camp-stove', 'rain-shell', 'merino-tee', 'trekking-poles', 'headlamp-300', 'sleeping-bag-5', 'tent-2p', 'water-filter', 'gaiters', 'beanie', 'gloves', 'socks-3pack', 'map-case', 'compass', 'first-aid-kit', 'hip-belt', 'stuff-sacks', 'mug', 'spork', 'pillow', 'chair'];
  const pages = [];
  pages.push({ url: U('/'), title: 'Northwind Outdoor', template_id: 't01', deep_tested: true, load_status: 'ok', reason: null });
  productNames.forEach((p, i) => pages.push({ url: U(`/p/${p}`), title: 'Northwind Outdoor', template_id: 't02', deep_tested: i === 0, load_status: 'ok', reason: null }));
  ['hiking', 'camping', 'climbing', 'sale', 'new', 'kids'].forEach((c, i) => pages.push({ url: U(`/c/${c}`), title: c[0].toUpperCase() + c.slice(1), template_id: 't03', deep_tested: i === 0, load_status: 'ok', reason: null }));
  ['about', 'returns', 'shipping', 'privacy', 'journal/winter-layering'].forEach((c, i) => pages.push({ url: U(`/${c}`), title: c, template_id: 't04', deep_tested: i === 0, load_status: 'ok', reason: null }));
  pages.push({ url: U('/contact'), title: 'Contact', template_id: 't05', deep_tested: true, load_status: 'ok', reason: null });
  pages.push({ url: U('/newsletter'), title: 'Newsletter', template_id: 't05', deep_tested: false, load_status: 'ok', reason: null });
  pages.push({ url: U('/cart'), title: 'Cart', template_id: 't06', deep_tested: true, load_status: 'ok', reason: null });
  pages.push({ url: U('/checkout'), title: 'Checkout', template_id: 't06', deep_tested: false, load_status: 'ok', reason: null });
  pages.push({ url: U('/stores'), title: null, template_id: null, deep_tested: false, load_status: 'error', reason: L.pages.timeout });
  pages.push({ url: U('/account'), title: null, template_id: null, deep_tested: false, load_status: 'blocked', reason: L.pages.login });
  for (const p of pages) {
    const path_ = new URL(p.url).pathname;
    p.issue_ids = p.load_status !== 'ok' ? [] : is.filter((i) => i.where.scope === 'site_wide' || i.where.template_ids.includes(p.template_id) || i.where.example_urls.some((u) => new URL(u).pathname === path_)).map((i) => i.id);
    p.review_ids = p.load_status !== 'ok' ? [] : ri.filter((r) => r.where.example_urls.some((u) => new URL(u).pathname === path_)).map((r) => r.id);
  }
  const sev = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const i of is) sev[i.severity] += 1;
  return {
    schema_version: '1.0',
    report: { id: `WR-2026-11-03-northwind${fix ? '-fix' : ''}`, language: lang, generated_at: '2026-11-03T09:00:00Z', wcag_version: '2.2', profile: 'AA', options: { fix, max_pages: 200 } },
    site: { name: 'Northwind Outdoor', url: `${BASE}/`, source: { type: 'url', repo_name: null, commit: null }, home_shot: { file: home.file, width: home.width, height: home.height } },
    scope: { pages_discovered: 40, pages_reviewed: 38, pages_failed: 2, cap_reached: false, max_pages: 200, templates_total: 6, templates_deep: 6, journeys_tested: 2, discovery: ['sitemap', 'links'], excluded: [{ what: '/account/*', reason: L.pages.login }], auth: false, forms_submitted: false, robots_respected: true, documents_not_tested: 3 },
    verdict: { label: 'serious_barriers', headline: L.verdict.headline, summary: L.verdict.summary, conformance: { status: 'does_not_meet', failing_criteria: count('fail'), open_criteria: count('needs_review'), untested_criteria: count('not_tested') } },
    totals: { issues: { ...sev, total: is.length }, review_items: { total: ri.length, potential_serious: ri.filter((r) => ['critical', 'serious'].includes(r.if_confirmed.severity)).length }, criteria: { total: inProf.length, fail: count('fail'), needs_review: count('needs_review'), pass: count('pass'), not_applicable: count('not_applicable'), not_tested: count('not_tested') }, pages_with_blocker: 38, instances: is.reduce((s, i) => s + i.where.instances, 0) },
    groups, journeys,
    priorities: { issue_ids: is.filter((i) => ['critical', 'serious'].includes(i.severity)).slice(0, 7).map((i) => i.id), reason: L.priorities_reason, check_soon: ['R-01', 'R-03'] },
    issues: is, review_items: ri, criteria, templates, pages,
    limits: { gaps: L.gaps },
    method: { environment: { browser: 'Chromium 149', viewports: [[1280, 900], [320, 640]], zoom_percent: [100, 200], tools: [{ name: 'axe-core', version: '4.14.0' }, { name: 'Playwright', version: '1.61.1' }], ai_model: 'Claude', assistive_technology: null }, crawl: { include: [], exclude: ['/account/*'], robots: true }, deep_pages: templates.map((t) => ({ template: t.name, url: t.example_url })), dropped_automated: 31 },
    glossary: L.glossary,
    artifacts: { findings_csv: 'findings.csv', evidence_dir: 'evidence/' },
  };
}

writeJson(path.join(here, 'sample-report.json'), build('en', false));
writeJson(path.join(here, 'sample-report-fix.json'), build('en', true));
console.log(JSON.stringify({ ok: true, shots: fs.readdirSync(SHOTS).length }));
