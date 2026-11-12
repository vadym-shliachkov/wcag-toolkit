// doctor, setup, init, latest, status.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../lib/io.mjs';
import { createRun, workDir, runPaths, SKILL_DIR } from '../lib/paths.mjs';
import { bundledLanguages } from '../lib/i18n.mjs';
import { depsStatus, setup as installDeps } from '../lib/deps.mjs';
import { launchBrowser, readHttpAuth } from '../lib/browser.mjs';
import { loadRun, rootOf } from '../lib/run.mjs';
import { profileCriteria, kbVersion } from '../lib/criteria.mjs';
import { setLogDir, log } from '../lib/log.mjs';

export const options = {
  url: { type: 'string' },
  repo: { type: 'string' },
  name: { type: 'string' },
  level: { type: 'string' },
  lang: { type: 'string' },
  fix: { type: 'boolean' },
  'no-fix': { type: 'boolean' },
  'max-pages': { type: 'string' },
  'max-templates': { type: 'string' },
  include: { type: 'string' },
  exclude: { type: 'string' },
  auth: { type: 'string' },
  'http-auth': { type: 'string' },
  mask: { type: 'string' },
  journey: { type: 'string' },
  concurrency: { type: 'string' },
  browser: { type: 'string' },
  'ignore-robots': { type: 'boolean' },
  offline: { type: 'boolean' },
  'skip-pdf-probe': { type: 'boolean' },
};

const LEVELS = ['A', 'AA', 'AAA'];
const list = (s) => (s ? String(s).split(',').map((x) => x.trim()).filter(Boolean) : []);
const int = (s, d, min, max) => {
  if (s == null) return d;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Expected a number from ${min} to ${max}, got "${s}".`);
  return n;
};

function checkUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Not a valid URL: "${url}"`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`Only http and https URLs can be audited: "${url}"`);
  return u.href;
}

// The report language: only locales with bundled interface strings (references/i18n/<lang>.json), today only "en".
function checkLang(value) {
  const lang = String(value).trim().toLowerCase();
  const langs = bundledLanguages().sort();
  if (!langs.includes(lang)) throw new Error(`--lang must be one of: ${langs.join(', ')} (got "${value}"). The report is written in English only.`);
  return lang;
}

async function pdfProbe(browserLabel) {
  const { getBrowser } = await import('../lib/browser.mjs');
  const { pdfjs } = await import('../lib/deps.mjs');
  const { browser } = await getBrowser();
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html lang="en"><head><title>Probe</title></head><body><h1>A</h1><h2>B</h2><figure><img alt="x" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></figure></body></html>');
  const buf = await page.pdf({ format: 'A4', tagged: true, outline: true });
  await page.close();
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(buf), disableFontFace: true }).promise;
  const outline = await doc.getOutline();
  const tree = await (await doc.getPage(1)).getStructTree();
  const info = (await doc.getMetadata()).info;
  return { ok: Boolean(outline?.length && tree && info.Language), outline: Boolean(outline?.length), tagged: Boolean(tree), lang: info.Language ?? null, browser: browserLabel };
}

export async function doctor(o) {
  const node = process.versions.node;
  let deps = depsStatus();
  if (!deps.ok) {
    log('installing runtime dependencies into', deps.dir);
    const r = installDeps({ offline: Boolean(o.offline) });
    if (!r.ok) return { ok: false, node, deps: r, message: `Could not install the runtime dependencies: ${r.error}` };
    deps = depsStatus();
  }
  let browser;
  try {
    const { browser: b, label, version } = await launchBrowser({ explicit: o.browser });
    await b.close();
    browser = { ok: true, label, version };
  } catch (e) {
    return { ok: false, node, deps, browser: { ok: false, error: e.message }, message: 'No browser could be launched. Install Chrome or Edge, or set WR_BROWSER to a Chromium-based browser.' };
  }
  let probe = { skipped: true };
  if (!o['skip-pdf-probe']) {
    try { probe = await pdfProbe(browser.label); } catch (e) { probe = { ok: false, error: e.message }; }
  }
  const ok = deps.ok && browser.ok && probe.ok !== false;
  return { ok, node, deps, browser, pdfProbe: probe, ...(ok ? {} : { message: 'The browser cannot produce a tagged PDF with bookmarks; the report would not be accessible.' }) };
}

export function setup(o) {
  return installDeps({ offline: Boolean(o.offline) });
}

