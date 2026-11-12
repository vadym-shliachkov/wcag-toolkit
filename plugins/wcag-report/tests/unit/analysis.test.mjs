import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/wcag-report/scripts/lib');
const imp = (m) => import(new URL(`file:///${path.join(LIB, m).replace(/\\/g, '/')}`).href);

const { scFromTags, ruleInfo } = await imp('signals.mjs');
const { selectorSkeleton, componentFingerprint, issueKey } = await imp('dedupe.mjs');
const { severityOf } = await imp('severity.mjs');
const { mergeObservations } = await imp('merge.mjs');
const { signalToObservation, checkObservation } = await imp('observations.mjs');
const { validate, loadSchema } = await imp('schema.mjs');
const { publicPath } = await imp('report-paths.mjs');
const { finalizeVerdict, lintReport, drawSample } = await imp('redteam.mjs');
const { crossCheck } = await imp('report-data.mjs');

test('axe tags map to criteria; 4.1.1 is never reported', () => {
  assert.deepEqual(scFromTags(['wcag2a', 'wcag111', 'wcag1410', 'wcag2411', 'wcag411']), ['1.1.1', '1.4.10', '2.4.11']);
  assert.equal(ruleInfo('region', ['best-practice']).bestPractice, true);
  assert.equal(ruleInfo('some-unknown-rule', ['wcag412']).trust, 'review');
});

test('selector skeletons survive list positions, hashes and attribute values', () => {
  assert.equal(selectorSkeleton('main > ul > li:nth-child(3) > a.card-link'), 'ul > li > a.card-link');
  assert.equal(selectorSkeleton('div.css-1x2y3z > button.Header_btn__a1b2c'), 'div > button');
  assert.equal(selectorSkeleton('img[src$="team.jpg"]'), 'img');
  const a = componentFingerprint({ selector: 'p', measured: { fg: '#B4B4B4', bg: '#fff', fontSize: '14px' } });
  const b = componentFingerprint({ selector: 'footer > p', measured: { fg: '#b4b4b4', bg: '#FFF', fontSize: '14px' } });
  assert.equal(a, b, 'one colour pair in one text style is one cause');
  assert.match(issueKey('1.1.1', 'image-alt', 'main|img'), /^WR-[a-z2-7]{6}$/);
});

test('severity follows the barrier and rises one step at most (matches references/severity.md)', () => {
  const md = fs.readFileSync(path.join(LIB, '../../references/severity.md'), 'utf8');
  const rows = [...md.matchAll(/^\| (blocker|major|minor) \| (\w+) \| (\w+) \| (\w+) \|$/gm)];
  assert.equal(rows.length, 3);
  for (const [, barrier, side, key, task] of rows) {
    assert.equal(severityOf({ barrier, reachShare: 0.1 }), side.toLowerCase());
    assert.equal(severityOf({ barrier, keyJourney: true, global: true, reachShare: 0.9 }), key.toLowerCase());
    assert.equal(severityOf({ barrier, keyTask: true, keyJourney: true }), task.toLowerCase());
  }
});

function fixture() {
  const pages = Array.from({ length: 4 }, (_, i) => ({ id: `p00${i + 1}`, url: `https://ex.test/${i ? `p${i}` : ''}`, status: 200, depth: i ? 1 : 0, templateId: i ? 't02' : 't01' }));
  const templates = [{ id: 't01', name: 'Home', pageIds: ['p001'], representative: 'p001', deep: true, keyFlow: true }, { id: 't02', name: 'Articles', pageIds: ['p002', 'p003', 'p004'], representative: 'p002', deep: true }];
  const sig = (over) => ({ source: 'axe', check: 'link-name', sc: ['2.4.4', '4.1.2'], status: 'fail', state: 'default', viewport: [1280, 900], selector: 'header a.icon', html: '<a class="icon" href="/cart">', description: 'Links must have discernible text.', barrier: 'blocker', trust: 'confirmed', evidence: ['signals.json'], steps: ['Open the page'], ...over });
  const signals = [
    ...pages.map((p) => sig({ pageId: p.id, url: p.url, templateId: p.templateId })),
    { ...sig({ source: 'deep', check: 'keyboard', sc: ['2.1.1'], status: 'pass', selector: null, html: null, pageId: 'p001', templateId: 't01' }) },
    { ...sig({ source: 'deep', check: 'keyboard', sc: ['2.1.1'], status: 'pass', selector: null, html: null, pageId: 'p002', templateId: 't02' }) },
  ];
  const observations = signals.map((s, i) => signalToObservation(s, i + 1, { level: 'AA', userAgent: 'test' }));
  return { pages, templates, observations };
}

