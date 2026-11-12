import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scFromTags, axeTags, capByKind, skeleton, signal, passSignal, isLocal } from '../../skills/wcag-report/scripts/lib/deep/common.mjs';
import { cropRect, pickInstances, maskSelectors } from '../../skills/wcag-report/scripts/lib/shots.mjs';
import { CHECK_NAMES } from '../../skills/wcag-report/scripts/lib/deep/index.mjs';

test('axe tags map to WCAG criteria, two-digit numbers included, 4.1.1 dropped', () => {
  assert.deepEqual(scFromTags(['wcag2a', 'wcag111', 'wcag1410', 'wcag2411', 'wcag411', 'best-practice']), ['1.1.1', '1.4.10', '2.4.11']);
});

test('axe tags per level', () => {
  assert.equal(axeTags('A').includes('wcag2aa'), false);
  assert.ok(axeTags('AA').includes('wcag22aa'));
  assert.ok(axeTags('AAA').includes('wcag2aaa'));
});

test('capByKind keeps a few per repeated component', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ selector: `ul.nav > li:nth-of-type(${i + 1}) > a` })).concat([{ selector: '#search' }]);
  const out = capByKind(items, 2, 30);
  assert.equal(out.length, 3);
  assert.equal(skeleton('ul > li:nth-of-type(3) > a#x1'), 'ul > li > a#id');
});

test('signals follow the contract and passes carry no selector', () => {
  const s = signal({ pageId: 'p001', url: 'https://e.test/' }, { check: 'c', sc: ['2.1.2'], status: 'needs_review', description: 'd' });
  assert.equal(s.source, 'deep');
  assert.ok(s.question);
  assert.equal(s.trust, 'review');
  const p = passSignal({ pageId: 'p001', url: 'u' }, { check: 'c', sc: '2.4.7', description: 'd', expected: 'e', steps: ['s'] });
  assert.deepEqual(p.sc, ['2.4.7']);
  assert.equal(p.status, 'pass');
  assert.equal(p.selector, null);
});

test('local hosts are recognised (side-effect guard only relaxes for them)', () => {
  assert.equal(isLocal('http://127.0.0.1:4000/x'), true);
  assert.equal(isLocal('http://localhost/'), true);
  assert.equal(isLocal('https://example.com/'), false);
});

test('crop around a small element keeps context and stays inside the viewport', () => {
  const c = cropRect({ x: 1250, y: 10, w: 20, h: 20 }, 1280, 900);
  assert.ok(c.width >= 560 && c.height >= 200);
  assert.ok(c.x + c.width <= 1280 && c.x >= 0 && c.y >= 0);
  assert.ok(c.height <= c.width * 0.55 + 1);
});

test('crop of a tall element starts at its top', () => {
  const c = cropRect({ x: 100, y: 300, w: 400, h: 800 }, 1280, 900);
  assert.equal(c.continues, true);
  assert.equal(c.y, 268);
});

test('crop of an element wider than the crop starts at its left edge, where its text starts', () => {
  const c = cropRect({ x: 120, y: 300, w: 1100, h: 120 }, 1280, 900);
  assert.equal(c.width, 900);
  assert.equal(c.x, 88);
});

test('narrow crops use the full width', () => {
  const c = cropRect({ x: 10, y: 100, w: 100, h: 40 }, 320, 640);
  assert.equal(c.width, 320);
});

test('instances on different pages are preferred', () => {
  const issue = { instances: [{ pageId: 'p1', selector: 'a' }, { pageId: 'p1', selector: 'b' }, { pageId: 'p2', selector: 'a' }, { pageId: 'p3' }] };
  assert.deepEqual(pickInstances(issue).map((i) => i.pageId), ['p1', 'p2']);
});

test('masks cover passwords, cards, user selectors and all inputs when logged in', () => {
  assert.ok(maskSelectors({}).includes('input[type=password]'));
  const m = maskSelectors({ mask: ['.account-name'], auth: '/x.json' });
  assert.ok(m.includes('.account-name') && m.includes('textarea'));
});

test('all thirteen checks are registered, keyboard first', () => {
  assert.equal(CHECK_NAMES[0], 'keyboard');
  assert.equal(CHECK_NAMES.length, 13);
});
