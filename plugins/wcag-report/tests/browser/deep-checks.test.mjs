// Each deep check against its planted page (must report the problem) and its clean page (must not report a failure:
// a false failure in a client report costs more than a missed one).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDeps } from '../../skills/wcag-report/scripts/lib/deps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, '..', 'fixtures', 'deep');
const TMP = path.join(here, '..', '.tmp', 'deep');
const skip = findDeps() ? false : 'runtime dependencies not installed (run wr.mjs setup)';

let server;
let base;
let browser;
let img;
let closeBrowser;

before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(FIXTURES) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const b = await import('../../skills/wcag-report/scripts/lib/browser.mjs');
  closeBrowser = b.closeBrowser;
  browser = (await b.getBrowser()).browser;
  img = await (await import('../../skills/wcag-report/scripts/lib/image.mjs')).imageTools(browser);
});

after(async () => {
  if (skip) return;
  await img?.close();
  await closeBrowser?.();
  server?.close();
});

async function runCheck(name, fixture, { level = 'AA' } = {}) {
  const mod = await import(`../../skills/wcag-report/scripts/lib/deep/${name}.mjs`);
  const outDir = path.join(TMP, `${name}-${fixture}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const env = { browser, img, url: `${base}/${fixture}.html`, pageId: 'p001', templateId: 't01', outDir, relDir: `deep/t01`, level, options: {}, shared: {} };
  return mod.run(env);
}

const bySc = (r, sc, status) => r.signals.filter((s) => s.sc.includes(sc) && s.status === status);
const fails = (r) => r.signals.filter((s) => s.status === 'fail');

// [check module, fixture stem, criterion, status expected on the planted page]
const CASES = [
  ['keyboard', 'keyboard', '2.1.2', 'fail'],
  ['keyboard', 'keyboard', '2.1.1', 'fail'],
  ['focus-visible', 'focus', '2.4.7', 'fail'],
  ['focus-obscured', 'obscured', '2.4.11', 'fail'],
  ['focus-obscured', 'obscuredoverlay', '2.4.11', 'fail'],
  ['focus-obscured', 'obscuredinvisible', '2.4.7', 'fail'],
  ['reflow', 'reflow', '1.4.10', 'fail'],
  ['text-spacing', 'spacing', '1.4.12', 'fail'],
  ['resize-text', 'resize', '1.4.4', 'fail'],
  ['resize-text', 'zoom', '1.4.4', 'fail'],
  ['hover-content', 'hover', '1.4.13', 'fail'],
  ['hover-content', 'hovermenu', '2.1.1', 'fail'],
  ['hover-content', 'hovermenubtn', '2.1.1', 'fail'],
  ['interaction', 'toggles', '2.4.3', 'fail'],
  ['reflow', 'reflowlost', '1.4.10', 'fail'],
  ['motion', 'ticker', '2.2.2', 'fail'],
  ['forms', 'forms', '1.4.1', 'fail'],
  ['forms', 'forms', '3.3.8', 'fail'],
  ['keyboard', 'keyboard', '4.1.2', 'fail'],
  ['orientation', 'orientation', '1.3.4', 'fail'],
  ['motion', 'motion', '2.2.2', 'fail'],
  ['motion', 'overlay', '2.2.2', 'fail'],
  ['reflow', 'reflowpause', '1.4.10', 'fail'],
  ['target-size', 'targets', '2.5.8', 'fail'],
  ['forms', 'forms', '3.3.1', 'fail'],
  ['states', 'states', '1.1.1', 'fail'],
];

for (const [check, stem, sc, status] of CASES) {
  test(`${check}: planted ${stem} page reports ${sc} as ${status}`, { skip }, async () => {
    const r = await runCheck(check, `${stem}-bad`);
    assert.equal(r.ran, true, r.reason ?? 'did not run');
    const hits = bySc(r, sc, status);
    assert.ok(hits.length > 0, `expected a ${status} for ${sc}; got ${JSON.stringify(r.signals.map((s) => [s.sc, s.status, s.description]))}`);
    for (const s of hits) {
      assert.ok(s.description && s.expected && s.steps.length, 'signal needs description, expected and steps');
      assert.ok(['blocker', 'major', 'minor'].includes(s.barrier));
      if (s.status === 'fail') assert.equal(s.trust, 'confirmed');
    }
  });
  test(`${check}: clean ${stem} page reports no failure`, { skip }, async () => {
    const r = await runCheck(check, `${stem}-ok`);
    if (!r.ran) return; // nothing to test on the clean page is fine
    assert.deepEqual(fails(r).map((s) => [s.sc, s.description]), []);
    if (status === 'needs_review') assert.equal(bySc(r, sc, 'needs_review').length, 0, 'clean page should not need review');
  });
}

test('motion: a moving canvas under text is one finding on the canvas, not one per text block', { skip }, async () => {
  const r = await runCheck('motion', 'overlay-bad');
  const hits = bySc(r, '2.2.2', 'fail');
  assert.equal(hits.length, 1, JSON.stringify(hits.map((s) => s.selector)));
  assert.equal(hits[0].selector, '#c');
  assert.equal(typeof hits[0].measured.changedShare, 'number');
});

test('axe: text inside a frame from another origin is tested', { skip }, async () => {
  const { runAxe } = await import('../../skills/wcag-report/scripts/lib/axe-run.mjs');
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${base}/frame-host.html`);
    const src = `http://localhost:${server.address().port}/frame-inner.html`;
    await page.evaluate((u) => new Promise((ok) => { const f = document.createElement('iframe'); f.onload = ok; f.src = u; document.body.append(f); }), src);
    const axe = await runAxe(page, { level: 'AA', pageId: 'p001' });
    const nodes = axe.violations.find((v) => v.id === 'color-contrast')?.nodes ?? [];
    assert.ok(nodes.some((n) => n.frame), JSON.stringify({ violations: axe.violations.map((v) => v.id), incomplete: axe.incomplete.map((v) => v.id) }));
  } finally {
    await context.close();
  }
});