test('signals become schema-valid knowledge-base observations', () => {
  const { observations } = fixture();
  for (const o of observations) assert.deepEqual(checkObservation(o, null), []);
});

test('merge: one issue for one component on every page; statuses follow the KB contract', () => {
  const { pages, templates, observations } = fixture();
  const { issues, criteriaStatus } = mergeObservations({ observations, pages, templates, collects: [], level: 'AA' });
  const fails = issues.filter((i) => i.status === 'fail');
  assert.equal(fails.length, 1);
  assert.equal(fails[0].reach.pages, 4);
  assert.equal(fails[0].scope, 'site_wide');
  assert.equal(fails[0].severity, 'serious', 'a blocker on every page but no task page is serious, not critical');
  assert.deepEqual(fails[0].criteria, { primary: '2.4.4', related: ['4.1.2'] });
  const st = Object.fromEntries(criteriaStatus.map((c) => [c.id, c]));
  assert.equal(st['2.4.4'].status, 'fail');
  assert.equal(st['4.1.2'].status, 'fail', 'related criteria of a confirmed failure fail too');
  assert.equal(st['1.4.3'].status, 'not_tested', 'silence from the scanner is never a pass');
  assert.equal(st['1.4.6'].in_profile, false, 'AAA is outside an AA review, not "not applicable"');
});

test('judge fails need a quote that is really in the collected data', async () => {
  const { convertJudgeOutput } = await imp('judge.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-judge-'));
  fs.mkdirSync(path.join(dir, 'collect'));
  fs.writeFileSync(path.join(dir, 'collect', 'p001.json'), JSON.stringify({ images: [{ alt: 'IMG_4471.jpg' }] }));
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify({ pages: [{ id: 'p001', url: 'https://ex.test/', status: 200 }] }));
  fs.writeFileSync(path.join(dir, 'templates.json'), JSON.stringify({ templates: [{ id: 't01', pageIds: ['p001'], representative: 'p001' }] }));
  const ctx = { p: { dir, pages: path.join(dir, 'pages.json'), templates: path.join(dir, 'templates.json') }, run: { options: { level: 'AA' }, versions: {} } };
  const base = { sc: '1.1.1', status: 'fail', pageId: 'p001', observed: 'The product photo is described only by its file name.', barrier: 'major', evidence_file: 'collect/p001.json' };
  const good = convertJudgeOutput(ctx, { observations: [{ ...base, evidence_quote: 'IMG_4471.jpg' }] }, { template: 't01' });
  // Only the other criteria of the scope are missing: the quoted fail itself is accepted.
  assert.deepEqual(good.errors.filter((e) => !/missing:/.test(e)), []);
  assert.match(good.errors.join(' '), /needs at least one observation; missing: .*1\.3\.1/);
  assert.equal(good.observations[0].x.source, 'judge');
  const bad = convertJudgeOutput(ctx, { observations: [{ ...base, evidence_quote: 'photo of shoes' }] }, { template: 't01' });
  assert.match(bad.errors.join(' '), /not found/);
  const outside = convertJudgeOutput(ctx, { observations: [{ ...base, sc: '2.1.2', evidence_quote: 'IMG_4471.jpg' }] }, { template: 't01' });
  assert.match(outside.errors.join(' '), /not one of your criteria/);
});

