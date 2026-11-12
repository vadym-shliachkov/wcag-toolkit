// render: report.json → report.html + report.pdf.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from '../lib/io.mjs';
import { loadRun, saveRun } from '../lib/run.mjs';
import { renderReport } from '../lib/render.mjs';

export const options = {
  html: { type: 'boolean' },
  draft: { type: 'boolean' },
  data: { type: 'string' },
  out: { type: 'string' },
};

async function assemble(ctx) {
  let mod = null;
  try { mod = await import('../lib/report-data.mjs'); } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  if (mod?.assembleReport) {
    const { report, warnings = [] } = await mod.assembleReport(ctx);
    writeJson(ctx.p.report, report);
    return { report, warnings };
  }
  if (!fs.existsSync(ctx.p.report)) throw new Error('No report.json in this run and no report builder available. Run the analysis steps first.');
  return { report: readJson(ctx.p.report), warnings: ['report.json was rendered as it is: the report builder is not available.'] };
}

export async function render(o) {
  // Stand-alone mode: render any report.json (used by tests and for previews).
  if (o.data) {
    const data = path.resolve(o.data);
    const outDir = path.resolve(o.out || path.dirname(data));
    const r = await renderReport(readJson(data), { outDir, baseDir: path.dirname(data), draft: Boolean(o.draft), htmlOnly: Boolean(o.html), name: path.basename(data, '.json') });
    return { ok: true, ...r };
  }
  const ctx = loadRun(o);
  const { report, warnings } = await assemble(ctx);
  const r = await renderReport(report, { outDir: ctx.dir, baseDir: ctx.dir, runDir: ctx.dir, draft: Boolean(o.draft), htmlOnly: Boolean(o.html) });
  ctx.run.renders = (ctx.run.renders ?? 0) + 1;
  ctx.run.steps = { ...(ctx.run.steps ?? {}), render: { done: true, at: new Date().toISOString(), pages: r.pages, draft: Boolean(o.draft) } };
  saveRun(ctx);
  return { ok: true, ...r, warnings: [...warnings, ...r.warnings] };
}

export const commands = { render };
