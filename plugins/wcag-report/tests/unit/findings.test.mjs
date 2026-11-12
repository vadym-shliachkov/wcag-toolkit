import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/wcag-report/scripts/lib');
const imp = (m) => import(new URL(`file:///${path.join(LIB, m).replace(/\\/g, '/')}`).href);

const { harmonizeBySource, splitByFixKind, oneCardPerImage, oneCardPerCause, findImage, imageIndex } = await imp('merge.mjs');
const { placesOf, recommendationRows } = await imp('findings.mjs');
const { redactString } = await imp('collect.mjs');
const { writeXlsx } = await imp('xlsx.mjs');

const obs = (pageId, selector, suggestion, extra = {}) => ({
  id: `${pageId}-${selector}`, criterion_id: '1.1.1', x: { source: 'judge', check: 'judge-1.1.1', pageId, selector, suggestion, confidence: 'high', ...extra },
});

test('whether a picture needs words is decided before the wording', () => {
  const collects = ['p1', 'p2', 'p3'].map((pageId) => ({ pageId, images: [{ selector: 'main figure > img', src: 'https://x.test/shot.webp' }] }));
  const g = { observations: [obs('p1', 'figure > img', 'Homepage with the headline Hello'), obs('p2', 'figure > img', 'Homepage: headline Hello over a photo'), obs('p3', 'figure > img', '')] };
  harmonizeBySource([g], collects);
  // Two judges described it (in different words), one hid it: it is described, with the first page's wording.
  assert.deepEqual(g.observations.map((o) => o.x.suggestion), Array(3).fill('Homepage with the headline Hello'));
  assert.equal(g.observations[2].x.suggestionBasis, 'same_image');
});

test('hiding and describing are two problems; an unseen place takes the kind of its problem', () => {
  const g = { key: 'WR-aaaaaa', fp: 'main|figure > img', observations: [
    obs('p1', 'a', ''), obs('p2', 'b', ''), obs('p3', 'c', 'Beta homepage: the headline'), obs('p4', 'd', null, { propagated: true }),
  ] };
  const out = splitByFixKind([g]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].observations.map((o) => o.x.suggestion), ['', '', ''], 'the unseen photo is hidden like the others');
  assert.equal(out[0].observations[2].x.suggestionBasis, 'pattern');
  assert.deepEqual(out[1].observations.map((o) => o.x.pageId), ['p3']);
  assert.notEqual(out[1].key, g.key);
  assert.equal(out[0].key, g.key, 'the larger part keeps its key, so its text stays attached');
});

test('one picture file appears in one problem', () => {
  const a = { key: 'A', observations: [obs('p1', 'x', '', { src: 'neo.webp' }), obs('p2', 'x', '', { src: 'neo.webp' }), obs('p3', 'y', '', { src: 'other.webp' })] };
  const b = { key: 'B', observations: [obs('p4', 'x', '', { src: 'neo.webp' })] };
  const out = oneCardPerImage([a, b]);
  assert.deepEqual(out.map((g) => g.key), ['A']);
  assert.equal(a.observations.length, 4);
});

test('an image is found by page, alt and selector even when selectors repeat', () => {
  const index = imageIndex([{ pageId: 'p1', images: [
    { selector: 'section > a.card > div > img', alt: 'NEOGOV app screens', src: 'neo.webp' },
    { selector: 'section > a.card > div > img', alt: '', src: 'hirevue.webp' },
  ] }]);
  assert.equal(findImage(index, 'p1', 'a.card > div > img', 'NEOGOV app screens').src, 'neo.webp');
  assert.equal(findImage(index, 'p1', 'a.card:nth-of-type(2) > div > img', '').src, 'hirevue.webp');
});

