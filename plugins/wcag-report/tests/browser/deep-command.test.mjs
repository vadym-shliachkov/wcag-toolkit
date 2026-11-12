// The deep and shots commands on a small run built by hand in the contract shape (pages.json, templates.json,
// issues.json), so this area can be tested without the crawler.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDeps } from '../../skills/wcag-report/scripts/lib/deps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures', 'deep');
const ROOT = path.join(here, '..', '.tmp', 'deep-command');
const skip = findDeps() ? false : 'runtime dependencies not installed (run wr.mjs setup)';

let server;
let base;
let mods;
let runDir;

before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, new URL(req.url, 'http://x').pathname);
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(ROOT, { recursive: true });
  mods = {
    core: await import('../../skills/wcag-report/scripts/commands/core.mjs'),
    deep: await import('../../skills/wcag-report/scripts/commands/deep.mjs'),
    browser: await import('../../skills/wcag-report/scripts/lib/browser.mjs'),
  };
  const init = mods.core.init({ root: ROOT, url: `${base}/focus-bad.html` });
  runDir = init.dir;
  const page = (id, file, templateId) => ({ id, url: `${base}/${file}.html`, finalUrl: `${base}/${file}.html`, status: 200, title: file, lang: 'en', depth: 0, source: 'start', shape: `/${file}`, templateId, state: 'default', blocked: false, soft404: false, error: null, scannedAt: new Date().toISOString() });
  fs.writeFileSync(path.join(runDir, 'pages.json'), JSON.stringify({ base, pages: [page('p001', 'focus-bad', 't01'), page('p002', 'reflow-bad', 't02')], skipped: [], documents: [], stats: {} }));
  fs.writeFileSync(path.join(runDir, 'templates.json'), JSON.stringify({ templates: [
    { id: 't01', name: 'Home page', kind: 'home', pageIds: ['p001'], representative: 'p001', keyFlow: true, deep: true, skippedReason: null },
    { id: 't02', name: 'Prices', kind: 'other', pageIds: ['p002'], representative: 'p002', keyFlow: false, deep: true, skippedReason: null },
  ] }));
});

after(async () => {
  if (skip) return;
  await mods.browser.closeBrowser();
  server?.close();
});

test('deep resumes under a tight budget and finishes', { skip }, async () => {
  let r = await mods.deep.deep({ root: ROOT, budget: '1', check: 'keyboard,reflow' });
  let rounds = 1;
  while (!r.done && rounds < 6) { r = await mods.deep.deep({ root: ROOT, budget: '120', check: 'keyboard,reflow' }); rounds += 1; }
  assert.equal(r.done, true);
  assert.deepEqual(r.templatesDone.sort(), ['t01', 't02']);
  const reflow = JSON.parse(fs.readFileSync(path.join(runDir, 'deep', 't02', 'reflow.json'), 'utf8'));
  assert.equal(reflow.check, 'reflow');
  assert.ok(reflow.signals.some((s) => s.status === 'fail' && s.sc.includes('1.4.10')));
  for (const k of ['templateId', 'pageId', 'url', 'ran', 'environment', 'steps', 'signals', 'artifacts']) assert.ok(k in reflow, `deep record misses ${k}`);
});

test('template shots are written and indexed', { skip }, async () => {
  const r = await mods.deep.shots({ root: ROOT });
  assert.deepEqual(r.templates.sort(), ['t01', 't02']);
  const index = JSON.parse(fs.readFileSync(path.join(runDir, 'shots', 'index.json'), 'utf8'));
  for (const t of ['t01', 't02']) {
    assert.ok(fs.existsSync(path.join(runDir, index.templates[t].desktop)));
    assert.ok(fs.existsSync(path.join(runDir, index.templates[t].w320)));
  }
});

