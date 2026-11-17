// Writers turn merged issues into owner-facing text, the editor makes the whole report read as one voice, and the
// fixer applies the red team's content corrections. Text is layered: write → edit → fix-1 → fix-2; later layers
// only override fields, so every change stays traceable.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, listFiles } from './io.mjs';
import { REFS_DIR, KB_DIR } from './paths.mjs';
import { criterion, cardPath } from './criteria.mjs';
import { readAgent, readRef, saveLines, wrCommand, fenceJson, inboxFile } from './context.mjs';
import { publicPath } from './report-paths.mjs';
import { isReviewed, pagesFound } from './merge.mjs';

export const BATCH_SIZE = 8;
export const GROUP_IDS = ['screen_reader', 'low_vision', 'colour', 'deaf', 'keyboard', 'dexterity', 'cognitive', 'seizure_motion'];
const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];
const ISSUE_FIELDS = ['title', 'where', 'observed', 'cause', 'severity_reason', 'component_label'];
const REVIEW_FIELDS = ['title', 'where', 'observed', 'why_uncertain', 'what_to_check'];
const EDITOR_FIELDS = ['verdict_headline', 'summary', 'journeys_note'];

async function lintModule() {
  try { return await import('./lint-text.mjs'); } catch { return null; }
}

export function batches(issues, ctx) {
  const ordered = [...issues.filter((i) => i.status === 'fail'), ...issues.filter((i) => i.status === 'needs_review')];
  if (!ctx) {
    const out = [];
    for (let i = 0; i < ordered.length; i += BATCH_SIZE) out.push(ordered.slice(i, i + BATCH_SIZE));
    return out;
  }
  // Batches are cut once and kept (text/batches.json): a finding amended away while writers are at work only leaves
  // its own batch, instead of shifting every later batch so that a writer's input no longer matches what is checked.
  // Findings that appear later (a restored one) go into extra batches at the end.
  const file = ctx.p.text('batches');
  const live = new Map(ordered.map((i) => [i.key, i]));
  let keys = readJson(file, null);
  if (!Array.isArray(keys)) {
    keys = [];
    for (let i = 0; i < ordered.length; i += BATCH_SIZE) keys.push(ordered.slice(i, i + BATCH_SIZE).map((x) => x.key));
    writeJson(file, keys);
  }
  const placed = new Set(keys.flat());
  const extra = ordered.filter((i) => !placed.has(i.key)).map((i) => i.key);
  if (extra.length) {
    for (let i = 0; i < extra.length; i += BATCH_SIZE) keys.push(extra.slice(i, i + BATCH_SIZE));
    writeJson(file, keys);
  }
  return keys.map((list) => list.map((k) => live.get(k)).filter(Boolean));
}

// What a writer needs about one issue, without selectors noise beyond a few examples.
function writerInput(issue, ctx) {
  const pages = readJson(ctx.p.pages).pages;
  const templates = readJson(ctx.p.templates).templates;
  const base = ctx.run.target.baseUrl;
  const c = criterion(issue.criteria.primary);
  return {
    key: issue.key,
    id: issue.id,
    status: issue.status,
    severity: issue.severity,
    severity_basis: issue.severityBasis,
    criterion: { id: c?.id, name: c?.name, level: c?.level, plain: c?.plain, card: cardPath(c?.id), patterns: c?.examples ?? [] },
    related: issue.criteria.related.map((r) => `${r} ${criterion(r)?.name ?? ''}`.trim()),
    check: issue.check,
    method: issue.method,
    scope: issue.scope,
    reach: issue.reach,
    page_types: issue.templates.map((t) => templates.find((x) => x.id === t)?.name).filter(Boolean),
    example_paths: [...new Set(issue.instances.map((x) => publicPath(x.url, base)))].slice(0, 5),
    journeys: issue.journeys,
    baseline_groups: c?.groups ?? [],
    observed_facts: issue.observed,
    measured: issue.measured,
    questions: issue.question,
    third_party: issue.thirdParty,
    examples: issue.instances.slice(0, 4).map((x) => ({ page: publicPath(x.url, base), state: x.state, html: x.html ? String(x.html).slice(0, 300) : null, observed: x.observed })),
    // Each screenshot with the page and state it shows, so the caption describes that picture and no other.
    screenshots: issue.shots.map((s) => ({ file: path.join(ctx.p.dir, s.file), page: publicPath(s.url, base) || null, state: s.state ?? 'default', kind: s.kind ?? 'crop', pair: s.pair?.label ?? null })),
    page_titles: [...new Set(issue.instances.map((x) => pages.find((p) => p.id === x.pageId)?.title).filter(Boolean))].slice(0, 3),
    // The judge's exact replacements, shown on the card as "Recommended"; the text must agree with them.
    suggestions: [...new Set(issue.instances.map((x) => x.suggestion).filter((v) => v != null))].slice(0, 20),
    confidence: issue.confidence ?? 'high',
    confidence_note: issue.confidenceNote ?? null,
  };
}