test('the gate recomputes readiness: a lenient reviewer cannot pass a report with blockers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-rt-'));
  const rd = path.join(dir, 'review', 'r1');
  fs.mkdirSync(rd, { recursive: true });
  fs.writeFileSync(path.join(rd, 'lint.json'), JSON.stringify({ defects: [{ check: 'SEC-02', dimension: 'confidentiality', severity: 'blocker', cause: 'content', page: 3, evidence: 'localhost:4517' }] }));
  fs.writeFileSync(path.join(rd, 'pdf-a11y.json'), JSON.stringify({ checks: [{ id: 'PDF-01', ok: true }] }));
  const ctx = { p: { reviewDir: () => rd } };
  const tmt = { q1: 'a', q2: 'b', q3: 'c', q4: 'd', q5: 'e', q6: 'f', q7: 'g' };
  const v = finalizeVerdict(ctx, 1, { round: 1, ready: true, pages_seen: 10, defects: [], two_minute_test: tmt }, { page_count: 10 });
  assert.equal(v.ready, false);
  assert.equal(v.reviewer_ready, true);
  const dismissed = finalizeVerdict(ctx, 1, { round: 1, pages_seen: 10, defects: [], two_minute_test: tmt, dismissed_automated: [{ check: 'SEC-02', reason: 'quoted test URL' }] }, { page_count: 10 });
  assert.equal(dismissed.ready, true);
  const strict = finalizeVerdict(ctx, 1, { round: 1, pages_seen: 10, defects: [{ dimension: 'accuracy', severity: 'major', cause: 'evidence', evidence: 'x' }], two_minute_test: tmt, dismissed_automated: [{ check: 'SEC-02' }] }, { page_count: 10 });
  assert.equal(strict.ready, false, 'no major is allowed in accuracy');
});

test('report lint finds claims and leaks but ignores the template disclaimers', () => {
  const ctx = { run: { options: { lang: 'en', fix: false } }, p: { text: () => '/nonexistent' } };
  const report = { issues: [{ id: 'I-01' }], review_items: [] };
  const clean = lintReport(ctx, ['I-01 Keyboard users get stuck. This report is not a certification, a full conformance audit or an accessibility conformance report (VPAT).'], report);
  assert.deepEqual(clean.filter((d) => d.severity === 'blocker'), []);
  const bad = lintReport(ctx, ['I-01 Your site is fully accessible on http://localhost:4517/about. undefined'], report);
  const checks = bad.map((d) => d.check);
  assert.ok(checks.includes('CRED-01') && checks.includes('SEC-02') && checks.includes('TON-04'));
});

test('the spot-check sample is deterministic and includes every critical issue', () => {
  const report = { issues: [{ id: 'I-01', severity: 'critical' }, { id: 'I-02', severity: 'minor', basis: 'ai_review' }, { id: 'I-03', severity: 'minor' }], review_items: [{ id: 'R-01' }] };
  const ctx = { id: 'run-1', p: { amendments: '/nonexistent' } };
  const a = drawSample(ctx, report, 1);
  assert.deepEqual(a, drawSample(ctx, report, 1));
  assert.ok(a.some((s) => s.id === 'I-01' && s.why === 'critical'));
  assert.ok(a.some((s) => s.id === 'R-01'));
});

test('local server addresses never reach the client', () => {
  assert.equal(publicPath('http://127.0.0.1:4517/shop?x=1', 'http://127.0.0.1:4517/'), '/shop?x=1');
  assert.equal(publicPath('https://example.com/a', 'https://example.com/'), '/a');
  assert.equal(publicPath('https://cdn.other.test/a', 'https://example.com/'), 'https://cdn.other.test/a');
});

test('schema validator handles $ref, if/then, not and oneOf', () => {
  const s = loadSchema('observation');
  assert.ok(validate(s, { criterion_id: '4.1.1' }).some((e) => /must not match/.test(e)));
  assert.deepEqual(validate({ oneOf: [{ type: 'null' }, { type: 'object', required: ['a'] }] }, null), []);
  assert.equal(validate({ oneOf: [{ type: 'null' }, { type: 'object', required: ['a'] }] }, {}).length, 1);
});

test('cross-checks catch numbers that disagree', () => {
  const r = { issues: [{ id: 'I-01', severity: 'critical', criteria: { primary: { id: '2.4.4' } }, where: { pages_confirmed: 2, pages_likely: null, pages_reviewed: 4 } }],
    review_items: [], totals: { issues: { critical: 1, serious: 0, moderate: 0, minor: 0, total: 2 } },
    criteria: [{ id: '2.4.4', in_profile: true, status: 'fail', issue_ids: ['I-01'], review_ids: [] }],
    priorities: { issue_ids: ['I-09'], check_soon: [] }, groups: [], journeys: [], site: {}, pages: [] };
  const w = crossCheck(r).join(' ');
  assert.match(w, /Total issues/);
  assert.match(w, /unknown ID I-09/);
});

