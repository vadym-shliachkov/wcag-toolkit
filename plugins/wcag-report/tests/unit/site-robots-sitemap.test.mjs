import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseRobots, robotsAllows } from '../../skills/wcag-report/scripts/lib/robots.mjs';
import { parseSitemap, bodyText, collectSitemapUrls } from '../../skills/wcag-report/scripts/lib/sitemap.mjs';

const ROBOTS = `
# comment
User-agent: ExampleBot
Disallow: /

User-agent: *
Disallow: /private/
Disallow: /*.json$
Allow: /private/public-note
Sitemap: https://a.test/sitemap_index.xml

User-agent: wcag-report
User-agent: other
Disallow: /drafts
`;

test('robots: our own group wins over *', () => {
  const r = parseRobots(ROBOTS);
  assert.deepEqual(r.sitemaps, ['https://a.test/sitemap_index.xml']);
  assert.ok(!robotsAllows(r, 'https://a.test/drafts/x'));
  // Our group does not mention /private/, so it is allowed for us.
  assert.ok(robotsAllows(r, 'https://a.test/private/x'));
});

test('robots: longest rule wins, Allow wins ties, wildcards and $ anchors work', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public-note\nDisallow: /*.json$\nDisallow:\n');
  assert.ok(!robotsAllows(r, 'https://a.test/private/x'));
  assert.ok(robotsAllows(r, 'https://a.test/private/public-note'));
  assert.ok(!robotsAllows(r, 'https://a.test/data/x.json'));
  assert.ok(robotsAllows(r, 'https://a.test/data/x.json?v=2'));
  assert.ok(robotsAllows(r, 'https://a.test/'));
});

test('robots: no file or no matching group allows everything', () => {
  assert.ok(robotsAllows(null, 'https://a.test/x'));
  assert.ok(robotsAllows(parseRobots('User-agent: OtherBot\nDisallow: /\n'), 'https://a.test/x'));
});

test('sitemap: urlset and sitemapindex, CDATA and entities', () => {
  const set = parseSitemap('<urlset><url><loc>https://a.test/?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://a.test/x]]></loc></url></urlset>');
  assert.deepEqual(set.urls, ['https://a.test/?a=1&b=2', 'https://a.test/x']);
  const idx = parseSitemap('<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap></sitemapindex>');
  assert.deepEqual(idx.sitemaps, ['https://a.test/s1.xml']);
  assert.deepEqual(idx.urls, []);
});

test('sitemap: gzipped bodies are decoded', () => {
  const xml = '<urlset><url><loc>https://a.test/z</loc></url></urlset>';
  assert.equal(bodyText(gzipSync(xml), 'application/x-gzip', 'https://a.test/s.xml.gz'), xml);
  assert.equal(bodyText(Buffer.from(xml)), xml);
});

test('sitemap: index is followed once, loops and missing files are harmless', async () => {
  const files = {
    'https://a.test/index.xml': '<sitemapindex><sitemap><loc>https://a.test/s1.xml</loc></sitemap><sitemap><loc>https://a.test/index.xml</loc></sitemap><sitemap><loc>https://a.test/missing.xml</loc></sitemap></sitemapindex>',
    'https://a.test/s1.xml': '<urlset><url><loc>https://a.test/1</loc></url><url><loc>https://a.test/2</loc></url></urlset>',
  };
  const r = await collectSitemapUrls(['https://a.test/index.xml'], async (u) => files[u] ?? null);
  assert.deepEqual(r.urls, ['https://a.test/1', 'https://a.test/2']);
});