export function textContext(ctx, { stage, batch, round, save }) {
  const { root, id, p, run } = ctx;
  const lang = run.options.lang;
  const fix = run.options.fix;
  const issues = readJson(p.issues);
  const cmdFor = (extra) => wrCommand('save-text', root, id, extra);
  const common = [
    readAgent('_contract'),
    '',
  ];
  const facts = [
    `- Report language: ${lang} (write every reader-facing field in this language; keep on-screen text quoted exactly as the site shows it)`,
    `- Fix instructions in the client's report (--fix): ${fix ? 'yes' : 'no'}. Write the "fix" block for every confirmed problem either way: it always goes to the developers' work list (findings.csv); the report prints it only with --fix`,
    `- WCAG 2.2, profile ${run.options.level}`,
    `- Site: ${run.target.name || run.target.url || run.target.repoName}`,
    `- Style card: ${path.join(REFS_DIR, 'style-card.md')} (read it first; it is binding)`,
    `- Disability groups and assistive tools: ${path.join(REFS_DIR, 'groups.json')}`,
    `- Criteria in plain words: ${path.join(REFS_DIR, 'criteria-plain.en.json')}`,
    `- Disputed advice: ${path.join(KB_DIR, 'guides', 'disputed-advice.md')}`,
  ];
  if (stage === 'write') {
    const list = batches(issues, ctx);
    const n = Number(batch);
    if (!Number.isInteger(n) || n < 1 || n > list.length) throw new Error(`--batch must be 1…${list.length}`);
    const input = list[n - 1].map((i) => writerInput(i, ctx));
    const inputFile = p.text(`write-${n}-input`);
    writeJson(inputFile, input);
    return [
      ...common,
      readAgent('writer'),
      '',
      '## Inputs for this run',
      '',
      ...facts,
      `- Your batch: ${n} of ${list.length}, ${input.length} entries: ${inputFile}`,
      '',
      '## Delivering your result',
      '',
      ...saveLines(cmdFor(`--stage write --batch ${n}`), save, `{ "batch": ${n}, "entries": [ ... ] }`, `write ${n}: ok, ${input.length} entries`, `write ${n}: invalid — <first error>`, inboxFile(p, `write-${n}`)),
      '',
    ].join('\n');
  }
  if (stage === 'edit') {
    const texts = layeredTexts(p, { upTo: 'write' });
    const summary = editorInput(ctx, issues, texts);
    const inputFile = p.text('edit-input');
    writeJson(inputFile, summary);
    return [
      ...common,
      readAgent('editor'),
      '',
      '## Inputs for this run',
      '',
      ...facts,
      `- All entries written so far, with totals, groups and key tasks: ${inputFile}`,
      '',
      '## Delivering your result',
      '',
      ...saveLines(cmdFor('--stage edit'), save, '{ "verdict_headline": "…", "summary": "…", "groups_summary": { … }, "journeys_note": "…", "glossary": [ … ], "edits": [ … ], "review": { … } }', 'edit: ok, 6 edits, readable', 'edit: invalid — <first error>', inboxFile(p, 'edit')),
      '',
    ].join('\n');
  }
  if (stage === 'fix') {
    const r = Number(round);
    // After a review, its verdict; before one, the automated checks of the prepared round (cheaper to fix first).
    const verdict = readJson(path.join(p.reviewDir(r), 'verdict.json'), null) ?? readJson(path.join(p.reviewDir(r), 'lint.json'), null);
    if (!verdict) throw new Error(`Round ${r} has neither a red-team verdict nor prepared checks.`);
    // Content defects, and evidence defects that no re-check settled (no amendment of their findings since the
    // verdict): those are statements the reviewer showed to be wrong, which only the wording can correct.
    const amendedSince = new Set(readJson(p.amendments, []).filter((a) => !verdict.saved_at || a.at > verdict.saved_at).flatMap((a) => [a.id, a.into, a.newId]).filter(Boolean));
    const byId = new Map(issues.map((i) => [i.id, i]));
    const unsettled = (d) => d.cause === 'evidence' && (d.issue_ids ?? []).length > 0 && d.issue_ids.every((id) => byId.has(id) && !amendedSince.has(id));
    const defects = verdict.defects.filter((d) => d.cause === 'content' || unsettled(d)).map((d) => (d.cause === 'evidence' ? { ...d, routed: 'wording' } : d));
    // Findings removed, merged or restored since the texts were written (by amend, or by judges run again and a new
    // merge): the summary, the verdict and every list of findings still count and cite the old set, so the fixer gets
    // the current one to correct them against.
    const written = readJson(p.text('findings-sig'), null)?.sig;
    if (amendedSince.size || (written != null && written !== findingsSig(issues))) {
      const fails = issues.filter((i) => i.status === 'fail');
      const list = issues.map((i) => `${i.id} (${i.criteria.primary}, ${i.instanceCount} place${i.instanceCount === 1 ? '' : 's'})`).join('; ');
      defects.push({ check: 'CON-01', dimension: 'consistency', severity: 'blocker', cause: 'content', page: null, routed: 'findings_changed', issue_ids: issues.map((i) => i.id),
        evidence: `The findings changed after these texts were written. The report now has ${fails.length} problem(s) and ${issues.length - fails.length} item(s) to check: ${list}. Every count, list and ID in the verdict, the summary, the group and journey notes and the entries must match this set; an ID not in it no longer exists.` });
    }
    // Findings amended since they were written (a problem turned into an item to check) need a whole new entry.
    const current = layeredTexts(p, { skipFix: r }).entries;
    const stale = issues.filter((i) => isStale(i, current) || i.rewrittenInFix === r).map((i) => writerInput(i, ctx));
    const inputFile = p.text(`fix-${r}-input`);
    writeJson(inputFile, { defects, stale, texts: layeredTexts(p) });
    return [
      ...common,
      readAgent('fixer'),
      '',
      '## Inputs for this run',
      '',
      ...facts,
      `- Defects to correct (${defects.length}) and the current texts: ${inputFile}`,
      '',
      '## Delivering your result',
      '',
      ...saveLines(cmdFor(`--stage fix --round ${r}`), save, `{ "round": ${r}, "edits": [ ... ], "not_fixed": [ ... ] }`, `fix ${r}: ok, 5 edits`, `fix ${r}: invalid — <first error>`, inboxFile(p, `fix-${r}`)),
      '',
    ].join('\n');
  }
  throw new Error('--stage must be write, edit or fix');
}

