import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, pageKey, sameSite, urlKind, isLogout, pathShape, variantKey, globToRegExp, makePathFilter, displayUrl, isLocalHost, sectionPrefixes, pickFair, markServed } from '../../skills/wcag-report/scripts/lib/urls.mjs';

test('normalize strips tracking params, default ports and plain anchors, and sorts params', () => {
  assert.equal(normalize('HTTPS://Example.com:443/a//b?utm_source=x&b=2&a=1&gclid=9#top'), 'https://example.com/a/b?a=1&b=2');
  assert.equal(normalize('/x?fbclid=1', { base: 'http://example.com/' }), 'http://example.com/x');
  assert.equal(normalize('mailto:a@b.c'), null);
  assert.equal(normalize('javascript:void(0)'), null);
});

test('normalize keeps hash routes only when the site uses them', () => {
  assert.equal(normalize('https://a.test/#/about'), 'https://a.test/');
  assert.equal(normalize('https://a.test/#/about', { hashRoutes: true }), 'https://a.test/#/about');
  assert.equal(normalize('https://a.test/#section', { hashRoutes: true }), 'https://a.test/');
});

test('sameSite ignores www and scheme, but not ports on local hosts', () => {
  assert.ok(sameSite('https://www.a.test/x', 'http://a.test/'));
  assert.ok(!sameSite('https://b.test/', 'https://a.test/'));
  assert.ok(!sameSite('https://shop.a.test/', 'https://a.test/'));
  assert.ok(sameSite('http://127.0.0.1:4000/a', 'http://127.0.0.1:4000/'));
  assert.ok(!sameSite('http://127.0.0.1:5000/a', 'http://127.0.0.1:4000/'));
});

test('pageKey: the bare and the www address are one page, other paths and local ports are not', () => {
  assert.equal(pageKey('https://example.com/'), pageKey('https://www.example.com/'));
  assert.equal(pageKey('http://a.test/x?b=1'), pageKey('https://www.a.test/x?b=1'));
  assert.notEqual(pageKey('https://a.test/x'), pageKey('https://a.test/y'));
  assert.notEqual(pageKey('http://localhost:4000/'), pageKey('http://localhost:5000/'));
});

test('urlKind tells pages, documents and assets apart', () => {
  assert.equal(urlKind('https://a.test/about'), 'page');
  assert.equal(urlKind('https://a.test/brochure.PDF'), 'document');
  assert.equal(urlKind('https://a.test/img/x.webp'), 'asset');
  assert.equal(urlKind('https://a.test/page.html'), 'page');
});

test('logout links are recognised in several languages', () => {
  assert.ok(isLogout('https://a.test/logout'));
  assert.ok(isLogout('https://a.test/user/sign-out?x=1'));
  assert.ok(isLogout('https://a.test/x', 'Abmelden'));
  assert.ok(!isLogout('https://a.test/blog/login-tips-for-gardeners-2'.replace('login', 'logbook')));
});

test('pathShape collapses ids, dates and uuids', () => {
  assert.equal(pathShape('https://a.test/events/2026/11/03'), '/events/:n/:n/:n');
  assert.equal(pathShape('https://a.test/p/9f1c2b3a-1111-2222-3333-444455556666'), '/p/:uuid');
  assert.equal(pathShape('https://a.test/day/2026-11-03'), '/day/:date');
  assert.equal(pathShape('https://a.test/Blog/Post-123'), '/blog/:id');
});

test('variantKey groups pages that differ only in query values', () => {
  assert.equal(variantKey('https://a.test/blog/?page=2'), variantKey('https://a.test/blog/?page=3'));
  assert.notEqual(variantKey('https://a.test/blog/?page=2'), variantKey('https://a.test/blog/?tag=x'));
});

test('path globs: * within a segment, ** across segments, bare patterns match anywhere', () => {
  assert.ok(globToRegExp('/blog/*').test('/blog/post'));
  assert.ok(!globToRegExp('/blog/*').test('/blog/a/b'));
  assert.ok(globToRegExp('/blog/**').test('/blog/a/b'));
  assert.ok(globToRegExp('admin').test('/x/admin'));
  const filter = makePathFilter(['/shop/**'], ['/shop/cart']);
  assert.equal(filter('https://a.test/shop/item'), null);
  assert.equal(filter('https://a.test/shop/cart'), 'excluded');
  assert.equal(filter('https://a.test/about'), 'excluded');
});

