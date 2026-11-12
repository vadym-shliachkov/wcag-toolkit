import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, framework, portArgs, installCommand } from '../../skills/wcag-report/scripts/lib/detect.mjs';
import { cluster, jaccard, shingles, classifyPage, buildTemplates } from '../../skills/wcag-report/scripts/lib/templates.mjs';
import { resolveFile } from '../../skills/wcag-report/scripts/lib/static-server.mjs';
import { redactString } from '../../skills/wcag-report/scripts/lib/collect.mjs';

const FIX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-detect-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

test('detect: the fixture repos', () => {
  assert.equal(detect(path.join(FIX, 'repo-static')).kind, 'static');
  const node = detect(path.join(FIX, 'repo-node'));
  assert.equal(node.kind, 'node');
  assert.equal(node.build, 'build');
  assert.equal(node.start, 'preview');
  assert.equal(node.install, null, 'a package without dependencies is never installed');
  assert.equal(detect(path.join(FIX, 'repo-broken')).kind, 'node');
});

test('detect: frameworks, package managers, dev-only projects, PHP', () => {
  const vite = tmpRepo({ 'package.json': { scripts: { dev: 'vite' }, devDependencies: { vite: '5' } }, 'pnpm-lock.yaml': '' });
  const v = detect(vite);
  assert.equal(v.framework, 'vite');
  assert.equal(v.pm, 'pnpm');
  assert.equal(v.start, 'dev');
  assert.deepEqual(v.install, ['pnpm', ['install', '--frozen-lockfile']]);
  const next = tmpRepo({ 'package.json': { scripts: { build: 'next build', start: 'next start' }, dependencies: { next: '15' } }, 'package-lock.json': '{}' });
  const n = detect(next);
  assert.equal(n.framework, 'next');
  assert.equal(n.start, 'start');
  assert.deepEqual(n.install, ['npm', ['ci', '--no-audit', '--no-fund']]);
  assert.equal(detect(tmpRepo({ 'wp-config.php': '<?php' })).kind, 'unsupported');
  assert.equal(detect(tmpRepo({ 'dist/index.html': '<h1>x</h1>' })).kind, 'static');
  assert.equal(detect(tmpRepo({ 'README.md': 'x' })).kind, 'unsupported');
});

test('detect: port flags per framework, and no install when node_modules exists', () => {
  assert.deepEqual(portArgs('next', 4000), ['-p', '4000', '-H', '127.0.0.1']);
  assert.ok(portArgs('vite', 4000).includes('--strictPort'));
  assert.deepEqual(portArgs(null, 4000), []);
  assert.equal(framework({ dependencies: { '@sveltejs/kit': '2', vite: '5' } }), 'sveltekit');
  const withModules = tmpRepo({ 'package.json': { dependencies: { a: '1' } }, 'node_modules/.keep': '' });
  assert.equal(installCommand(withModules, 'npm', { dependencies: { a: '1' } }), null);
});

test('static server: clean URLs, index files, SPA fallback, no path traversal', () => {
  const dir = tmpRepo({ 'index.html': 'i', 'about.html': 'a', 'blog/index.html': 'b', '404.html': 'nf' });
  assert.equal(path.basename(resolveFile(dir, '/about').file), 'about.html');
  assert.equal(resolveFile(dir, '/blog/').file, path.join(dir, 'blog', 'index.html'));
  assert.equal(resolveFile(dir, '/nope').status, 404);
  assert.equal(resolveFile(dir, '/nope', { spa: true }).file, path.join(dir, 'index.html'));
  const t = resolveFile(dir, '/../../etc/passwd');
  assert.ok(!t || !t.file || t.file.startsWith(dir));
});

test('templates: shingles and jaccard', () => {
  const a = shingles('0:div 1:h1 1:p 1:p 1:ul 2:li');
  assert.equal(jaccard(a, a), 1);
  assert.ok(jaccard(a, shingles('0:form 1:input 1:input 1:button 1:p')) < 0.2);
});

test('templates: similar skeletons cluster, same path shape clusters, different ones do not', () => {
  const article = '0:article 1:h1 1:p 1:img 1:p 1:div.wide 1:div.clip 1:h3 1:p 2:a';
  const form = '0:h1 0:form 1:p 2:input 1:p 2:input 1:p 2:textarea 1:div.fake-btn 0:p 1:a 0:div 1:button 0:iframe';
  const items = [
    { id: 'p1', fingerprint: article, shape: '/blog/a' },
    { id: 'p2', fingerprint: `${article} 1:p`, shape: '/blog/b' },
    { id: 'p3', fingerprint: form, shape: '/contact' },
    { id: 'p4', fingerprint: '0:h1 0:p', shape: '/events/:n/:n/:n' },
    { id: 'p5', fingerprint: '0:h1 0:p 0:p 0:ul 1:li 0:table', shape: '/events/:n/:n/:n' },
  ];
  const groups = cluster(items).map((g) => g.sort().join(','));
  assert.ok(groups.includes('p1,p2'));
  assert.ok(groups.includes('p3'));
  assert.ok(groups.includes('p4,p5'), 'same id-bearing path shape is one page type');
});

test('templates: page kinds and the start page as its own template', () => {
  const pg = (id, url, depth = 1) => ({ id, url, finalUrl: url, depth, status: 200, shape: new URL(url).pathname });
  assert.equal(classifyPage(pg('a', 'https://a.test/', 0)), 'home');
  assert.equal(classifyPage(pg('a', 'https://a.test/blog/my-post')), 'article');
  assert.equal(classifyPage(pg('a', 'https://a.test/blog/')), 'listing');
  assert.equal(classifyPage(pg('a', 'https://a.test/cart')), 'cart');
  assert.equal(classifyPage(pg('a', 'https://a.test/x'), { forms: [{ purpose: 'contact' }] }), 'form');
  const pages = [pg('p1', 'https://a.test/', 0), pg('p2', 'https://a.test/blog/a'), pg('p3', 'https://a.test/blog/b')];
  const same = '0:main 1:h1 1:p 1:p 1:p 1:ul 2:li';
  const collects = new Map(pages.map((p) => [p.id, { fingerprint: same, textSample: 'x' }]));
  const { templates, assignment } = buildTemplates(pages, collects, { maxTemplates: 1 });
  assert.equal(templates[0].kind, 'home');
  assert.deepEqual(templates[0].pageIds, ['p1']);
  assert.equal(assignment.get('p2'), assignment.get('p3'));
  assert.equal(templates.filter((t) => t.deep).length, 1);
  assert.ok(templates.find((t) => !t.deep).skippedReason);
});

test('redaction: secrets always, personal data when asked', () => {
  assert.equal(redactString('https://a.test/x?token=abc123&b=1'), 'https://a.test/x?token=[redacted]&b=1');
  assert.equal(redactString('write to anna@example.com'), 'write to anna@example.com');
  assert.equal(redactString('write to anna@example.com', { personal: true }), 'write to [email]');
  assert.equal(redactString('call +49 30 1234 5678', { personal: true }), 'call [phone]');
  assert.equal(redactString('in 2026 we sold 300 plants', { personal: true }), 'in 2026 we sold 300 plants');
});