function editorInput(ctx, issues, texts) {
  const fails = issues.filter((i) => i.status === 'fail');
  const reviews = issues.filter((i) => i.status === 'needs_review');
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, fails.filter((i) => i.severity === s).length]));
  const pages = readJson(ctx.p.pages);
  return {
    totals: { issues: counts, review_items: reviews.length, pages_reviewed: pages.pages.filter(isReviewed).length, pages_found: pagesFound(pages, (u) => publicPath(u, ctx.run.target.baseUrl)), pages_deep: readJson(ctx.p.templates, { templates: [] }).templates.filter((x) => x.deep).length },
    criteria: readJson(ctx.p.criteriaStatus, []).filter((c) => c.in_profile).map((c) => ({ id: c.id, status: c.status })),
    journeys: readJson(ctx.p.dir + '/journeys.json', []),
    entries: issues.map((i) => ({ id: i.id, key: i.key, status: i.status, severity: i.severity, criterion: i.criteria.primary, reach: i.reach, ...texts.entries[i.key] })),
  };
}

// Fix layers in the order they were saved: by round as a number (fix-10 after fix-2), and within a round the earlier
// saves fix-<round>-<k> by k before the round's latest fix-<round>.
function byFixRound(a, b) {
  const order = (f) => {
    const m = path.basename(f).match(/^fix-(\d+)(?:-(\d+))?\.json$/);
    return [Number(m[1]), m[2] == null ? Number.MAX_SAFE_INTEGER : Number(m[2])];
  };
  const [x, y] = [order(a), order(b)];
  return x[0] - y[0] || x[1] - y[1];
}