// The specific check behind a planted problem, where one criterion has several checks.
const BY_CHECK = [
  ['keyboard', 'keyboard-bad', 'custom-control-role'],
  ['keyboard', 'keyboard-bad', 'focus-dropped'],
  ['resize-text', 'zoom-bad', 'text-zoom'],
  ['hover-content', 'hovermenu-bad', 'hover-keyboard'],
  ['hover-content', 'hover-bad', 'hover-keyboard'],
  ['interaction', 'toggles-bad', 'toggle-focus-order'],
  ['reflow', 'reflowlost-bad', 'reflow-content'],
  ['forms', 'forms-bad', 'required-marker'],
  ['forms', 'forms-bad', 'paste-blocked'],
];
for (const [check, fixture, id] of BY_CHECK) {
  test(`${check}: ${fixture} fails ${id}`, { skip }, async () => {
    const r = await runCheck(check, fixture);
    assert.ok(r.signals.some((s) => s.check === id && s.status === 'fail'), `no ${id} failure; got ${JSON.stringify(r.signals.filter((s) => s.check === id).map((s) => [s.status, s.description]))}`);
  });
}

test('measure: text colour without a background colour fails 1.4.3, with one it passes', { skip }, async () => {
  const { measurePage } = await import('../../skills/wcag-report/scripts/lib/measure.mjs');
  const { openPage } = await import('../../skills/wcag-report/scripts/lib/deep/common.mjs');
  for (const [fixture, status] of [['colour-bad', 'fail'], ['colour-ok', 'pass']]) {
    const env = { browser, img, url: `${base}/${fixture}.html`, pageId: 'p001', templateId: 't01', options: {} };
    const { context, page } = await openPage(env);
    try {
      const signals = await measurePage(env, page, null);
      const s = signals.find((x) => x.check === 'colour-without-background');
      assert.equal(s?.status, status, `${fixture}: ${JSON.stringify(s)}`);
    } finally { await context.close(); }
  }
});