test('red-team regressions: one element seen by several checks is one problem', async () => {
  const { foldCrossSource, foldReviews } = await imp('merge.mjs');
  const o = (source, check, sc, pageId, selector) => ({ criterion_id: sc, related_criteria: [], status: 'fail', x: { source, check, pageId, selector } });
  const axe = { fp: 'main|.icon-link', observations: ['p1', 'p2', 'p3'].map((pg) => o('axe', 'link-name', '2.4.4', pg, '.icon-link')) };
  const judge = { fp: 'header|header.site-header > a.icon-link', observations: [o('judge', 'judge-1.1.1', '1.1.1', 'p2', 'header.site-header > a.icon-link')] };
  const deep = { fp: 'main|p.social > a', observations: [o('deep', 'target-size', '2.5.8', 'p1', 'p.social > a')] };
  const axeTargets = { fp: 'main|a', observations: ['p1', 'p2', 'p3'].map((pg) => o('axe', 'target-size', '2.5.8', pg, 'a')) };
  const other = { fp: 'main|div.wide', observations: [o('deep', 'reflow', '1.4.10', 'p1', 'div.wide')] };
  const out = foldCrossSource([axe, judge, deep, axeTargets, other], 3);
  assert.equal(out.length, 3, 'judge joins the link issue, deep joins the target issue, reflow stays');
  assert.equal(axe.observations.length, 4);
  assert.equal(axeTargets.observations.length, 4);
  const r = (sc, pg) => ({ fp: `x|${Math.random()}`, observations: [{ criterion_id: sc, x: { pageId: pg } }] });
  assert.equal(foldReviews([r('1.2.2', 'p1'), r('1.2.2', 'p1'), r('1.2.2', 'p2'), r('3.3.2', 'p1')]).length, 3);
});

test('red-team regressions: the same question on many pages is one item to check', async () => {
  const { foldReviews, tagTail } = await imp('merge.mjs');
  assert.equal(tagTail('#work-alpha > figure.proof > img'), 'figure > img');
  assert.equal(tagTail('.a > .b[data-x="AI and data"]'), null);
  assert.equal(tagTail('.leader:nth-child(2) > h3'), '* > h3');
  const g = (source, sc, pg, fp, selector, observed) => ({ fp, observations: [{ criterion_id: sc, observed, x: { source, check: source === 'axe' ? 'color-contrast' : `judge-${sc}`, pageId: pg, selector } }] });
  const bg = "Elements must meet minimum color contrast ratio thresholds. Fix any of the following: Element's background color could not be determined due to a background image.";
  const glyph = 'Elements must meet minimum color contrast ratio thresholds. Fix any of the following: Element content contains only non-text characters.';
  const out = foldReviews([
    g('axe', '1.4.3', 'p1', 'main|#about-title', '#about-title', bg),
    g('axe', '1.4.3', 'p2', 'main|#work-title', '#work-title', bg),
    g('axe', '1.4.3', 'p3', 'main|a > span', 'a > span', glyph),
    g('axe', '1.4.3', 'p3', 'header|#logo', '#logo', bg),
    g('judge', '1.1.1', 'p1', 'main|#a-work > figure > img', '#a-work > figure > img'),
    g('judge', '1.1.1', 'p4', 'main|#b-work > figure.x > img', '#b-work > figure.x > img'),
    g('judge', '1.1.1', 'p4', 'main|#hero', '#hero'),
  ]);
  assert.equal(out.length, 5, 'banner text joins, glyphs and the header stay apart, case-study images join, the hero stays');
});

test('a judge’s wording failures on the same kind of element are one problem, each place keeping its fix', async () => {
  const { foldJudgeFails } = await imp('merge.mjs');
  const g = (pg, sel, suggestion, source = 'judge') => ({ fp: `main|${sel}`, observations: [{ criterion_id: '1.1.1', x: { source, pageId: pg, selector: sel, suggestion } }] });
  const collects = [
    { pageId: 'p1', images: [{ selector: '#a-work > figure.x > img', alt: 'Alpha project context' }] },
    { pageId: 'p2', images: [{ selector: '#b-work > figure > img', alt: 'Beta project context' }] },
    { pageId: 'p3', images: [{ selector: 'div.brand > img', alt: 'Acme logo' }] },
    { pageId: 'p4', images: [{ selector: '#c-work > figure > img', alt: 'Gamma project context' }] },
    { pageId: 'p5', images: [{ selector: '#d > figure > img', alt: 'Research notes and glasses beside a laptop' }] },
  ];
  const out = foldJudgeFails([
    g('p1', '#a-work > figure.x > img', 'A mechanic talks with two customers'),
    g('p2', '#b-work > figure > img', 'Beta homepage'),
    g('p3', 'div.brand > img', ''),
    g('p4', '#c-work > figure > img', null),
    g('p5', '#d > figure > img', ''),
  ], collects);
  assert.equal(out.length, 3, 'the two "<client> project context" images join; the logo and the stock photo (both alt="") join; the one without a suggestion stays');
  assert.deepEqual(out[0].observations.map((o) => o.x.suggestion), ['A mechanic talks with two customers', 'Beta homepage']);
});