test('displayUrl never shows a local server address', () => {
  assert.equal(displayUrl('http://127.0.0.1:5173/about?x=1'), '/about?x=1');
  assert.equal(displayUrl('https://a.test/about'), 'https://a.test/about');
  assert.ok(isLocalHost('localhost') && isLocalHost('127.0.0.1') && !isLocalHost('a.test'));
});

test('pickFair shares the page limit between site sections instead of taking the sitemap in file order', () => {
  // Sitemap order: hundreds of colour-scheme pages first, the rest of the site after them.
  const queue = [{ url: 'https://a.test/', depth: 0 }];
  for (let i = 0; i < 300; i++) queue.push({ url: `https://a.test/colors/color-ark-pro/community-${'abc'[i % 3]}${i}/scheme/`, depth: 1 });
  for (let i = 0; i < 50; i++) queue.push({ url: `https://a.test/colors/browser/color-${i}/`, depth: 1 });
  queue.push({ url: 'https://a.test/about/', depth: 1 }, { url: 'https://a.test/products/', depth: 1 }, { url: 'https://a.test/products/paint/', depth: 2 });
  const served = {};
  const taken = [];
  while (taken.length < 10) {
    const [q] = queue.splice(pickFair(queue, served), 1);
    markServed(served, q.url);
    taken.push(new URL(q.url).pathname);
  }
  assert.equal(taken[0], '/');
  for (const p of ['/about/', '/products/', '/products/paint/']) assert.ok(taken.includes(p), p);
  assert.ok(taken.some((p) => p.startsWith('/colors/browser/')));
  assert.ok(taken.some((p) => p.startsWith('/colors/color-ark-pro/')));
  assert.ok(taken.filter((p) => p.startsWith('/colors/')).length <= 6);
  assert.ok(taken.indexOf('/products/') < taken.indexOf('/products/paint/'), 'a section page comes before its sub-pages');
  assert.deepEqual(sectionPrefixes('https://a.test/Colors/browser/red/'), ['/colors', '/colors/browser', '/colors/browser/red']);
});

test('deep consent config reads selectors and button words from their own keys', async () => {
  const { consentFromFile } = await import('../../skills/wcag-report/scripts/lib/deep/common.mjs');
  const fs = await import('node:fs');
  const file = new URL('../../skills/wcag-report/references/consent.json', import.meta.url);
  const c = consentFromFile(JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.ok(c.reject.includes('decline') && c.accept.includes('accept'), 'button words come from rejectTexts/acceptTexts');
  assert.ok(!c.reject.some((w) => w.startsWith('#')), 'no selector is used as a button word');
  assert.ok(c.selectors.indexOf('#hs-eu-decline-button') > -1 && c.selectors.indexOf('#hs-eu-decline-button') < c.selectors.indexOf('#hs-eu-confirmation-button'), 'reject selectors before accept selectors');
});

test('a page the site refuses is recorded once per step and recognised as a refusal, not a network loss', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { noteRefused, isRefusal, isNetworkError } = await import('../../skills/wcag-report/scripts/lib/deep/common.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-refused-'));
  const msg = 'Could not load https://a.test/colors/: HTTP 403: the site refused the request (rate limit or bot protection)';
  assert.ok(isRefusal(msg) && isNetworkError(msg));
  assert.ok(!isRefusal('Could not load https://a.test/: page.goto: net::ERR_INTERNET_DISCONNECTED'));
  noteRefused(dir, { templateId: 't02', pageId: 'p010', url: 'https://a.test/colors/', step: 'deep' });
  noteRefused(dir, { templateId: 't02', pageId: 'p010', url: 'https://a.test/colors/', step: 'deep' });
  noteRefused(dir, { templateId: 't02', pageId: 'p010', url: 'https://a.test/colors/', step: 'measure' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'refused.json'), 'utf8')).length, 2);
});
