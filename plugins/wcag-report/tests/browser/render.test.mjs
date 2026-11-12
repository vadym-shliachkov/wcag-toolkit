// Renders the sample reports (plain and --fix) and checks what the client receives: a tagged PDF with bookmarks,
// the right language and title, alt text on every figure, no axe-core violations in the report itself, and a size
// that can be e-mailed. Skipped when the runtime dependencies or a browser are missing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.resolve(here, '..', '..');
const lib = (m) => pathToFileURL(path.join(plugin, 'skills', 'wcag-report', 'scripts', 'lib', m)).href;
const FIX = path.join(plugin, 'tests', 'fixtures', 'report');
const OUT = path.join(plugin, 'tests', '.tmp', 'render-test');

const { depsStatus, pdfjs, axeSource } = await import(lib('deps.mjs'));
const { getBrowser, closeBrowser } = await import(lib('browser.mjs'));
const { renderReport } = await import(lib('render.mjs'));
const skip = depsStatus().ok ? false : 'runtime dependencies not installed (run wr setup)';

const VARIANTS = [
  { name: 'sample-report', lang: 'en', fix: false },
  { name: 'sample-report-fix', lang: 'en', fix: true },
];
const results = {};

before(async () => {
  if (skip) return;
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const v of VARIANTS) {
    const report = JSON.parse(fs.readFileSync(path.join(FIX, `${v.name}.json`), 'utf8'));
    results[v.name] = { report, ...(await renderReport(report, { outDir: OUT, baseDir: FIX, name: v.name })) };
  }
});

after(async () => { await closeBrowser(); });

async function openPdf(file) {
  const lib = await pdfjs();
  return lib.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true, verbosity: 0 }).promise;
}

function collectStruct(node, out = { roles: new Set(), figures: [] }) {
  if (!node) return out;
  if (node.role) out.roles.add(node.role);
  if (node.role === 'Figure') out.figures.push(node.alt ?? null);
  for (const c of node.children ?? []) collectStruct(c, out);
  return out;
}

for (const v of VARIANTS) {
  test(`${v.name}: PDF is tagged, titled, in ${v.lang}, with bookmarks for every section`, { skip }, async () => {
    const r = results[v.name];
    assert.ok(r.pdf && fs.existsSync(r.pdf), 'PDF written');
    assert.deepEqual(r.missingI18n, [], 'every UI string translated');
    assert.deepEqual(r.warnings, []);
    const doc = await openPdf(r.pdf);
    const { info } = await doc.getMetadata();
    assert.equal(info.Language, v.lang);
    assert.match(info.Title, /Northwind Outdoor/);
    const outline = await doc.getOutline();
    assert.ok(outline?.length, 'has an outline');
    const titles = [];
    const walk = (items) => { for (const i of items) { titles.push(i.title); walk(i.items ?? []); } };
    walk(outline);
    // Every issue and review item has its own bookmark.
    for (const i of r.report.issues) assert.ok(titles.some((t) => t.startsWith(i.id)), `bookmark for ${i.id}`);
    for (const i of r.report.review_items.filter((x) => x.if_confirmed.severity !== 'minor')) assert.ok(titles.some((t) => t.startsWith(i.id)), `bookmark for ${i.id}`);
    assert.ok(titles.length >= 25, `outline has ${titles.length} entries`);

    const struct = { roles: new Set(), figures: [] };
    for (let p = 1; p <= doc.numPages; p++) collectStruct(await (await doc.getPage(p)).getStructTree(), struct);
    for (const role of ['H1', 'H2', 'H3', 'H4', 'Table', 'TH', 'L', 'Figure']) assert.ok(struct.roles.has(role), `structure has ${role}`);
    assert.ok(struct.figures.length > 0, 'figures are tagged');
    const bare = struct.figures.filter((alt) => !alt || alt.trim().length <= 10);
    assert.equal(bare.length, 0, `${bare.length} of ${struct.figures.length} figures lack alt text`);
    assert.ok(r.sizeMB < 15, `PDF is ${r.sizeMB} MB`);
  });
}

test('fix blocks appear only with --fix', { skip }, () => {
  const plain = fs.readFileSync(results['sample-report'].html, 'utf8');
  const fix = fs.readFileSync(results['sample-report-fix'].html, 'utf8');
  assert.ok(!plain.includes('class="fix"'));
  assert.equal((fix.match(/class="fix"/g) ?? []).length, results['sample-report-fix'].report.issues.length);
});

test('the report HTML has no axe-core violations', { skip }, async () => {
  const { browser } = await getBrowser();
  for (const v of VARIANTS) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(results[v.name].html).href);
    await page.addScriptTag({ content: axeSource() });
    const res = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }));
    await page.close();
    const summary = res.violations.map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target}`);
    assert.deepEqual(summary, [], `${v.name}: ${summary.join('; ')}`);
  }
});