test('a language-of-parts finding on a shared logo is not copied to pages in another language', async () => {
  const { foldJudgeFails } = await imp('merge.mjs');
  const sel = 'a.site-header__logo > svg.logo';
  const collects = [
    { pageId: 'p1', images: [{ selector: sel, alt: 'Northwind home' }] },
    { pageId: 'p7', images: [{ selector: sel, alt: 'Northwind home' }] },
  ];
  const obs = (criterion) => ({ fp: `header|${sel}`, observations: [{ id: 'J-1', criterion_id: criterion, x: { source: 'judge', pageId: 'p7', selector: sel, html: 'Northwind home', suggestion: 'Accueil Northwind' } }] });
  const lang = foldJudgeFails([obs('3.1.2')], collects);
  assert.deepEqual(lang.flatMap((g) => g.observations.map((o) => o.x.pageId)), ['p7'], 'the English page keeps its correct English name');
  const alt = foldJudgeFails([obs('1.1.1')], collects);
  assert.deepEqual(alt.flatMap((g) => g.observations.map((o) => o.x.pageId)).sort(), ['p1', 'p7'], 'the same wrong alt is still wrong on every page');
});

test('red-team regressions: entries are rewritten when their screenshots change', async () => {
  const { isStale } = await imp('text.mjs');
  const issue = { key: 'K', status: 'fail', shots: [{}, {}] };
  assert.equal(isStale(issue, { K: { shots: [{}, {}] } }), false);
  assert.equal(isStale(issue, { K: { shots: [{}] } }), true);
  assert.equal(isStale(issue, {}), true);
  assert.equal(isStale({ ...issue, textStale: true }, { K: { shots: [{}, {}] } }), true);
});

test('red-team regressions: "does not apply" needs every page type to agree', () => {
  const { pages, templates, observations } = fixture();
  const na = (tid) => ({ ...signalToObservation({ source: 'judge', check: 'judge-1.2.2', sc: ['1.2.2'], status: 'not_applicable', templateId: tid, description: 'No video here.', evidence: ['signals.json'], steps: ['x'] }, 99, { level: 'AA' }) });
  const one = mergeObservations({ observations: [...observations, na('t01')], pages, templates, collects: [], level: 'AA', judgedTemplates: ['t01', 't02'] });
  assert.equal(one.criteriaStatus.find((c) => c.id === '1.2.2').status, 'not_tested');
  const both = mergeObservations({ observations: [...observations, na('t01'), na('t02')], pages, templates, collects: [], level: 'AA', judgedTemplates: ['t01', 't02'] });
  assert.equal(both.criteriaStatus.find((c) => c.id === '1.2.2').status, 'not_applicable');
});

test('frameIsThirdParty: a node inside a video or form-service frame is third-party, a same-site frame is not', async () => {
  const { frameIsThirdParty } = await import('../../skills/wcag-report/scripts/lib/signals.mjs');
  const yt = { src: 'https://video.example/embed/x', title: 'video', thirdParty: true };
  const blank = { src: '', title: '', thirdParty: false };
  const own = { src: 'https://shop.example.com/widget', title: 'Store finder', thirdParty: false };
  assert.equal(frameIsThirdParty(null, [yt]), false, 'not in a frame');
  assert.equal(frameIsThirdParty('iframe[width="560"]', [yt, blank]), true, 'only loaded frames count, and all are third-party');
  assert.equal(frameIsThirdParty('iframe[title="video"]', [yt, own]), true, 'matched by title');
  assert.equal(frameIsThirdParty('iframe[title="Store finder"]', [yt, own]), false);
  assert.equal(frameIsThirdParty('iframe:nth-child(2)', [yt, own]), false, 'mixed and unmatched: not claimed as third-party');
});