// Texts as the report will use them: writer entries, then editor and fixer overrides in order.
// skipFix: leave out one fix round's own layer, to judge that round's edits against the texts it started from.
export function layeredTexts(p, { upTo, skipFix } = {}) {
  const entries = {};
  for (const f of listFiles(p.textDir, /^write-\d+\.json$/)) {
    for (const e of readJson(f).entries ?? []) entries[e.key] = e;
  }
  const report = {};
  if (upTo === 'write') return { entries, report };
  // upTo 'edit' stops before the fixer layers, also when the editor saved nothing.
  const fixes = upTo === 'edit' ? [] : listFiles(p.textDir, /^fix-\d+(-\d+)?\.json$/).filter((f) => skipFix == null || path.resolve(f) !== path.resolve(p.text(`fix-${skipFix}`))).sort(byFixRound);
  for (const file of [p.text('edit'), ...fixes]) {
    const layer = readJson(file, null);
    if (!layer) continue;
    for (const k of [...EDITOR_FIELDS, 'groups_summary', 'glossary']) if (layer[k] != null) report[k] = layer[k];
    for (const e of layer.edits ?? []) applyEdit(entries, report, e);
  }
  return { entries, report };
}

// Confirmed problems whose text has no fix block. Saving now requires one, so only texts written by an older version
// of the skill lack it; findings.csv would have no fix for them, so their writers must run again.
export function entriesWithoutFix(p, issues) {
  const { entries } = layeredTexts(p);
  return issues.filter((i) => i.status === 'fail' && entries[i.key] && !entries[i.key].fix?.steps?.length).map((i) => i.id);
}

function setPath(obj, field, value) {
  const parts = String(field).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[k];
  }
  const last = /^\d+$/.test(parts.at(-1)) ? Number(parts.at(-1)) : parts.at(-1);
  cur[last] = value;
}

function applyEdit(entries, report, e) {
  if (e.key === '_report') setPath(report, e.field, e.value);
  else if (e.field === '_entry') entries[e.key] = { ...e.value, key: e.key };
  else if (entries[e.key]) setPath(entries[e.key], e.field, e.value);
}

function validateEntry(e, issue, { fix }) {
  const errs = [];
  const at = `entry ${e.key}`;
  const fields = issue.status === 'fail' ? ISSUE_FIELDS : REVIEW_FIELDS;
  for (const f of fields) if (typeof e[f] !== 'string' || !e[f].trim()) errs.push(`${at}: "${f}" is required`);
  if (issue.status === 'fail') {
    if (!Array.isArray(e.impacts) || e.impacts.length < 1 || e.impacts.length > 4) errs.push(`${at}: "impacts" needs 1–4 groups`);
    for (const [i, im] of (e.impacts ?? []).entries()) {
      if (!GROUP_IDS.includes(im.group)) errs.push(`${at}.impacts[${i}].group must be one of ${GROUP_IDS.join(', ')}`);
      if (!['blocks', 'harder'].includes(im.level)) errs.push(`${at}.impacts[${i}].level must be blocks or harder`);
      if (typeof im.text !== 'string' || !im.text.trim()) errs.push(`${at}.impacts[${i}].text is required`);
    }
    // Always written: the developers' work list (findings.csv) carries it on every run. --fix only decides whether
    // the client's report prints it.
    if (!e.fix || !Array.isArray(e.fix.steps) || !e.fix.steps.length) errs.push(`${at}: "fix" with 1–3 steps is required (it goes to the developers' work list; the report shows it only with --fix)`);
    if (e.fix && !String(e.fix.dev_note ?? '').trim()) errs.push(`${at}.fix.dev_note is required: the technical change (element or selector, attribute or CSS property, target value)`);
    if (e.fix && e.fix.steps?.length > 3) errs.push(`${at}.fix.steps: at most 3 steps`);
  } else {
    const ic = e.if_confirmed;
    if (!ic || !SEVERITIES.includes(ic.severity) || !Array.isArray(ic.groups) || ic.groups.some((g) => !GROUP_IDS.includes(g))) errs.push(`${at}: "if_confirmed" needs a severity and valid group ids`);
    if (e.fix) errs.push(`${at}: items to check never have a fix block`);
  }
  if ((issue.shots ?? []).length) {
    if (!Array.isArray(e.shots) || e.shots.length !== issue.shots.length) errs.push(`${at}: "shots" needs one {alt, caption} per screenshot (${issue.shots.length})`);
    for (const [i, s] of (e.shots ?? []).entries()) if (!s?.alt || !s?.caption) errs.push(`${at}.shots[${i}] needs alt and caption`);
  }
  return errs;
}

