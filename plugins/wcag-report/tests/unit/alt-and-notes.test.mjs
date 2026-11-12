import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/wcag-report/scripts/lib');
const imp = (m) => import(new URL(`file:///${path.join(LIB, m).replace(/\\/g, '/')}`).href);

const { altSuggestionProblems } = await imp('judge.mjs');
const { harmonizeBySource, toolNotes, dropSettled } = await imp('merge.mjs');

test('a recommended alt is short, starts with what it shows and does not repeat the caption', () => {
  const shots = { images: { p001: [{ selector: 'figure > img', caption: 'Recording studio shown as industry context.' }] } };
  const base = { sc: '1.1.1', status: 'fail', pageId: 'p001', selector: 'figure > img' };
  assert.deepEqual(altSuggestionProblems({ ...base, suggestion: '' }, shots), [], 'decorative is always fine');
  assert.deepEqual(altSuggestionProblems({ ...base, suggestion: 'Mixing desk in a dim room' }, shots), []);
  assert.match(altSuggestionProblems({ ...base, suggestion: 'Photo of a mixing desk' }, shots)[0], /image of/);
  assert.match(altSuggestionProblems({ ...base, suggestion: 'x'.repeat(151) }, shots)[0], /151 characters/);
  assert.match(altSuggestionProblems({ ...base, suggestion: 'Recording studio shown as industry context, with a desk' }, shots)[0], /repeats the visible caption/);
});

const judgeObs = (pageId, selector, suggestion, confidence = 'high', extra = {}) => ({
  criterion_id: '1.1.1', x: { source: 'judge', pageId, selector, suggestion, confidence, ...extra },
});

test('one picture file gets one recommendation on every page', () => {
  const collects = [
    { pageId: 'p1', images: [{ selector: 'main figure > img', src: 'https://x.test/a/studio.webp?v=2' }] },
    { pageId: 'p2', images: [{ selector: 'main figure > img', src: 'https://x.test/a/studio.webp' }] },
    { pageId: 'p3', images: [{ selector: 'main figure > img', src: 'https://x.test/a/studio.webp' }] },
    { pageId: 'p4', images: [{ selector: 'main figure > img', src: 'https://x.test/a/studio.webp' }] },
  ];
  const g = { observations: [
    judgeObs('p1', 'figure > img', 'Studio with pink lighting'),
    judgeObs('p2', 'figure > img', ''),
    judgeObs('p3', 'figure > img', ''),
    judgeObs('p4', 'figure > img', null, 'high', { propagated: true }),
  ] };
  harmonizeBySource([g], collects);
  assert.deepEqual(g.observations.map((o) => o.x.suggestion), ['', '', '', '']);
  assert.equal(g.observations[0].x.suggestionReplaced, 'Studio with pink lighting');
  assert.equal(g.observations[3].x.suggestionReplaced, undefined, 'a propagated image only receives the recommendation');
});

test('a contrast failure found with the pointer over it or keyboard focus on it is not withdrawn by a measurement at rest', () => {
  // The page at rest measured the label and found it fine; under the pointer its card turns lavender.
  const rest = { status: 'pass', scope: { state: 'default' }, x: { source: 'deep', check: 'contrast-measured', pageId: 'p1', measured: { settled: { targets: [], overturned: ['#card > .label'] } } } };
  const fail = (state) => ({ status: 'fail', scope: { state }, x: { source: 'deep', check: 'color-contrast', pageId: 'p1', selector: '#card > .label', measured: {} } });
  const kept = dropSettled([rest, fail('default'), fail('w320'), fail('hover'), fail('keyboard-focus')]).filter((o) => o.status === 'fail');
  assert.deepEqual(kept.map((o) => o.scope.state), ['hover', 'keyboard-focus'], 'at rest and at 320 px the colours are the same, so those are withdrawn');
});

test('an ARIA name on a plain container is a tool note, not an item to check', () => {
  const o = (html, url = 'https://x.test/') => ({ status: 'needs_review', scope: { url }, x: { source: 'axe', check: 'aria-prohibited-attr', pageId: 'p1', selector: 'div', html } });
  const list = [o('<div class="logos" aria-label="Clients">'), o('<div class="logos" aria-label="Clients">'), o('<a href="/x" aria-label="X">', 'https://x.test/b')];
  assert.equal(dropSettled(list).length, 1, 'the interactive one stays for a decision');
  const notes = toolNotes(list);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].code, 'aria_name_on_generic');
  assert.equal(notes[0].count, 1, 'the same element on the same page is counted once');
});