export function init(o) {
  if (!o.url && !o.repo) throw new Error('Give a site with --url <https://…>, a repository with --repo <path>, or both.');
  const url = o.url ? checkUrl(o.url) : null;
  const repo = o.repo ? path.resolve(o.repo) : null;
  if (repo && !fs.existsSync(repo)) throw new Error(`Repository folder not found: ${repo}`);
  const level = (o.level || 'AA').toUpperCase();
  if (!LEVELS.includes(level)) throw new Error(`--level must be A, AA or AAA (got "${o.level}").`);
  const lang = checkLang(o.lang || 'en');
  if (o.auth && !fs.existsSync(path.resolve(o.auth))) throw new Error(`--auth file not found: ${o.auth}`);
  if (o['http-auth']) {
    if (!fs.existsSync(path.resolve(o['http-auth']))) throw new Error(`--http-auth file not found: ${o['http-auth']}`);
    readHttpAuth(path.resolve(o['http-auth']), url); // fail now on a malformed file, not halfway through the crawl
  }

  const root = rootOf(o);
  const { id, dir } = createRun(root);
  const p = runPaths(dir);
  setLogDir(p.logs);
  const criteria = profileCriteria(level);
  const run = {
    id,
    createdAt: new Date().toISOString(),
    target: {
      url,
      repo,
      repoName: repo ? path.basename(repo) : null,
      mode: url && repo ? 'both' : url ? 'url' : 'repo',
      name: o.name || null,
      // Set by "serve" in repo mode: the local address the crawler uses. Never printed in the report.
      baseUrl: url,
    },
    options: {
      level,
      lang,
      fix: Boolean(o.fix),
      maxPages: int(o['max-pages'], 200, 1, 5000),
      maxTemplates: int(o['max-templates'], 60, 1, 60),
      include: list(o.include),
      exclude: list(o.exclude),
      auth: o.auth ? path.resolve(o.auth) : null,
      httpAuth: o['http-auth'] ? path.resolve(o['http-auth']) : null,
      mask: list(o.mask),
      journeys: list(o.journey),
      concurrency: int(o.concurrency, url ? 3 : 6, 1, 12),
      browser: o.browser || null,
      ignoreRobots: Boolean(o['ignore-robots']),
    },
    profile: { level, criteria: criteria.map((c) => c.id) },
    versions: { node: process.versions.node, kb: kbVersion(), skill: readJson(path.join(SKILL_DIR, 'scripts', 'deps', 'package.json'), {}).version ?? null },
    steps: { init: { done: true, at: new Date().toISOString() } },
    renders: 0,
  };
  writeJson(p.run, run);
  return {
    ok: true,
    run: id,
    dir,
    mode: run.target.mode,
    level,
    criteria: criteria.length,
    lang,
    fix: run.options.fix,
    next: run.target.mode === 'url' ? 'crawl' : 'serve',
  };
}

export function latest(o) {
  const l = readJson(path.join(workDir(rootOf(o)), 'latest.json'), null);
  if (!l?.run) throw new Error('No run yet.');
  return { run: l.run };
}

export function status(o) {
  const ctx = loadRun(o);
  return { run: ctx.id, target: ctx.run.target, options: ctx.run.options, steps: ctx.run.steps, renders: ctx.run.renders, review: ctx.run.review ?? null };
}

// Changes what the report says, not what was tested: the language, fix instructions or the site's display name.
// A new language changes every text, so the old texts are set aside and the writers run again. Fix mode does not:
// every text already has its fix (findings.csv always carries it), and --fix only decides whether the report prints
// it, so a render is enough.
export function configure(o) {
  const ctx = loadRun(o);
  const opts = ctx.run.options;
  const before = { lang: opts.lang, fix: opts.fix };
  if (o.lang) opts.lang = checkLang(o.lang);
  if (o.fix) opts.fix = true;
  if (o['no-fix']) opts.fix = false;
  if (o.name) ctx.run.target.name = o.name;
  const rewrite = before.lang !== opts.lang;
  if (rewrite && fs.existsSync(ctx.p.textDir)) {
    fs.renameSync(ctx.p.textDir, `${ctx.p.textDir}-${before.lang}-${Date.now()}`);
  }
  // The report changes either way, so an earlier review verdict no longer applies to it.
  if (rewrite || before.fix !== opts.fix) delete ctx.run.review;
  writeJson(ctx.p.run, ctx.run);
  return { ok: true, lang: opts.lang, fix: opts.fix, name: ctx.run.target.name, rewrite };
}

export const commands = { doctor, setup, init, latest, status, configure };