export async function validateTexts(ctx, stage, data, { batch, round } = {}) {
  // Like textContext: a stage with no rules is refused, not passed unchecked.
  if (!['write', 'edit', 'fix'].includes(stage)) throw new Error('--stage must be write, edit or fix');
  const { p, run } = ctx;
  const issues = readJson(p.issues);
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const lint = await lintModule();
  const errors = [];
  const warnings = [];
  // Every confirmed problem carries a fix block (for findings.csv), so it is always linted as one.
  const lintOpts = { fix: true, lang: run.options.lang };
  const pushLint = (list) => {
    for (const l of list) (l.severity === 'error' ? errors : warnings).push(`${l.key ?? ''} ${l.field ?? ''}: ${l.message} [${l.rule}]`.trim());
  };
  if (stage === 'write') {
    const want = batches(issues, ctx)[Number(batch) - 1]?.map((i) => i.key) ?? [];
    if (!Array.isArray(data.entries)) return { errors: ['expected { "batch": n, "entries": [ … ] }'], warnings };
    const got = data.entries.map((e) => e.key);
    for (const k of want) if (!got.includes(k)) errors.push(`missing entry for ${k}`);
    for (const k of got) if (!want.includes(k)) errors.push(`entry ${k} is not in batch ${batch}`);
    for (const e of data.entries) {
      const issue = byKey.get(e.key);
      if (!issue) continue;
      errors.push(...validateEntry(e, issue, { fix: run.options.fix }));
      if (lint) pushLint(lint.lintEntry({ ...e }, { kind: issue.status === 'fail' ? 'issue' : 'review', ...lintOpts }).map((l) => ({ key: e.key, ...l })));
    }
  } else if (stage === 'edit') {
    for (const f of ['verdict_headline', 'summary']) if (typeof data[f] !== 'string' || !data[f].trim()) errors.push(`"${f}" is required`);
    if (data.groups_summary && typeof data.groups_summary !== 'object') errors.push('"groups_summary" must be an object keyed by group id');
    for (const g of Object.keys(data.groups_summary ?? {})) if (!GROUP_IDS.includes(g)) errors.push(`groups_summary: unknown group "${g}"`);
    if (!Array.isArray(data.glossary)) errors.push('"glossary" must be a list of { term, meaning }');
    if (!data.review || typeof data.review.readable !== 'boolean') errors.push('"review": { "readable": true|false, "notes": [ … ] } is required');
    for (const [i, e] of (data.edits ?? []).entries()) {
      if (e.key !== '_report' && !byKey.has(e.key)) errors.push(`edits[${i}]: unknown key "${e.key}"`);
      if (!e.field || e.value == null) errors.push(`edits[${i}] needs field and value`);
    }
    const tot = editorInput(ctx, issues, layeredTexts(p, { upTo: 'write' })).totals;
    const { numberMismatches } = await import('./report-data.mjs');
    const claims = numberMismatches(`${data.verdict_headline ?? ''} ${data.summary ?? ''}`, { issues: Object.values(tot.issues).reduce((a, b) => a + b, 0), review: tot.review_items, pages: [tot.pages_reviewed, tot.pages_found, tot.pages_deep].filter((v) => v != null) });
    for (const c of claims) errors.push(`summary: ${c}`);
    if (lint?.lintReportTexts) pushLint(lint.lintReportTexts({ verdict_headline: data.verdict_headline, summary: data.summary, groups_summary: data.groups_summary }, lintOpts));
  } else if (stage === 'fix') {
    if (!Array.isArray(data.edits)) errors.push('expected { "round": n, "edits": [ … ] }');
    // Judged against the texts before this round's own edits: saving a round clears the flags of the entries it
    // rewrote, and a re-validation of the saved round must reach the same answer as the check before saving.
    const current = layeredTexts(p, { skipFix: round }).entries;
    // The entries this round was asked to rewrite are those its context listed (fix-<round>-input.json).
    const listed = new Set((readJson(p.text(`fix-${round}-input`), {}).stale ?? []).map((x) => x.key));
    const needsEntry = (issue) => listed.has(issue.key) || isStale(issue, current) || issue.rewrittenInFix === Number(round);
    for (const [i, e] of (data.edits ?? []).entries()) {
      if (e.key !== '_report' && !byKey.has(e.key)) errors.push(`edits[${i}]: unknown key "${e.key}"`);
      if (!e.field || e.value == null) errors.push(`edits[${i}] needs field and value`);
      if (/^(severity|status|criteria|key|id)$/.test(e.field)) errors.push(`edits[${i}]: "${e.field}" is not text — a finding's status or severity changes only through "amend" with evidence`);
      if (e.field === '_entry') {
        const issue = byKey.get(e.key);
        if (!issue || !needsEntry(issue)) errors.push(`edits[${i}]: "_entry" replaces a whole entry and is only for the findings listed as needing a new entry (amended, new screenshots, or no text yet); use field edits for ${byKey.get(e.key)?.id ?? e.key}`);
        else errors.push(...validateEntry({ ...e.value, key: e.key }, issue, { fix: run.options.fix }));
      }
    }
    for (const i of issues.filter(needsEntry)) {
      if (!(data.edits ?? []).some((e) => e.key === i.key && e.field === '_entry')) errors.push(`${i.id} ${staleReason(i, current)}: give its whole new entry as { "key": "${i.key}", "field": "_entry", "value": { … } }`);
    }
  }
  return { errors, warnings };
}