test('where a problem is reads without an appendix', () => {
  const site = [...Array(18)].map((_, i) => `https://x.test/insights/post-${i}/`).concat(['https://x.test/', 'https://x.test/about/', 'https://x.test/examples/a/']);
  assert.deepEqual(placesOf(site.slice(0, 3), site).list.length, 3, 'a few pages are all listed');
  assert.equal(placesOf(site, site).every, true);
  const all = placesOf(site.slice(0, 18).concat('https://x.test/about/'), site);
  assert.deepEqual(all.groups, [{ section: '/insights/', n: 18, total: 18, all: true, examples: [] }]);
  assert.deepEqual(all.list, ['https://x.test/about/']);
  const some = placesOf(site.slice(0, 10), site);
  assert.equal(some.groups[0].all, false);
  assert.equal(some.groups[0].examples.length, 2);
  // Never "every page except": a page left out may not have been tested in depth.
  const flat = [...Array(19)].map((_, i) => `https://y.test/page-${i}/`);
  assert.equal(placesOf(flat.slice(0, 15), flat).except, undefined);
});

test('the same picture on three pages is one row with every text it has now', () => {
  const issue = { check: 'judge-1.1.1', instances: [
    { pageId: 'p1', url: 'https://x.test/a/', src: 'https://x.test/i/alpha.webp', current: 'Alpha project context', suggestion: '' },
    { pageId: 'p2', url: 'https://x.test/b/', src: 'https://x.test/i/alpha.webp', current: 'Alpha project context', suggestion: '' },
    { pageId: 'p3', url: 'https://x.test/c/', src: 'https://x.test/i/alpha.webp', current: 'Alpha studio with step machines', suggestion: '' },
    { pageId: 'p3', url: 'https://x.test/c/', src: 'https://x.test/i/beta.webp', current: 'Beta project context', suggestion: '' },
  ] };
  const rows = recommendationRows(issue, { thumbFor: () => null, run: { target: {} }, reviewedUrls: [] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].file, 'alpha.webp');
  assert.equal(rows[0].pages, 3);
  assert.deepEqual(rows[0].currents, ['Alpha project context', 'Alpha studio with step machines']);
});

test('readable slugs are not redacted as secrets; random tokens are', () => {
  assert.equal(redactString('/industries/telecommunications-communications/'), '/industries/telecommunications-communications/');
  assert.equal(redactString('california-closets-design-consultation-2024.webp'), 'california-closets-design-consultation-2024.webp');
  assert.equal(redactString('x a8f3b9c2d4e5f60718293a4b5c6d7e8f9a0b1c2d'), 'x [redacted]');
});

test('the workbook is a valid zip with one sheet per tab', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wr-xlsx-')), 'f.xlsx');
  writeXlsx(file, [
    { name: 'By page', columns: [{ title: 'Page' }, { title: 'Change to' }], rows: [{ cells: [{ v: '/a/', link: 'https://x.test/a/' }, 'alt=""'], style: 2 }, { level: 1, cells: ['/a/', '<b> & "q"'] }] },
    { name: 'Problems', filter: true, columns: [{ title: 'ID' }, { title: 'Pages' }], rows: [{ cells: ['I-01', 3] }] },
  ]);
  const buf = fs.readFileSync(file);
  const entries = {};
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n > 0; n--) {
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString();
    const local = buf.readUInt32LE(at + 42);
    const size = buf.readUInt32LE(at + 20);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries[name] = zlib.inflateRawSync(buf.subarray(start, start + size)).toString();
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  assert.ok(entries['xl/workbook.xml'].includes('name="By page"'));
  assert.ok(entries['xl/worksheets/sheet1.xml'].includes('&lt;b&gt; &amp; &quot;q&quot;'));
  assert.ok(entries['xl/worksheets/sheet1.xml'].includes('outlineLevel="1"'));
  assert.ok(entries['xl/worksheets/sheet1.xml'].includes('HYPERLINK'));
  assert.ok(entries['xl/worksheets/sheet2.xml'].includes('<v>3</v>'));
});

test('clean-up points found while measuring are grouped by kind with every place', async () => {
  const { pageToolNotes } = await imp('merge.mjs');
  const notes = pageToolNotes([
    { pageId: 'p1', url: 'https://x.test/', notes: [{ code: 'redundant_role', selector: 'ol.a', html: '<ol role="list">' }, { code: 'label_split_lines', selector: 'a.more', html: '<a>', detail: 'shown "Meet our team"' }] },
    { pageId: 'p2', url: 'https://x.test/b/', notes: [{ code: 'redundant_role', selector: 'ol.a', html: '<ol role="list">' }, { code: 'redundant_role', selector: 'ol.a', html: '<ol role="list">' }] },
  ]);
  const byCode = Object.fromEntries(notes.map((n) => [n.code, n]));
  assert.equal(byCode.redundant_role.count, 2, 'the same element on the same page is one place');
  assert.equal(byCode.label_split_lines.instances[0].detail, 'shown "Meet our team"');
});