test('issue crops record boxes inside the image and focus pairs', { skip }, async () => {
  const issues = [
    { key: 'WR-focus1', status: 'fail', severity: 'serious', check: 'focus-visible', criteria: { primary: { id: '2.4.7' }, related: [] },
      instances: [{ pageId: 'p001', url: `${base}/focus-bad.html`, selector: 'nav > a:nth-of-type(2)', state: 'focus', viewport: [1280, 900], bbox: null }] },
    { key: 'WR-reflow1', status: 'fail', severity: 'serious', check: 'reflow', criteria: { primary: { id: '1.4.10' }, related: [] },
      instances: [{ pageId: 'p002', url: `${base}/reflow-bad.html`, selector: 'div.wide', state: 'w320', viewport: [320, 640], bbox: null }] },
    { key: 'WR-gone', status: 'fail', severity: 'minor', check: 'x', criteria: { primary: { id: '1.1.1' }, related: [] },
      instances: [{ pageId: 'p001', url: `${base}/focus-bad.html`, selector: '#does-not-exist', state: 'default', bbox: null }] },
  ];
  fs.writeFileSync(path.join(runDir, 'issues.json'), JSON.stringify(issues));
  const r = await mods.deep.shots({ root: ROOT, issues: true });
  assert.equal(r.captured, 2);
  const out = JSON.parse(fs.readFileSync(path.join(runDir, 'issues.json'), 'utf8'));
  const focus = out.find((i) => i.key === 'WR-focus1').shots[0];
  assert.equal(focus.kind, 'pair');
  assert.ok(fs.existsSync(path.join(runDir, focus.pair.file)));
  for (const s of [focus, out.find((i) => i.key === 'WR-reflow1').shots[0]]) {
    assert.ok(fs.existsSync(path.join(runDir, s.file)));
    const b = s.boxes[0];
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= s.width + 1 && b.w > 0, `box ${JSON.stringify(b)} outside ${s.width}×${s.height}`);
    assert.ok(s.width <= 1200);
  }
  assert.deepEqual(out.find((i) => i.key === 'WR-gone').shots, []);
  assert.ok(r.imageBytes > 0 && r.imageBytes < 12 * 1024 * 1024);
});

// issues.json keeps the criterion as its number. On a page with `scroll-behavior: smooth` the element used to be
// measured before the scroll ran, which left a 2 px box on the crop's bottom edge and the element out of the picture.
test('issue crops find the element on a smooth-scrolling page, and findings without a page are skipped', { skip }, async () => {
  const issues = [
    { key: 'WR-far1', status: 'needs_review', severity: 'minor', check: 'color-contrast', criteria: { primary: '1.4.3', related: [] },
      instances: [{ pageId: 'p001', url: `${base}/smooth-scroll.html`, selector: '#far', state: 'default', viewport: [1280, 900], bbox: null }] },
    { key: 'WR-site1', status: 'needs_review', severity: 'minor', check: 'judge-2.5.3', criteria: { primary: '2.5.3', related: [] },
      instances: [{ pageId: null, url: 'site', selector: null, state: 'default', bbox: null }] },
  ];
  fs.writeFileSync(path.join(runDir, 'issues.json'), JSON.stringify(issues));
  const pagesFile = path.join(runDir, 'pages.json');
  const saved = fs.readFileSync(pagesFile, 'utf8');
  const pages = JSON.parse(saved);
  pages.pages = pages.pages.map((p) => (p.id === 'p001' ? { ...p, url: `${base}/smooth-scroll.html`, finalUrl: `${base}/smooth-scroll.html` } : p));
  fs.writeFileSync(pagesFile, JSON.stringify(pages));
  try {
    const r = await mods.deep.shots({ root: ROOT, issues: true });
    assert.equal(r.captured, 1);
    const out = JSON.parse(fs.readFileSync(path.join(runDir, 'issues.json'), 'utf8'));
    const s = out.find((i) => i.key === 'WR-far1').shots[0];
    const b = s.boxes[0];
    assert.ok(b.h > 10 && b.w > 50, `box ${JSON.stringify(b)} is a sliver`);
    assert.ok(b.y > 0 && b.y + b.h < s.height, `box ${JSON.stringify(b)} is not inside ${s.width}×${s.height}`);
    assert.match(s.visibleText, /Far down link/);
    assert.deepEqual(out.find((i) => i.key === 'WR-site1').shots, []);
  } finally {
    fs.writeFileSync(pagesFile, saved);
  }
});
