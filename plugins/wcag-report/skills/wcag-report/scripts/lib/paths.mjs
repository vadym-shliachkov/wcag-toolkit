import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './io.mjs';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SCRIPTS_DIR = path.join(SKILL_DIR, 'scripts');
export const KB_DIR = path.join(SKILL_DIR, 'kb');
export const REFS_DIR = path.join(SKILL_DIR, 'references');
export const AGENTS_DIR = path.join(SKILL_DIR, 'agents');
export const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

export const WORK_DIR = '.wcag-report';
export const RUN_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{4}(-\d+)?$/;

export function workDir(root) {
  return path.join(root, WORK_DIR);
}

export function newRunId(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}${p(date.getMinutes())}`;
}

export function createRun(root, date = new Date()) {
  const base = workDir(root);
  fs.mkdirSync(path.join(base, 'runs'), { recursive: true });
  const gitignore = path.join(base, '.gitignore');
  // Runs hold screenshots of the site and may hold personal data: never committed by default.
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, '*\n');
  const stem = newRunId(date);
  let id = stem;
  for (let n = 2; fs.existsSync(path.join(base, 'runs', id)); n++) id = `${stem}-${n}`;
  const dir = path.join(base, 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(base, 'latest.json'), { run: id });
  return { id, dir };
}

export function resolveRun(root, id) {
  const base = workDir(root);
  let runId = id;
  if (runId == null) {
    const latest = readJson(path.join(base, 'latest.json'), null);
    if (!latest?.run) throw new Error(`No wcag-report run found in ${base}. Run "wcag-report audit" first.`);
    runId = latest.run;
  }
  if (!RUN_ID_RE.test(runId)) throw new Error(`Invalid run id "${runId}". Expected the form YYYY-MM-DDTHHmm.`);
  const dir = path.join(base, 'runs', runId);
  if (!fs.existsSync(dir)) throw new Error(`Run "${runId}" not found in ${path.join(base, 'runs')}.`);
  return { id: runId, dir };
}

// Every file a run produces, in one place, so modules agree on names.
export function runPaths(dir) {
  const j = (...p) => path.join(dir, ...p);
  return {
    dir,
    run: j('run.json'),
    serve: j('serve.json'),
    serveLog: j('serve.log'),
    crawlState: j('crawl-state.json'),
    pages: j('pages.json'),
    axeDir: j('axe'),
    axe: (pid) => j('axe', `${pid}.json`),
    collectDir: j('collect'),
    collect: (pid) => j('collect', `${pid}.json`),
    templates: j('templates.json'),
    deepDir: (tid) => j('deep', tid),
    deep: (tid, check) => j('deep', tid, `${check}.json`),
    shotsDir: j('shots'),
    shotsIndex: j('shots', 'index.json'),
    signals: j('signals.json'),
    observationsDir: j('observations'),
    observation: (name) => j('observations', `${name}.json`),
    issues: j('issues.json'),
    criteriaStatus: j('criteria-status.json'),
    textDir: j('text'),
    text: (name) => j('text', `${name}.json`),
    report: j('report.json'),
    html: j('report.html'),
    pdf: j('report.pdf'),
    csv: j('findings.csv'),
    xlsx: j('findings.xlsx'),
    amendments: j('amendments.json'),
    reviewDir: (round) => j('review', `r${round}`),
    logs: j('logs'),
  };
}