test('report text never refers to other tools or reports', async () => {
  const { lintEntry } = await imp('lint-text.mjs');
  const entry = { key: 'x', title: 'Images have no description', observed: 'Other tools report this too, and PowerMapper lists it.', cause: 'The layout adds images without a description.' };
  assert.ok(lintEntry(entry).some((f) => f.rule === 'other-tools' && f.severity === 'error'));
});

test('text sized by the window is one issue with a row per text style, whatever ids the headings carry', async () => {
  const { componentFingerprint } = await imp('dedupe.mjs');
  const m = (fontPx, z) => ({ text: `t${fontPx}`, fontPx, pageZoom200: z, textZoom200: z });
  const a = componentFingerprint({ selector: 'main > #case-goop-title', check: 'text-zoom', measured: m(54.4, 1.51) });
  const b = componentFingerprint({ selector: 'main > #work-title', check: 'text-zoom', measured: m(35.2, 1.7) });
  assert.equal(a, b);
  const inst = (url, fontPx, z) => ({ url, measured: m(fontPx, z) });
  const rows = recommendationRows({ check: 'text-zoom', instances: [inst('https://x.test/a/', 54.4, 1.51), inst('https://x.test/b/', 54.4, 1.51), inst('https://x.test/c/', 35.2, 1.7)] }, { thumbFor: () => null, run: { options: {} }, reviewedUrls: [] });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].zoom, { fontPx: 54, grows: 151 });
  assert.equal(rows[0].pages, 2);
  assert.deepEqual(rows[1].currents, ['t35.2']);
});

test('pictures with one kind of change share one card, wherever they sit and whether or not a failure was named', () => {
  const obs = (id, sel, src, failure, suggestion) => ({ id, criterion_id: '1.1.1', x: { source: 'judge', selector: sel, src, failure, suggestion } });
  const g = (key, ...o) => ({ key, fp: key, observations: o });
  const out = oneCardPerCause([
    g('hero', obs('a', 'figure.hero > img', 'team.jpg', 'F39', '')),
    g('proof', obs('b', 'figure.proof > img', 'studio.jpg', 'F39', ''), obs('c', 'figure.proof > img', 'desk.jpg', 'F39', '')),
    g('shot', obs('d', 'div.window > img', 'site.png', 'F30', 'The delivered home page with a search bar')),
    g('wrap', { id: 'e', criterion_id: '1.1.1', x: { source: 'judge', selector: 'div[role=img]', failure: 'F39', suggestion: '' } }),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].observations.map((o) => o.id), ['a', 'b', 'c', 'e']);
  assert.equal(out[1].key, 'shot');
});

test('images sharing one selector are told apart by the judge position, never all taken as the first', () => {
  const sel = 'figure.mosaic > span.frame > img';
  const index = imageIndex([{ pageId: 'p1', images: ['Ann', 'Bob', 'Cy'].map((alt) => ({ selector: sel, alt, src: 'https://x.test/[redacted].webp' })) }]);
  assert.equal(findImage(index, 'p1', 'figure.mosaic > span.frame:nth-of-type(2) > img', null).alt, 'Bob');
  assert.equal(findImage(index, 'p1', sel, null), null);
  assert.equal(findImage(index, 'p1', sel, 'Cy').alt, 'Cy');
});

