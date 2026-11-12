// redteam-prep, redteam-context, save-redteam, recheck, amend, publish, summary.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson, readStdin, parseLooseJson } from '../lib/io.mjs';
import { loadRun, saveRun, requireFile, publicTarget } from '../lib/run.mjs';
import { workDir } from '../lib/paths.mjs';
import { prepRound, redteamContext, checkVerdict, finalizeVerdict, statusLine, MAX_ROUNDS } from '../lib/redteam.mjs';
import { recheckIssue } from '../lib/recheck.mjs';
import { criterion as criterionOf } from '../lib/criteria.mjs';

export const options = {
  issue: { type: 'string' },
  status: { type: 'string' },
  reason: { type: 'string' },
  evidence: { type: 'string' },
  'merge-into': { type: 'string' },
  criterion: { type: 'string' },
  draft: { type: 'boolean' },
  'no-recheck': { type: 'boolean' },
};

function roundOf(o) {
  const r = Number(o.round ?? 1);
  if (!Number.isInteger(r) || r < 1 || r > MAX_ROUNDS) throw new Error(`--round must be 1…${MAX_ROUNDS}`);
  return r;
}

const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export async function redteamPrep(o) {
  const ctx = loadRun(o);
  const round = roundOf(o);
  const prep = await prepRound(ctx, round, { recheck: !o['no-recheck'] });
  return { ok: true, ...prep, pages: undefined, dir: ctx.p.reviewDir(round) };
}

export function redteamContextCmd(o) {
  return redteamContext(loadRun(o), roundOf(o), Boolean(o.save));
}

export function saveRedteam(o, { stdin = readStdin } = {}) {
  const ctx = loadRun(o);
  const round = roundOf(o);
  let data;
  try { data = parseLooseJson(stdin()); } catch (e) { return { ok: false, errors: [`invalid JSON: ${e.message}`] }; }
  const { errors, prep } = checkVerdict(ctx, round, data);
  if (errors.length) {
    writeJson(path.join(ctx.p.reviewDir(round), 'verdict.rejected.json'), { data, errors });
    return { ok: false, round, errors: errors.slice(0, 20) };
  }
  const verdict = finalizeVerdict(ctx, round, data, prep);
  writeJson(path.join(ctx.p.reviewDir(round), 'verdict.json'), verdict);
  ctx.run.review = { round, ready: verdict.ready, pdf_sha256: verdict.pdf_sha256, counts: verdict.counts, at: verdict.saved_at };
  saveRun(ctx);
  return { ok: true, round, ready: verdict.ready, counts: verdict.counts, not_ready_because: verdict.not_ready_because, line: statusLine(verdict) };
}

export async function recheck(o) {
  if (!o.issue) throw new Error('Give --issue <I-NN>.');
  const ctx = loadRun(o);
  const round = roundOf(o);
  return { ok: true, issue: o.issue, ...(await recheckIssue(ctx, o.issue, { outDir: path.join(ctx.p.reviewDir(round), 'recheck') })) };
}

// The only way to change a finding after it was written: every change is logged with its reason and evidence, and
// the red team checks each one in the next round.
// Besides a status change, a finding can be folded into the one it duplicates (--merge-into, its places move over)
// or moved to the requirement it really concerns (--criterion).
// A duplicate joins the finding it repeats: its places, page types and observations move over, and the target's text is
// written again.
export function joinInto(target, issue) {
  // The same picture file on the same page is one place, whichever finding brought it.
  const place = (x) => (x.src ? `${x.pageId}|${String(x.src).split('/').pop().split('?')[0]}` : null);
  const seen = new Set(target.instances.flatMap((x) => [x.observationId, place(x)]).filter(Boolean));
  target.instances.push(...issue.instances.filter((x) => !seen.has(x.observationId) && !(place(x) && seen.has(place(x)))));
  target.instanceCount = target.instances.length;
  target.templates = [...new Set([...target.templates, ...issue.templates])];
  // The duplicate's requirement stays covered: it becomes a related requirement of the finding it joins.
  target.criteria.related = [...new Set([...target.criteria.related, issue.criteria.primary, ...issue.criteria.related])].filter((x) => x !== target.criteria.primary);
  target.observationIds = [...new Set([...target.observationIds, ...issue.observationIds])];
  target.observed = [...new Set([...(target.observed ?? []), ...(issue.observed ?? [])])].slice(0, 5);
  if (target.question) target.question = [...new Set([...target.question, ...(issue.question ?? [])])].slice(0, 3);
  const pageIds = new Set(target.instances.map((x) => x.pageId).filter(Boolean));
  target.reach = { ...target.reach, pages: pageIds.size, likelyPages: Math.max(target.reach.likelyPages, pageIds.size) };
  Object.assign(target, { textStale: true, amended: true });
}

