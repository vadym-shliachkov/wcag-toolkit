// Loading a run and keeping its step state, shared by every command.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { resolveRun, runPaths } from './paths.mjs';
import { setLogDir } from './log.mjs';
import { readHttpAuth, setHttpAuth } from './browser.mjs';

export function rootOf(o) {
  return path.resolve(o.root || o.repo || process.cwd());
}

export function loadRun(o) {
  const root = rootOf(o);
  const { id, dir } = resolveRun(root, o.run);
  const p = runPaths(dir);
  setLogDir(p.logs);
  const run = readJson(p.run);
  // Every command that opens the site goes through loadRun, so a protected staging site opens in each of them.
  if (run?.options?.httpAuth) setHttpAuth(readHttpAuth(run.options.httpAuth, run.target?.url));
  return { root, id, dir, p, run };
}

export function saveRun(ctx) {
  writeJson(ctx.p.run, ctx.run);
}

export function markStep(ctx, step, data = {}) {
  ctx.run.steps = ctx.run.steps || {};
  ctx.run.steps[step] = { done: true, at: new Date().toISOString(), ...data };
  saveRun(ctx);
}

export function stepDone(ctx, step) {
  return Boolean(ctx.run.steps?.[step]?.done);
}

export function requireFile(file, hint) {
  if (!fs.existsSync(file)) throw new Error(`${path.basename(file)} is missing. ${hint}`);
}

// The audited site's address as it should appear to the client: the real URL, never a local dev server.
export function publicTarget(run) {
  const local = (() => { try { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(run.target?.url).hostname); } catch { return false; } })();
  if (run.target?.url && !local) return run.target.url;
  if (local) return run.target.name || run.target.repoName || 'Local site';
  if (run.target?.repo) return run.target.repoName || path.basename(run.target.repo);
  return '';
}

export function pageList(ctx) {
  return readJson(ctx.p.pages, { pages: [], skipped: [], stats: {} });
}

export function templateList(ctx) {
  return readJson(ctx.p.templates, { templates: [] });
}
