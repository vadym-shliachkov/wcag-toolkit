// serve, stop, crawl, templates.
import fs from 'node:fs';
import { readJson, writeJson } from '../lib/io.mjs';
import { loadRun, markStep, saveRun, requireFile, budgetSec } from '../lib/run.mjs';
import { serveRepo, stopTree, alive } from '../lib/serve.mjs';
import { crawl as runCrawl } from '../lib/crawl.mjs';
import { buildTemplates } from '../lib/templates.mjs';
import { log } from '../lib/log.mjs';

export const options = {
  app: { type: 'string' },
};

const budget = (o, d = 480) => Math.round(budgetSec(o, d, 30));

export async function serve(o) {
  // Starting the site is not a resumable step: init's --budget (meant for crawl, deep and measure) does not apply.
  const given = o.budget;
  const ctx = loadRun(o);
  const { run, p } = ctx;
  if (!run.target.repo) return { ok: true, skipped: true, reason: 'No repository given; the crawl uses --url directly.', baseUrl: run.target.url };
  if (run.target.mode === 'both') {
    // The live site is audited; the repository only helps locate source files for --fix.
    return { ok: true, skipped: true, reason: 'Both a URL and a repository were given: the URL is audited.', baseUrl: run.target.url };
  }
  const prev = readJson(p.serve, {});
  if (prev.done && prev.pid && alive(prev.pid)) return { ok: true, baseUrl: prev.baseUrl, reused: true };
  const repo = o.app ? `${run.target.repo}/${o.app}` : run.target.repo;
  const state = await serveRepo(repo, { logFile: p.serveLog, state: prev.done ? {} : prev, budgetMs: budget({ budget: given }, 540) * 1000 });
  writeJson(p.serve, state);
  if (!state.ok) {
    markStep(ctx, 'serve', { fallback: 'static', reason: state.reason });
    return { ok: true, fallback: 'static', reason: state.reason, stack: state.stack };
  }
  if (!state.done) return { ok: true, done: false, stack: state.stack, message: 'Install or build is still running; call serve again.' };
  run.target.baseUrl = state.baseUrl;
  saveRun(ctx);
  markStep(ctx, 'serve', { stack: state.stack });
  log('serve', state.stack, state.baseUrl);
  return { ok: true, done: true, baseUrl: state.baseUrl, stack: state.stack, pid: state.pid };
}

export function stop(o) {
  const ctx = loadRun(o);
  const s = readJson(ctx.p.serve, null);
  if (!s?.pid) return { ok: true, stopped: false, reason: 'No local server was started for this run.' };
  const wasAlive = alive(s.pid);
  stopTree(s.pid);
  writeJson(ctx.p.serve, { ...s, stoppedAt: new Date().toISOString() });
  return { ok: true, stopped: wasAlive, pid: s.pid };
}

export async function crawl(o) {
  const ctx = loadRun(o);
  if (!ctx.run.target.baseUrl) {
    throw new Error('No address to crawl. In repo mode run "serve" first; if it fell back to static analysis there is nothing to crawl.');
  }
  const result = await runCrawl(ctx, { budgetSec: budget(o) });
  if (result.done) markStep(ctx, 'crawl', { scanned: result.scanned, reviewed: result.reviewed, capReached: result.capReached, paused: result.paused });
  return result;
}

const reviewedPage = (pg) => !pg.error && !pg.blocked && !pg.soft404 && pg.status >= 200 && pg.status < 300;

export function templates(o) {
  const ctx = loadRun(o);
  requireFile(ctx.p.pages, 'Run "crawl" first.');
  const pages = readJson(ctx.p.pages);
  const reviewed = pages.pages.filter(reviewedPage);
  if (!reviewed.length) return { ok: false, errors: ['No page could be reviewed, so there are no page types. Check pages.json for errors or blocks.'] };
  const collects = new Map();
  for (const pg of reviewed) if (fs.existsSync(ctx.p.collect(pg.id))) collects.set(pg.id, readJson(ctx.p.collect(pg.id)));
  const { templates: list, assignment } = buildTemplates(reviewed, collects, {
    maxTemplates: ctx.run.options.maxTemplates,
    journeys: ctx.run.options.journeys,
  });
  for (const pg of pages.pages) pg.templateId = assignment.get(pg.id) ?? null;
  writeJson(ctx.p.pages, pages);
  writeJson(ctx.p.templates, { templates: list });
  markStep(ctx, 'templates', { count: list.length });
  return {
    ok: true,
    templates: list.map((t) => ({ id: t.id, name: t.name, kind: t.kind, pages: t.pageIds.length, representative: t.representative, keyFlow: t.keyFlow, deep: t.deep })),
  };
}

export const commands = { serve, stop, crawl, templates };