// Text measured only in the state a visitor puts it in: the pointer over its card, keyboard focus inside it.
async function stateSignals(fixture) {
  const { measurePage } = await import('../../skills/wcag-report/scripts/lib/measure.mjs');
  const { openPage } = await import('../../skills/wcag-report/scripts/lib/deep/common.mjs');
  const outDir = path.join(TMP, `measure-${fixture}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  const env = { browser, img, url: `${base}/${fixture}.html`, pageId: 'p001', templateId: 't01', options: {}, outDir, relDir: 'deep/t01' };
  const { context, page } = await openPage(env);
  try {
    return { outDir, signals: (await measurePage(env, page, null)).filter((s) => s.check === 'color-contrast' || s.check === 'state-contrast') };
  } finally { await context.close(); }
}

test('measure: text that loses contrast on hover or keyboard focus fails 1.4.3, in that state', { skip }, async () => {
  const { outDir, signals } = await stateSignals('statecontrast-bad');
  const fails = signals.filter((s) => s.status === 'fail');
  const has = (state, id) => fails.some((s) => s.state === state && s.selector.includes(id));
  const got = JSON.stringify(fails.map((s) => [s.state, s.selector, s.measured.ratio]));
  assert.ok(has('hover', '#iris-text'), `white 16 px text on the iris card under the pointer; got ${got}`);
  assert.ok(!fails.some((s) => s.selector.includes('#iris-title')), 'the 32 px title is large text and passes at 3.3:1');
  assert.ok(has('hover', '#lav-label'), `semibold 20 px label (600 is not bold) under the pointer; got ${got}`);
  assert.ok(has('keyboard-focus', '#lav-label'), `the same label with keyboard focus on the link inside the card; got ${got}`);
  assert.ok(has('hover', '#cta-eyebrow'), `call-to-action eyebrow under the pointer; got ${got}`);
  assert.ok(has('hover', '#chip'), `a hover written with CSS nesting; got ${got}`);
  for (const s of fails) {
    assert.deepEqual(s.sc, ['1.4.3']);
    assert.equal(s.trust, 'confirmed');
    assert.ok(s.measured.ratio < s.measured.required, `${s.selector}: ${s.measured.ratio} < ${s.measured.required}`);
    assert.ok(s.measured.worstContrast < s.measured.required, `${s.selector}: confirmed by the pixels in that state`);
    assert.match(s.description, new RegExp(`\\(only in the "${s.state}" state\\)`));
    assert.ok(s.measured.fg && s.measured.bg, 'the colour pair groups it with the same pair elsewhere');
    assert.ok(s.evidence.length && fs.existsSync(path.join(outDir, path.basename(s.evidence[0]))), 'a picture of the text in that state');
  }
});

test('measure: colours that hold in every reachable state, and states no visitor reaches, report no failure', { skip }, async () => {
  const { signals } = await stateSignals('statecontrast-ok');
  assert.deepEqual(signals.filter((s) => s.status === 'fail').map((s) => [s.state, s.selector, s.description]), []);
  const pass = signals.find((s) => s.check === 'state-contrast' && s.status === 'pass');
  assert.ok(pass, 'the states it tested are recorded as a pass');
});

test('measure notes: a pause button that only swaps its name is a clean-up note; aria-pressed is not', { skip }, async () => {
  const { toggleNotes } = await import('../../skills/wcag-report/scripts/lib/measure.mjs');
  const { openPage } = await import('../../skills/wcag-report/scripts/lib/deep/common.mjs');
  for (const [fixture, count] of [['togglename-bad', 1], ['togglename-ok', 0]]) {
    const env = { browser, img, url: `${base}/${fixture}.html`, pageId: 'p001', templateId: 't01', options: {} };
    const { context, page } = await openPage(env);
    try {
      const notes = await toggleNotes(page);
      assert.equal(notes.filter((n) => n.code === 'toggle_state_in_name').length, count, `${fixture}: ${JSON.stringify(notes)}`);
      if (count) {
        assert.match(notes[0].detail, /Pause the logo animation" becomes "Play the logo animation/);
        assert.equal(await page.$eval('#tg .sr-only', (e) => e.textContent), 'Pause the logo animation', 'the page is left as it was');
      }
    } finally { await context.close(); }
  }
});

test('signals follow the contract shape', { skip }, async () => {
  const r = await runCheck('reflow', 'reflow-bad');
  const keys = ['source', 'check', 'sc', 'status', 'pageId', 'url', 'state', 'viewport', 'selector', 'html', 'bbox', 'description', 'measured', 'barrier', 'trust', 'evidence', 'expected', 'steps'];
  for (const s of r.signals) for (const k of keys) assert.ok(k in s, `missing ${k}`);
  for (const f of r.signals.flatMap((s) => s.evidence)) assert.ok(fs.existsSync(path.join(TMP, 'reflow-reflow-bad', path.basename(f))), `evidence file ${f} not written`);
});
