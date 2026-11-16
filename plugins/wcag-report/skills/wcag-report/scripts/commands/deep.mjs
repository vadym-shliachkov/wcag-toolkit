// deep: interactive checks on one representative page per template. shots: template screenshots (before the
// judges) and issue close-ups (after merge, --issues).
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../lib/io.mjs';
import { loadRun, markStep, pageList, templateList, requireFile, budgetSec } from '../lib/run.mjs';
import { getBrowser } from '../lib/browser.mjs';
import { imageTools } from '../lib/image.mjs';
import { runChecks, pendingChecks, CHECK_NAMES } from '../lib/deep/index.mjs';
import { templateShots, issueShots } from '../lib/shots.mjs';
import { measurePages } from '../lib/measure.mjs';

export const options = {
  template: { type: 'string' },
  check: { type: 'string' },
  issues: { type: 'boolean' },
};

const reviewable = (p) => p && p.status >= 200 && p.status < 300 && !p.blocked && !p.soft404 && !p.error;

function deepTemplates(ctx, only) {
  const all = templateList(ctx).templates;
  if (only) {
    const t = all.find((x) => x.id === only);
    if (!t) throw new Error(`Template "${only}" not found in templates.json.`);
    return [t];
  }
  return all.filter((t) => t.deep);
}

export async function deep(o) {
  const ctx = loadRun(o);
  requireFile(ctx.p.templates, 'Run "templates" first.');
  const only = o.check ? o.check.split(',').map((s) => s.trim()) : null;
  if (only) for (const c of only) if (!CHECK_NAMES.includes(c)) throw new Error(`Unknown check "${c}". Checks: ${CHECK_NAMES.join(', ')}`);
  const deadline = Date.now() + budgetSec(o) * 1000;
  const pages = pageList(ctx).pages;
  const templates = deepTemplates(ctx, o.template);
  const { browser } = await getBrowser({ explicit: ctx.run.options.browser });
  const img = await imageTools(browser);
  const skipped = [];
  let done = true;
  let offline = false;
  try {
    for (const t of templates) {
      const outDir = ctx.p.deepDir(t.id);
      if (!pendingChecks(outDir, only).length) continue;
      const page = pages.find((p) => p.id === t.representative);
      if (!reviewable(page)) { skipped.push({ template: t.id, reason: 'representative page did not load' }); continue; }
      if (Date.now() > deadline) { done = false; break; }
      const env = {
        browser, img, url: page.finalUrl || page.url, pageId: page.id, templateId: t.id,
        outDir, relDir: `deep/${t.id}`, runDir: ctx.dir, level: ctx.run.options.level, options: ctx.run.options,
        axeDefault: readJson(ctx.p.axe(page.id), null), deadline, shared: {},
      };
      const r = await runChecks(env, { only });
      if (!r.done) { done = false; offline = Boolean(r.offline); break; }
    }
  } finally {
    await img.close();
  }
  const templatesDone = templates.filter((t) => !pendingChecks(ctx.p.deepDir(t.id), only).length).map((t) => t.id);
  const pending = templates.map((t) => t.id).filter((id) => !templatesDone.includes(id) && !skipped.some((s) => s.template === id));
  done = done && pending.length === 0;
  let signals = 0;
  for (const id of templatesDone) {
    const dir = ctx.p.deepDir(id);
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.json') && n !== 'keyboard-trace.json') : []) {
      signals += (readJson(path.join(dir, f), {}).signals ?? []).filter((s) => s.status === 'fail' || s.status === 'needs_review').length;
    }
  }
  if (done && !only && !o.template) markStep(ctx, 'deep', { templates: templatesDone, skipped });
  return { ok: true, done, templatesDone, pending, skipped, findings: signals, ...(done ? {} : { ...(offline ? { offline: true } : {}), next: offline ? 'The network was lost or the site refused the requests (rate limit); nothing was saved for that check. Wait, check the connection, and run "deep" again.' : 'Run "deep" again to continue.' }) };
}

export async function shots(o) {
  const ctx = loadRun(o);
  const { browser } = await getBrowser({ explicit: ctx.run.options.browser });
  const img = await imageTools(browser);
  try {
    if (o.issues) {
      requireFile(ctx.p.issues, 'Run "merge" first.');
      const r = await issueShots(ctx, { browser, img });
      markStep(ctx, 'shots-issues', r);
      return { ok: true, ...r };
    }
    requireFile(ctx.p.templates, 'Run "templates" first.');
    const r = await templateShots(ctx, { browser, img, templates: deepTemplates(ctx, o.template), pages: pageList(ctx).pages });
    markStep(ctx, 'shots', r);
    return { ok: true, ...r };
  } finally {
    await img.close();
  }
}

// measure: every reviewed page, for what the automated rules leave undecided (contrast over images, links marked
// only by colour, visible words missing from accessible names). Resumable like deep.
export async function measure(o) {
  const ctx = loadRun(o);
  requireFile(ctx.p.templates, 'Run "templates" first.');
  const deadline = Date.now() + budgetSec(o) * 1000;
  const { browser } = await getBrowser({ explicit: ctx.run.options.browser });
  const img = await imageTools(browser);
  try {
    const r = await measurePages(ctx, { browser, img, deadline });
    if (r.done) markStep(ctx, 'measure', r);
    return { ok: true, ...r, ...(r.done ? {} : { next: r.offline ? 'The network was lost or the site refused the requests (rate limit); nothing was saved for the page. Wait, check the connection, and run "measure" again.' : 'Run "measure" again to continue.' }) };
  } finally {
    await img.close();
  }
}

export const commands = { deep, shots, measure };