// An entry no longer fits its finding when the finding was amended, has no text yet, or its screenshots changed
// (alt text and captions describe specific pictures).
export function isStale(issue, entries) {
  const e = entries[issue.key];
  return Boolean(issue.textStale) || !e || (e.shots?.length ?? 0) !== Math.min(issue.shots?.length ?? 0, issue.status === 'fail' ? 99 : 1) && (e.shots?.length ?? 0) !== (issue.shots?.length ?? 0);
}

// Why isStale() is true, in the words of a validation error.
export function staleReason(issue, entries) {
  if (!entries[issue.key]) return 'has no text yet';
  if (issue.textStale && issue.amended) return `was amended to ${issue.status}`;
  return 'has new screenshots, so its alt text and captions no longer match';
}

export function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

export function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// The set of findings a summary was written against: which findings, their status and how many places each has.
export const findingsSig = (issues) => issues.map((i) => `${i.key}:${i.status}:${i.instanceCount}`).sort().join('|');

export function saveTexts(ctx, stage, data, { batch, round }) {
  const { p, run } = ctx;
  if (stage === 'write') {
    writeJson(p.text(`write-${batch}`), data);
    // Freshly written entries fit their findings and pictures again.
    const written = new Set((data.entries ?? []).map((e) => e.key));
    const issues = readJson(p.issues);
    if (issues.some((i) => written.has(i.key) && i.textStale)) {
      for (const i of issues) if (written.has(i.key)) delete i.textStale;
      writeJson(p.issues, issues);
    }
  }
  else if (stage === 'edit') {
    writeJson(p.text('edit'), data);
    writeJson(p.text('findings-sig'), { sig: findingsSig(readJson(p.issues)) });
  } else {
    writeJson(p.text('findings-sig'), { sig: findingsSig(readJson(p.issues)) });
    // A round can be fixed twice: before its review (lint) and after the previous round's verdict. The earlier save
    // is kept as fix-<round>-<k>, still applied before the new one.
    if (fs.existsSync(p.text(`fix-${round}`))) {
      let k = 1;
      while (fs.existsSync(p.text(`fix-${round}-${k}`))) k += 1;
      fs.renameSync(p.text(`fix-${round}`), p.text(`fix-${round}-${k}`));
    }
    writeJson(p.text(`fix-${round}`), data);
    const replaced = new Set((data.edits ?? []).filter((e) => e.field === '_entry').map((e) => e.key));
    if (replaced.size) {
      const issues = readJson(p.issues);
      for (const i of issues) if (replaced.has(i.key)) { delete i.textStale; i.rewrittenInFix = Number(round); }
      writeJson(p.issues, issues);
    }
  }
}
