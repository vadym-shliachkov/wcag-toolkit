// Pure checks of the renderer: strings, escaping, the sample's agreement with its schema essentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.resolve(here, '..', '..');
const skill = path.join(plugin, 'skills', 'wcag-report');
const lib = (m) => pathToFileURL(path.join(skill, 'scripts', 'lib', m)).href;
const { loadStrings, englishKeys, bundledLanguages } = await import(lib('i18n.mjs'));
const { buildReportHtml, esc, cssString, usesNonLatinFont } = await import(lib('report-html.mjs'));

const read = (f) => fs.readFileSync(f, 'utf8');
const sample = JSON.parse(read(path.join(plugin, 'tests', 'fixtures', 'report', 'sample-report.json')));

function build(report, draft = false) {
  return buildReportHtml({
    report,
    strings: loadStrings(report.report.language),
    baseDir: path.join(plugin, 'tests', 'fixtures', 'report'),
    templateHtml: read(path.join(skill, 'templates', 'report.html')),
    css: read(path.join(skill, 'templates', 'report.css')),
    fontsCss: read(path.join(skill, 'templates', 'fonts.css')),
    fontsDir: path.join(skill, 'templates', 'fonts'),
    draft,
  });
}

test('counted phrases use plural forms, and lists of strings are filled in', () => {
  const en = loadStrings('en');
  assert.equal(en.tn('verdict.journeys', 1), '1 key task');
  assert.equal(en.tn('verdict.journeys', 3), '3 key tasks');
  assert.match(en.t('method_section.steps', { deep: 15, types: 43 })[2], /43 page types .* each of 15 types:/);
});

test('every bundled language has every English UI string, with the same placeholders', () => {
  assert.deepEqual(bundledLanguages(), ['en'], 'the report is English only');
  const keys = englishKeys();
  for (const lang of bundledLanguages()) {
    const { missing, t } = loadStrings(lang);
    assert.deepEqual(missing, [], `${lang} misses ${missing.join(', ')}`);
    const en = loadStrings('en').t;
    for (const k of keys) {
      const a = en(k);
      const b = t(k);
      if (typeof a !== 'string') continue;
      const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      assert.equal(ph(b), ph(a), `${lang}:${k} placeholders`);
    }
  }
});

test('unknown languages fall back to English and report the gap', () => {
  const s = loadStrings('xx');
  assert.ok(s.missing.length > 50);
  assert.equal(s.t('issues.whats_wrong'), "What's wrong");
});

test('escaping covers HTML and CSS strings', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(cssString('a"b\\c'), '"a\\"b\\\\c"');
});

test('text mostly in a non-Latin script (e.g. quoted site labels) switches the text font', () => {
  assert.equal(usesNonLatinFont('Plain English text about the site. '.repeat(10)), false);
  assert.equal(usesNonLatinFont('\u041F\u0440\u0438\u0432\u0435\u0442 \u043C\u0438\u0440 '.repeat(20)), true);
  assert.equal(usesNonLatinFont('Short'), false);
});

test('site content cannot inject markup into the report', () => {
  const evil = structuredClone(sample);
  evil.issues[0].title = '<script>alert(1)</script>';
  evil.issues[0].evidence = { kind: 'contrast', fg: 'red;background:url(x)', bg: '#fff', ratio: 2, required: 4.5 };
  const html = build(evil);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/(style|fill)="[^"]*url(x)/.test(html), 'unsafe colours never reach a style or fill attribute');
});

test('the sample keeps the cross-checks report-data must guarantee', () => {
  const ids = new Set(sample.issues.map((i) => i.id));
  const rids = new Set(sample.review_items.map((r) => r.id));
  const sev = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const i of sample.issues) sev[i.severity] += 1;
  for (const k of Object.keys(sev)) assert.equal(sample.totals.issues[k], sev[k], `count ${k}`);
  for (const c of sample.criteria) for (const id of c.issue_ids) assert.ok(ids.has(id), `${c.id} → ${id}`);
  for (const id of sample.priorities.issue_ids) assert.ok(ids.has(id));
  for (const id of sample.priorities.check_soon) assert.ok(rids.has(id));
  for (const i of sample.issues) {
    const crit = sample.criteria.find((c) => c.id === i.criteria.primary.id);
    assert.equal(crit.status, 'fail', `${i.id} primary criterion is a fail`);
    assert.ok(i.where.pages_confirmed <= (i.where.pages_likely ?? i.where.pages_confirmed));
    assert.equal(i.fix, null, 'no fix text without --fix');
  }
});

test('the HTML is in the report language, titled, and never stamped as a draft', () => {
  const html = build(sample);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Accessibility review of Northwind Outdoor<\/title>/);
  assert.ok(!html.includes('class="draft-banner"'));
  assert.ok(!build(sample, true).includes('not for distribution'), 'a draft has no stamp inside the document');
  assert.ok(!/localhost|127\.0\.0\.1/.test(html));
});