test('one automated check under one requirement is one card, with a row per element and the same element once', async () => {
  const { oneCardPerCheck } = await imp('merge.mjs');
  const { recommendationRows, elementKey } = await imp('findings.mjs');
  const obs = (id, sel, page, name) => ({ id, criterion_id: '2.4.7', status: 'fail', x: { source: 'deep', check: 'focus-visible', selector: sel, pageId: page, url: `https://s.test/${page}`, observed: `When "${name}" receives keyboard focus nothing about it changes on screen.` } });
  const groups = [
    { key: 'a', observations: [obs(1, '#about', 'p1', 'About'), obs(2, '#about', 'p2', 'About')] },
    { key: 'b', observations: [obs(3, 'li:nth-of-type(1) > a', 'p1', 'Home')] },
    { key: 'j', observations: [{ id: 4, criterion_id: '2.4.7', status: 'fail', x: { source: 'judge', check: 'judge-2.4.7' } }] },
  ];
  const out = oneCardPerCheck(groups);
  assert.equal(out.length, 2, 'the judge group stays apart');
  assert.equal(out[0].observations.length, 3);
  const issue = { status: 'fail', check: 'focus-visible', instances: out[0].observations.map((o) => o.x), rowThumbs: [{ key: elementKey(out[0].observations[0].x), file: 'shots/issues/a-row1.jpg', width: 300, height: 100 }] };
  // The menu item marked "active" on its own page is the same element.
  assert.equal(elementKey({ selector: 'li.nav-item.active:nth-of-type(1) > a', observed: '"Home"' }), elementKey({ selector: 'li.nav-item:nth-of-type(1) > a', observed: '"Home"' }));
  const rows = recommendationRows(issue, { thumbFor: () => null, run: { mode: 'url' }, reviewedUrls: ['https://s.test/p1', 'https://s.test/p2', 'https://s.test/p3'] });
  assert.deepEqual(rows.map((r) => [r.kind, r.current, r.pages]), [['element', 'About', 2], ['element', 'Home', 1]]);
  assert.equal(rows[0].thumb.file, 'shots/issues/a-row1.jpg');
});

test('a data: placeholder names no picture file', async () => {
  const { srcFile } = await imp('merge.mjs');
  assert.equal(srcFile("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"), null);
  assert.equal(srcFile('https://s.test/a/logo.svg?v=2'), 'logo.svg');
});

test('a form counts as sent only when a request carries its own fields', async () => {
  const { formWrites } = await imp('deep/common.mjs');
  const blocked = { log: [{ url: 'https://captcha.example/api2/reload', body: 'v=abc&reason=q' }, { url: 'https://s.test/api/form', body: 'contact%5Bfields%5D%5B1%5D=Test' }] };
  assert.equal(formWrites(blocked, 0, ['email']), 0);
  assert.equal(formWrites(blocked, 0, ['contact[fields][1]']), 1);
  assert.equal(formWrites(blocked, 1, ['contact[fields][1]']), 1);
  assert.equal(formWrites(blocked, 2, ['contact[fields][1]']), 0);
});

test('a picture in a link that has its own name gets alt="", whatever words a judge proposed', () => {
  const collects = [{ pageId: 'p1', images: [{ src: 'https://s.test/logo.svg', alt: 'footer logo', inLink: true, selector: 'footer > a.footer-logo > img' }], links: [{ selector: 'footer > a.footer-logo', name: 'Go to homepage', text: 'footer logo' }] }];
  const o = { id: 1, criterion_id: '1.1.1', status: 'fail', x: { source: 'judge', pageId: 'p1', selector: 'footer > a.footer-logo > img', current: 'footer logo', suggestion: 'youthink home' } };
  harmonizeBySource([{ observations: [o] }], collects);
  assert.equal(o.x.suggestion, '');
  assert.equal(o.x.suggestionReplaced, 'youthink home');
  // A link named by the picture itself keeps the judge's words.
  const c2 = [{ pageId: 'p1', images: [{ src: 'https://s.test/logo.svg', alt: 'youthink', inLink: true, selector: 'a.brand > img' }], links: [{ selector: 'a.brand', name: 'youthink' }] }];
  const o2 = { id: 2, criterion_id: '1.1.1', status: 'fail', x: { source: 'judge', pageId: 'p1', selector: 'a.brand > img', current: 'youthink', suggestion: 'youthink home' } };
  harmonizeBySource([{ observations: [o2] }], c2);
  assert.equal(o2.x.suggestion, 'youthink home');
});

