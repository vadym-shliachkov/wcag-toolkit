// candidates, judge-context, save-judge, validate-judge, merge, text-context, save-text, validate-text.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, readStdin, parseLooseJson, listFiles } from '../lib/io.mjs';
import { loadRun, markStep, requireFile } from '../lib/run.mjs';
import { axeSignals, applicabilitySignals, placeholderSignals, deepSignals } from '../lib/signals.mjs';
import { consistencySignals } from '../lib/consistency.mjs';
import { signalToObservation, checkObservation } from '../lib/observations.mjs';
import { mergeObservations, isReviewed, pageToolNotes } from '../lib/merge.mjs';
import { judgeContext, convertJudgeOutput, saveJudgeFile, judgeCriteria } from '../lib/judge.mjs';
import { textContext, validateTexts, saveTexts, batches } from '../lib/text.mjs';
import { log } from '../lib/log.mjs';
import { joinInto } from './review.mjs';

export const options = {
  template: { type: 'string' },
  consistency: { type: 'boolean' },
  stage: { type: 'string' },
  batch: { type: 'string' },
  round: { type: 'string' },
  mode: { type: 'string' },
};

export function candidates(o) {
  const ctx = loadRun(o);
  const { p, run } = ctx;
  requireFile(p.pages, 'Run "crawl" first.');
  const level = run.options.level;
  const pages = readJson(p.pages).pages;
  const reviewed = pages.filter(isReviewed);
  const byId = new Map(pages.map((x) => [x.id, x]));
  const signals = [];
  const skipped = { bestPractice: 0, outOfProfile: 0 };
  // Default states first: an extra state (cookie banner open, menu open) only adds what is new in that state. Without
  // this, the banner-open pass re-reports every page element, and its screenshots show the banner over them.
  const seen = new Set();
  const files = listFiles(p.axeDir, /\.json$/).sort((a, b) => Number(a.includes('@')) - Number(b.includes('@')));
  for (const file of files) {
    const pid = path.basename(file, '.json').split('@')[0];
    const page = byId.get(pid);
    if (!page || !isReviewed(page)) continue;
    const r = axeSignals(file, { level, page });
    const extraState = file.includes('@');
    r.signals = r.signals.filter((s) => {
      const id = `${s.pageId}|${s.check}|${s.selector}`;
      if (extraState && seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    signals.push(...r.signals);
    skipped.bestPractice += r.skipped.bestPractice;
    skipped.outOfProfile += r.skipped.outOfProfile;
  }
  const collects = reviewed.map((x) => readJson(p.collect(x.id), null)).filter(Boolean);
  signals.push(...applicabilitySignals(collects, { level, reviewedCount: reviewed.length }));
  signals.push(...placeholderSignals(collects, { level }));
  signals.push(...consistencySignals(collects, reviewed, { level }));
  const deep = deepSignals(path.join(p.dir, 'deep'), { level });
  signals.push(...deep.signals);
  signals.forEach((s, i) => { s.id = `S-${String(i + 1).padStart(6, '0')}`; });
  writeJson(p.signals, { signals, deepRan: deep.ran, skipped });

  const userAgent = run.versions?.browser ?? null;
  const observations = [];
  const invalid = [];
  signals.forEach((s, i) => {
    const obs = signalToObservation(s, i + 1, { level, userAgent });
    const errs = checkObservation(obs, p.dir);
    if (errs.length) invalid.push({ signal: s.id, errors: errs.slice(0, 3) });
    else observations.push(obs);
  });
  writeJson(p.observation('auto'), { observations, invalid });
  const count = (st) => signals.filter((s) => s.status === st).length;
  markStep(ctx, 'candidates', { signals: signals.length });
  if (invalid.length) log(`${invalid.length} signal(s) could not become valid observations; see observations/auto.json "invalid"`);
  return { ok: true, signals: signals.length, fail: count('fail'), needs_review: count('needs_review'), pass: count('pass'), not_applicable: count('not_applicable'), invalid: invalid.length, skipped, deepChecks: deep.ran.length };
}

function judgeTarget(o) {
  if (o.consistency) return { consistency: true, name: 'consistency' };
  if (!o.template) throw new Error('Give --template <id> or --consistency.');
  return { consistency: false, template: o.template, name: o.template };
}

export function judgeContextCmd(o) {
  const ctx = loadRun(o);
  const t = judgeTarget(o);
  return judgeContext(ctx, { ...t, save: Boolean(o.save) });
}

function checkJudge(ctx, t, data) {
  const { errors, observations } = convertJudgeOutput(ctx, data, t);
  return { errors, observations };
}

export function saveJudge(o, { stdin = readStdin } = {}) {
  const ctx = loadRun(o);
  const t = judgeTarget(o);
  let data;
  try { data = parseLooseJson(stdin()); } catch (e) { return { ok: false, judge: t.name, errors: [`invalid JSON: ${e.message}`] }; }
  const { errors, observations } = checkJudge(ctx, t, data);
  // Saved even when invalid, so validate-judge can report it and a retry can start from the errors.
  saveJudgeFile(ctx, t.name, { judge: t.name, raw: data, observations: errors.length ? [] : observations, errors });
  const by = (st) => observations.filter((x) => x.status === st).length;
  return errors.length
    ? { ok: false, judge: t.name, errors: errors.slice(0, 20) }
    : { ok: true, judge: t.name, fail: by('fail'), needs_review: by('needs_review'), pass: by('pass'), not_applicable: by('not_applicable') };
}

export function validateJudge(o) {
  const ctx = loadRun(o);
  const t = judgeTarget(o);
  const saved = readJson(ctx.p.observation(`judge-${t.name}`), null);
  if (!saved) return { ok: false, judge: t.name, errors: ['No result saved yet.'] };
  if (saved.errors?.length) return { ok: false, judge: t.name, errors: saved.errors.slice(0, 20) };
  return { ok: true, judge: t.name, observations: saved.observations.length };
}

export function merge(o) {
  const ctx = loadRun(o);
  const { p, run } = ctx;
  requireFile(p.observation('auto'), 'Run "candidates" first.');
  const pages = readJson(p.pages).pages;
  const templates = readJson(p.templates, { templates: [] }).templates;
  const collects = pages.filter(isReviewed).map((x) => readJson(p.collect(x.id), null)).filter(Boolean);
  const observations = [...readJson(p.observation('auto')).observations];
  const judgedTemplates = [];
  const failedJudges = [];
  // The consistency judge runs only while it has criteria left; navigation order, names, help and ways to a page are
  // now compared from the collected links of every page.
  const expected = [...templates.map((t) => t.id), ...(judgeCriteria(run.options.level, { consistency: true }).length ? ['consistency'] : [])];
  for (const name of expected) {
    const saved = readJson(p.observation(`judge-${name}`), null);
    if (!saved || saved.errors?.length) { failedJudges.push(name); continue; }
    observations.push(...saved.observations);
    if (name !== 'consistency') judgedTemplates.push(name);
  }
  const deepRan = readJson(p.signals, { deepRan: [] }).deepRan;
  // Page types the website refused to show during the in-depth checks were not tested; the report says so (gap
  // "refused"), and the criteria are decided on the page types that could be tested.
  const refusedTemplates = [...new Set(readJson(path.join(ctx.dir, 'refused.json'), []).filter((r) => r.step === 'deep').map((r) => r.templateId))];
  const merged = mergeObservations({ observations, pages, templates, collects, level: run.options.level, deepRan, judgedTemplates, refusedTemplates });
  const { criteriaStatus, journeys } = merged;
  // Amendments made after a re-check survive a re-merge: a removed finding stays removed, a downgraded one stays an
  // item to check. They are matched by the stable key, never by the display ID.
  const amendments = readJson(p.amendments, []);
  const lastByKey = new Map(amendments.map((a) => [a.key, a]));
  const removedKeys = new Set([...lastByKey.values()].filter((a) => a.to === 'removed').map((a) => a.key));
  const issues = merged.issues.filter((i) => !removedKeys.has(i.key));
  for (const a of amendments) {
    const i = issues.find((x) => x.key === a.key);
    if (i && a.to === 'needs_review' && i.status === 'fail') Object.assign(i, { status: 'needs_review', question: [a.reason] });
    // An item to check that a re-check with evidence confirmed stays a problem.
    if (i && a.to === 'fail' && i.status === 'needs_review') Object.assign(i, { status: 'fail', amended: true });
    const target = a.to === 'merged' && a.intoKey ? issues.find((x) => x.key === a.intoKey) : null;
    if (i && target && target !== i) {
      joinInto(target, i);
      // Replaying a merge is not a change: the text is stale only if the places differ from the last merge (below).
      delete target.textStale;
      issues.splice(issues.indexOf(i), 1);
    }
  }
  if (removedKeys.size || amendments.some((a) => a.to === 'needs_review' || a.to === 'fail')) {
    for (const c of criteriaStatus.filter((x) => x.in_profile)) {
      c.issueKeys = issues.filter((i) => i.status === 'fail' && (i.criteria.primary === c.id || i.criteria.related.includes(c.id))).map((i) => i.key);
      c.reviewKeys = issues.filter((i) => i.status === 'needs_review' && (i.criteria.primary === c.id || i.criteria.related.includes(c.id))).map((i) => i.key);
      if (c.status === 'fail' && !c.issueKeys.length) Object.assign(c, c.reviewKeys.length ? { status: 'needs_review' } : { status: 'not_tested', noteCode: 'withdrawn' });
      if (c.status === 'needs_review' && c.issueKeys.length) c.status = 'fail';
      // Its open items were all settled by a re-check with evidence (removed): the requirement is decided.
      else if (c.status === 'needs_review' && !c.reviewKeys.length && removedKeys.size) Object.assign(c, { status: 'pass', noteCode: 'rechecked', reason: 'The items left open by the automated checks were settled by a re-check on the live page.' });
    }
    // Problems first, by severity (a confirmed item to check takes its place among them); the sort is stable.
    const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    issues.sort((a, b) => Number(a.status !== 'fail') - Number(b.status !== 'fail') || (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4));
  }
  // Display IDs follow priority order; they are what the owner, the writers and the red team refer to.
  let f = 0;
  let r = 0;
  for (const i of issues) i.id = i.status === 'fail' ? `I-${String(++f).padStart(2, '0')}` : `R-${String(++r).padStart(2, '0')}`;
  // Keep screenshots already captured for an issue that survives a re-merge.
  const previous = new Map(readJson(p.issues, []).map((i) => [i.key, i]));
  for (const i of issues) if (previous.get(i.key)?.shots?.length) i.shots = previous.get(i.key).shots;
  // A problem that now covers other places (split by kind of fix, an image moved to the card that holds its other
  // pages) needs its text written again: the old text may name pictures that are no longer in it.
  for (const i of issues) {
    const before = previous.get(i.key);
    if (!before) continue;
    const was = new Set(before.observationIds ?? []);
    const changed = i.observationIds.length !== was.size || i.observationIds.some((x) => !was.has(x));
    if (changed || before.textStale) i.textStale = true;
  }
  // Judge criteria of a judge that failed stay "not tested" with that reason.
  if (failedJudges.length) {
    const lost = new Set(failedJudges.flatMap((n) => judgeCriteria(run.options.level, { consistency: n === 'consistency' }).map((c) => c.sc)));
    for (const c of criteriaStatus) if (lost.has(c.id) && c.status === 'not_tested') c.noteCode = 'judge_failed';
  }
  writeJson(p.issues, issues);
  writeJson(p.criteriaStatus, criteriaStatus);
  writeJson(path.join(p.dir, 'journeys.json'), journeys);
  // What other scanners report that is not a failure: from the automated results and from each page's measurement.
  const measured = templates.flatMap((t) => (fs.existsSync(p.deepDir(t.id)) ? fs.readdirSync(p.deepDir(t.id)).filter((x) => /^measure-.*\.json$/.test(x)).map((x) => readJson(path.join(p.deepDir(t.id), x), null)).filter(Boolean) : []));
  writeJson(path.join(p.dir, 'tool-notes.json'), [...(merged.toolNotes ?? []), ...pageToolNotes(measured)]);
  markStep(ctx, 'merge', { issues: f, review: r });
  const sev = (s) => issues.filter((i) => i.status === 'fail' && i.severity === s).length;
  const st = (s) => criteriaStatus.filter((c) => c.in_profile && c.status === s).length;
  // A new merge is a new set of findings: the writer batches are cut again from it.
  fs.rmSync(p.text('batches'), { force: true });
  return {
    ok: true,
    issues: f,
    review_items: r,
    severity: { critical: sev('critical'), serious: sev('serious'), moderate: sev('moderate'), minor: sev('minor') },
    criteria: { fail: st('fail'), needs_review: st('needs_review'), pass: st('pass'), not_applicable: st('not_applicable'), not_tested: st('not_tested') },
    judgesMissing: failedJudges,
    writerBatches: batches(issues, ctx).length,
  };
}

function requireStage(stage) {
  if (!['write', 'edit', 'fix'].includes(stage)) throw new Error('--stage must be write, edit or fix');
}

export function textContextCmd(o) {
  requireStage(o.stage);
  const ctx = loadRun(o);
  requireFile(ctx.p.issues, 'Run "merge" first.');
  return textContext(ctx, { stage: o.stage, batch: o.batch, round: o.round, save: Boolean(o.save) });
}

export async function saveText(o, { stdin = readStdin } = {}) {
  requireStage(o.stage);
  const ctx = loadRun(o);
  let data;
  try { data = parseLooseJson(stdin()); } catch (e) { return { ok: false, stage: o.stage, errors: [`invalid JSON: ${e.message}`] }; }
  const { errors, warnings } = await validateTexts(ctx, o.stage, data, { batch: o.batch, round: o.round });
  if (errors.length) {
    writeJson(ctx.p.text(`${o.stage}${o.batch ? `-${o.batch}` : ''}${o.round ? `-${o.round}` : ''}.rejected`), { data, errors });
    return { ok: false, stage: o.stage, errors: errors.slice(0, 25), warnings: warnings.slice(0, 15) };
  }
  saveTexts(ctx, o.stage, data, { batch: o.batch, round: o.round });
  return { ok: true, stage: o.stage, batch: o.batch ?? null, warnings: warnings.slice(0, 15) };
}

export async function validateText(o) {
  requireStage(o.stage);
  const ctx = loadRun(o);
  const file = o.stage === 'write' ? ctx.p.text(`write-${o.batch}`) : o.stage === 'edit' ? ctx.p.text('edit') : ctx.p.text(`fix-${o.round}`);
  if (!fs.existsSync(file)) return { ok: false, stage: o.stage, errors: ['No result saved yet.'] };
  const { errors, warnings } = await validateTexts(ctx, o.stage, readJson(file), { batch: o.batch, round: o.round });
  return { ok: errors.length === 0, stage: o.stage, errors, warnings };
}

export const commands = {
  candidates,
  'judge-context': judgeContextCmd,
  'save-judge': saveJudge,
  'validate-judge': validateJudge,
  merge,
  'text-context': textContextCmd,
  'save-text': saveText,
  'validate-text': validateText,
};
