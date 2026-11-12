import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wordCount } from '../../skills/wcag-report/scripts/lib/lint-text.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(here, '..', '..', 'skills', 'wcag-report');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(SKILL, rel), 'utf8'));

const kb = read('kb/data/criteria.json').filter((c) => c.id !== '4.1.1');
const ids = kb.map((c) => c.id);
const groups = read('references/groups.json');
const GROUP_IDS = new Set(groups.order);
const axeMap = read('references/axe-map.json');
const coverage = read('references/coverage.json');
const DEEP = new Set(['keyboard', 'focus-visible', 'focus-obscured', 'reflow', 'resize-text', 'text-spacing', 'hover-content', 'orientation', 'motion', 'target-size', 'forms', 'states', 'interaction', 'measure']);

test('86 criteria, no 4.1.1', () => {
  assert.equal(ids.length, 86);
  for (const f of ['criteria-plain.en.json', 'coverage.json']) {
    const data = read(`references/${f}`);
    assert.ok(!('4.1.1' in data), `${f} has 4.1.1`);
    assert.deepEqual(Object.keys(data).sort(), [...ids].sort(), `${f} keys`);
  }
});

test('plain-language entries', () => {
  const en = read('references/criteria-plain.en.json');
  for (const id of ids) {
    const e = en[id];
    assert.ok(e.plain && wordCount(e.plain) <= 22, `${id} plain: ${wordCount(e.plain)} words`);
    assert.ok(e.question && wordCount(e.question) <= 8, `${id} question: ${wordCount(e.question)} words`);
    assert.ok(e.groups.length >= 1 && e.groups.every((g) => GROUP_IDS.has(g)), `${id} groups`);
  }
  // Accuracy pitfalls from the language plan.
  assert.ok(!en['2.4.7'].groups.includes('screen_reader'), '2.4.7 does not affect screen reader users');
  assert.ok(!en['1.4.10'].groups.includes('screen_reader'), '1.4.10 does not affect screen reader users');
  assert.equal(en['1.4.3'].groups[0], 'low_vision');
  assert.equal(en['1.4.1'].groups[0], 'colour');
  assert.equal(en['2.3.1'].groups[0], 'seizure_motion');
});

test('groups file', () => {
  assert.equal(groups.order.length, 8);
  assert.deepEqual(Object.keys(groups).sort(), ['en', 'order', 'tools']);
  assert.deepEqual(Object.keys(groups.tools), ['en']);
  assert.deepEqual(groups.en.map((g) => g.id), groups.order);
  for (const g of groups.en) {
    assert.ok(g.label && g.short && g.description && g.icon);
    for (const t of g.tools) assert.ok(groups.tools.en[t], `tool ${t}`);
  }
});

test('axe map covers every installed rule', async () => {
  let rules;
  try {
    const { axeSource } = await import('../../skills/wcag-report/scripts/lib/deps.mjs');
    const src = axeSource();
    const version = /axe v?([\d.]+)/.exec(src)?.[1];
    assert.equal(axeMap.axeVersion, version, 'axe-map.json was generated for another axe-core version: run tools/gen-axe-map.mjs');
    rules = [...src.matchAll(/\{id:"([a-z0-9-]+)",(?:impact|selector|excludeHidden|matches|tags)/g)].map((m) => m[1]);
  } catch (e) {
    if (/not installed/.test(e.message)) return; // runtime deps absent: the generator test covers it where they exist
    throw e;
  }
  for (const r of new Set(rules)) assert.ok(axeMap.rules[r], `axe rule ${r} missing from axe-map.json`);
});

test('axe map entries are sound', () => {
  for (const [id, r] of Object.entries(axeMap.rules)) {
    assert.ok(['confirmed', 'review'].includes(r.trust), id);
    assert.ok(['blocker', 'major', 'minor'].includes(r.barrier), id);
    assert.ok(!r.sc.includes('4.1.1'), `${id} maps to 4.1.1`);
    for (const sc of r.sc) assert.ok(ids.includes(sc), `${id} → unknown ${sc}`);
    if (r.bestPractice) assert.deepEqual(r.sc, [], `${id}: best practice must not map to a criterion`);
    if (r.bestPractice) assert.equal(r.trust, 'review', id);
  }
  // Disputed-advice traps never become confirmed failures on their own.
  for (const trap of ['heading-order', 'page-has-heading-one', 'region', 'landmark-one-main', 'tabindex', 'duplicate-id', 'duplicate-id-active', 'image-redundant-alt', 'bypass', 'skip-link']) {
    const r = axeMap.rules[trap];
    if (!r) continue;
    assert.ok(r.bestPractice || r.trust === 'review', `${trap} must not be a confirmed failure`);
  }
  assert.equal(axeMap.rules['color-contrast'].trust, 'confirmed');
  assert.deepEqual(axeMap.rules['target-size'].sc, ['2.5.8']);
});

test('coverage entries', () => {
  for (const id of ids) {
    const c = coverage[id];
    assert.ok(['deep', 'judge', 'deep+judge', 'site', 'none'].includes(c.passCapable), `${id} passCapable`);
    assert.ok(c.notTestedReason && /\.$/.test(c.notTestedReason), `${id} notTestedReason`);
    assert.ok(wordCount(c.notTestedReason) <= 15, `${id} notTestedReason: ${wordCount(c.notTestedReason)} words`);
    assert.ok(c.applicability, `${id} applicability`);
    for (const d of c.deep) assert.ok(DEEP.has(d), `${id} unknown deep check ${d}`);
    for (const a of c.automated) assert.ok(axeMap.rules[a] && !axeMap.rules[a].bestPractice, `${id} automated ${a}`);
    if (c.passCapable.includes('judge')) assert.ok(c.judge, `${id} is judge-pass-capable but has no judge topic`);
    if (c.passCapable.includes('deep')) assert.ok(c.deep.length, `${id} is deep-pass-capable but has no deep check`);
  }
});

test('lint lists and glossaries parse and compile', async () => {
  const { rulesFor } = await import('../../skills/wcag-report/scripts/lib/lint-text.mjs');
  assert.ok(rulesFor('en').rules.length > 5);
  const g = read('references/glossary.en.json');
  for (const t of g.terms) {
    assert.ok(t.term && t.match.length && t.meaning, t.term);
    assert.ok(wordCount(t.meaning) <= 30, `glossary ${t.term}: ${wordCount(t.meaning)} words`);
  }
  // English only: one bundled locale, and no other-language reference files.
  assert.deepEqual(fs.readdirSync(path.join(SKILL, 'references', 'i18n')), ['en.json']);
  for (const f of fs.readdirSync(path.join(SKILL, 'references'))) {
    if (/\.[a-z]{2}\.json$/.test(f)) assert.match(f, /\.en\.json$/, `${f}: only English reference files are bundled`);
  }
  const card = fs.readFileSync(path.join(SKILL, 'references', 'style-card.md'), 'utf8');
  assert.ok(card.split('\n').length <= 80, 'style card over 80 lines');
});