export function amend(o) {
  const ctx = loadRun(o);
  const { p } = ctx;
  const into = o['merge-into'];
  const mode = into ? 'merge' : o.criterion ? 'criterion' : 'status';
  if (!o.issue || !o.reason || (mode === 'status' && !o.status)) throw new Error('Give --issue <I-NN|R-NN>, --reason "…" and one of --status needs_review|removed|fail, --merge-into <I-NN|R-NN> or --criterion <n.n.n>.');
  if (mode === 'status' && !['needs_review', 'removed', 'fail'].includes(o.status)) throw new Error('--status must be needs_review, removed or fail.');
  const issues = readJson(p.issues);
  const i = issues.findIndex((x) => x.id === o.issue);
  // A removed finding is no longer in issues.json: it is brought back by its key (WR-…, in amendments.json) with
  // --status fail and the evidence that it is a problem after all; the next merge restores it.
  if (i < 0 && /^WR-/.test(o.issue) && o.status === 'fail') {
    const log = readJson(p.amendments, []);
    const last = [...log].reverse().find((a) => a.key === o.issue);
    if (!last || last.to !== 'removed') throw new Error(`${o.issue} is not a removed finding.`);
    if (!o.evidence || !fs.existsSync(path.resolve(p.dir, o.evidence))) throw new Error('Restoring a finding needs --evidence <file>.');
    const entry = { id: last.id, key: last.key, from: 'removed', to: 'fail', reason: o.reason, evidence: o.evidence, restored: true, at: new Date().toISOString() };
    log.push(entry);
    writeJson(p.amendments, log);
    return { ok: true, ...entry, next: 'Run merge: the finding comes back with its observations.' };
  }
  if (i < 0) throw new Error(`No issue ${o.issue}.`);
  const issue = issues[i];
  if (o.evidence && !fs.existsSync(path.resolve(p.dir, o.evidence))) throw new Error(`Evidence file not found: ${o.evidence}`);
  if (o.status === 'fail' && !o.evidence) throw new Error('Making something a confirmed problem needs --evidence <file>.');
  if (o.status === 'removed' && !o.evidence) throw new Error('Removing a finding needs --evidence (for example the re-check screenshot).');
  const entry = { id: issue.id, key: issue.key, from: issue.status, to: o.status ?? issue.status, reason: o.reason, evidence: o.evidence ?? null, at: new Date().toISOString() };
  if (mode === 'merge') {
    const target = issues.find((x) => x.id === into);
    if (!target || target === issue) throw new Error(`No other issue ${into}.`);
    // A confirmed problem never disappears into a question.
    if (issue.status === 'fail' && target.status !== 'fail') throw new Error(`${issue.id} is a confirmed problem; merge it into another problem, not into ${target.id}.`);
    joinInto(target, issue);
    issues.splice(i, 1);
    // The target is named by its key too: display IDs change when a later merge renumbers the findings.
    Object.assign(entry, { to: 'merged', into: target.id, intoKey: target.key });
  } else if (mode === 'criterion') {
    const c = criterionOf(o.criterion);
    if (!c) throw new Error(`Unknown criterion ${o.criterion}.`);
    entry.criterion = { from: issue.criteria.primary, to: c.id };
    issue.criteria = { primary: c.id, related: issue.criteria.related.filter((x) => x !== c.id) };
    Object.assign(issue, { textStale: true, amended: true });
  } else if (o.status === 'removed') issues.splice(i, 1);
  else if (o.status === 'needs_review' && issue.status === 'fail') {
    const next = issues.filter((x) => x.status === 'needs_review').length + 1;
    Object.assign(issue, { status: 'needs_review', id: `R-${String(next).padStart(2, '0')}`, question: [o.reason], textStale: true, amended: true });
    entry.newId = issue.id;
  } else if (o.status === 'fail' && issue.status === 'needs_review') {
    Object.assign(issue, { status: 'fail', textStale: true, amended: true });
  }
  writeJson(p.issues, issues);
  const log = readJson(p.amendments, []);
  log.push(entry);
  writeJson(p.amendments, log);
  // Criteria status follows the issues.
  const cs = readJson(p.criteriaStatus, []);
  for (const c of cs) {
    if (!c.in_profile) continue;
    c.issueKeys = issues.filter((x) => x.status === 'fail' && (x.criteria.primary === c.id || x.criteria.related.includes(c.id))).map((x) => x.key);
    c.reviewKeys = issues.filter((x) => x.status === 'needs_review' && (x.criteria.primary === c.id || x.criteria.related.includes(c.id))).map((x) => x.key);
    if (c.issueKeys.length) c.status = 'fail';
    else if (c.reviewKeys.length) c.status = 'needs_review';
    else if (c.status === 'fail' || c.status === 'needs_review') { c.status = 'not_tested'; c.reason = `A finding was withdrawn after a re-check: ${o.reason}`; c.noteCode = 'withdrawn'; }
  }
  writeJson(p.criteriaStatus, cs);
  return { ok: true, ...entry, textStale: mode === 'merge' || Boolean(issue.textStale) };
}