test('a quote copied from the collected data shows its words, and fix steps never stand in for a replacement', async () => {
  const { plainQuote, recommendationRows } = await imp('findings.mjs');
  assert.equal(plainQuote('"text": "This is my archive"'), 'This is my archive');
  assert.equal(plainQuote('Jane Doe'), 'Jane Doe');
  const issue = { status: 'fail', check: 'judge-1.3.1', instances: [
    { url: 'https://s.test/a/', current: '"text": "Notice"', suggestion: 'Change the three h4.h6 elements to <p> elements' },
  ] };
  assert.deepEqual(recommendationRows(issue, { thumbFor: () => null, run: {}, reviewedUrls: [] }), []);
  const ok = { status: 'fail', check: 'judge-2.4.6', instances: [{ url: 'https://s.test/a/', current: '"text": "This is my archive"', suggestion: 'News archive' }] };
  const rows = recommendationRows(ok, { thumbFor: () => null, run: {}, reviewedUrls: [] });
  assert.equal(rows[0].current, 'This is my archive');
  assert.equal(rows[0].value, 'News archive');
});

test('an ARIA reference to a missing id is a clean-up point, not a failure', async () => {
  const { idrefOnly } = await imp('merge.mjs');
  assert.equal(idrefOnly({ x: { check: 'aria-valid-attr-value', measured: { failureSummary: 'Fix all of the following:\n  Invalid ARIA attribute value: aria-controls="navbarBog"' } } }), true);
  assert.equal(idrefOnly({ x: { check: 'aria-valid-attr-value', measured: { failureSummary: 'Invalid ARIA attribute value: aria-expanded="yes"' } } }), false);
  assert.equal(idrefOnly({ x: { check: 'aria-allowed-attr' } }), false);
});

test('findings.csv always carries the fix; the owner workbook shows it only with --fix', async () => {
  const { findingRows } = await imp('findings.mjs');
  const { changeText } = await imp('findings-xlsx.mjs');
  const { CSV_COLUMNS } = await imp('csv.mjs');
  for (const c of ['fix_steps', 'fix_dev_note', 'fix_done_when']) assert.ok(CSV_COLUMNS.includes(c), c);
  const issue = { id: 'I-01', key: 'K', status: 'fail', severity: 'serious', criteria: { primary: '1.4.11', related: [] }, check: 'focus-contrast', method: 'interactive', scope: 'site_wide', component: { landmark: 'footer', fingerprint: 'footer|a' }, templates: ['t01'], instances: [{ pageId: 'p1', url: 'https://x.test/', selector: 'footer a', html: '<a href="/">Our Story</a>', state: 'focus', observed: 'Outline 2.8:1.' }] };
  const entries = { K: { title: 'Faint focus outline', cause: 'Footer style.', fix: { steps: ['Use a lighter outline colour in the footer.'], dev_note: 'footer a:focus-visible: outline-color #b9c0ee (9.2:1 on #241b38).', done_when: 'Tab through the footer: the outline is clearly visible.' } } };
  const args = { issues: [issue], entries, crit: new Map([['1.4.11', { name: 'Non-text Contrast', level: 'AA' }]]), pages: [{ id: 'p1', title: 'Home', templateId: 't01' }], templates: [{ id: 't01', name: 'Home' }], run: { target: { url: 'https://x.test/' }, options: {} }, thumbFor: () => null };
  for (const fix of [false, true]) {
    const [r] = findingRows({ ...args, fix });
    assert.equal(r.fix_steps, 'Use a lighter outline colour in the footer.', `--fix ${fix}`);
    assert.match(r.fix_dev_note, /outline-color #b9c0ee/);
    assert.match(r.fix_done_when, /Tab through the footer/);
    const t = (k) => k;
    assert.equal(changeText(r, t, { fix }), fix ? r.fix_steps : '', 'the workbook is part of the report');
  }
});

test('focus hidden behind the same layer is one component, whichever links end up underneath', async () => {
  const { componentFingerprint } = await import('../../skills/wcag-report/scripts/lib/dedupe.mjs');
  const a = componentFingerprint({ selector: 'main > p > a.read-more', check: 'focus-obscured', measured: { coveredBy: 'header.main-header' } });
  const b = componentFingerprint({ selector: 'footer ul.icons > li > a', check: 'focus-obscured', measured: { coveredBy: 'header.main-header' } });
  const c = componentFingerprint({ selector: 'main > p > a.read-more', check: 'focus-obscured', measured: { coveredBy: '#chat-bar' } });
  assert.equal(a, b);
  assert.notEqual(a, c);
});