// The work lists go with the PDF under the same name: findings.xlsx for the owner, findings.csv for developers.
function copyData(p, base) {
  const out = {};
  for (const [k, ext] of [['csv', 'csv'], ['xlsx', 'xlsx']]) {
    if (!fs.existsSync(p[k])) continue;
    out[k] = `${base}-findings.${ext}`;
    fs.copyFileSync(p[k], out[k]);
  }
  return out;
}

function deliverableName(ctx) {
  const target = publicTarget(ctx.run).replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
  return `${target}-wcag-report-${ctx.run.createdAt.slice(0, 10)}`;
}

export async function publish(o) {
  const ctx = loadRun(o);
  const { p, run } = ctx;
  requireFile(p.pdf, 'Run "render" first.');
  const outDir = path.join(workDir(ctx.root), 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const review = run.review;
  const current = sha(p.pdf);
  const passed = review?.ready && review.pdf_sha256 === current;
  if (passed && !o.draft) {
    const file = path.join(outDir, `${deliverableName(ctx)}.pdf`);
    fs.copyFileSync(p.pdf, file);
    const data = copyData(p, path.join(outDir, deliverableName(ctx)));
    run.published = { file, data, at: new Date().toISOString(), pdf_sha256: current, round: review.round };
    saveRun(ctx);
    return { ok: true, ready: true, file, data, round: review.round };
  }
  if (!o.draft) {
    const why = !review ? 'the report has not been reviewed' : !review.ready ? `the last review (round ${review.round}) did not pass` : 'the PDF changed after its review';
    return { ok: false, ready: false, message: `Not published: ${why}. Run the red-team review, or publish with --draft to get a copy named -DRAFT.` };
  }
  const { commands } = await import('./render.mjs');
  const r = await commands.render({ ...o, draft: true });
  const file = path.join(outDir, `${deliverableName(ctx)}-DRAFT.pdf`);
  fs.copyFileSync(r.pdf ?? p.pdf, file);
  const data = copyData(p, path.join(outDir, `${deliverableName(ctx)}-DRAFT`));
  // The draft render overwrote report.pdf; the reviewed hash no longer matches, so it can never be published by accident.
  return { ok: true, ready: false, draft: true, file, data };
}

export function summary(o) {
  const ctx = loadRun(o);
  const { p, run } = ctx;
  const issues = readJson(p.issues, []);
  const cs = readJson(p.criteriaStatus, []).filter((c) => c.in_profile);
  const pages = readJson(p.pages, { pages: [], stats: {} });
  const verdict = run.review ? readJson(path.join(p.reviewDir(run.review.round), 'verdict.json'), null) : null;
  const sev = (s) => issues.filter((i) => i.status === 'fail' && i.severity === s).length;
  const st = (s) => cs.filter((c) => c.status === s).length;
  return {
    run: ctx.id,
    target: publicTarget(run),
    level: run.options.level,
    lang: run.options.lang,
    fix: run.options.fix,
    pages: { reviewed: pages.pages.filter((x) => x.status >= 200 && x.status < 300 && !x.error && !x.blocked && !x.soft404).length, skipped: pages.skipped?.length ?? 0, capReached: Boolean(pages.stats?.capReached) },
    issues: { total: issues.filter((i) => i.status === 'fail').length, critical: sev('critical'), serious: sev('serious'), moderate: sev('moderate'), minor: sev('minor') },
    review_items: issues.filter((i) => i.status === 'needs_review').length,
    criteria: { fail: st('fail'), needs_review: st('needs_review'), pass: st('pass'), not_applicable: st('not_applicable'), not_tested: st('not_tested') },
    files: { pdf: p.pdf, html: p.html, csv: fs.existsSync(p.csv) ? p.csv : null, xlsx: fs.existsSync(p.xlsx) ? p.xlsx : null, published: run.published?.file ?? null },
    review: verdict ? { round: verdict.round, ready: verdict.ready, counts: verdict.counts, not_ready_because: verdict.not_ready_because, template_defects: verdict.defects.filter((d) => d.cause === 'template').map((d) => ({ page: d.page, check: d.check, evidence: d.evidence })) } : null,
  };
}

export const commands = {
  'redteam-prep': redteamPrep,
  'redteam-context': redteamContextCmd,
  'save-redteam': saveRedteam,
  recheck,
  amend,
  publish,
  summary,
};
