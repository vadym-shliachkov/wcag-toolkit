// The client-readiness gate. A fresh subagent reviews every page of the rendered PDF; this module prepares what it
// sees (page images, text, automated checks, a seeded sample with live re-checks), validates its verdict and
// recomputes readiness itself, so a lenient reviewer cannot wave a report through.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readJson, writeJson, writeText } from './io.mjs';
import { KB_DIR, REFS_DIR } from './paths.mjs';
import { pageTexts, pdfAccessibility } from './pdf-check.mjs';
import { rasterize } from './raster.mjs';
import { readAgent, saveLines, wrCommand } from './context.mjs';
import { layeredTexts } from './text.mjs';
import { recheckIssue } from './recheck.mjs';
import { numberMismatches } from './report-data.mjs';
import { usesLatinScript, loadStrings } from './i18n.mjs';

export const DIMENSIONS = ['accuracy', 'credibility', 'coverage', 'purpose', 'clarity', 'tone', 'layout', 'pdf_accessibility', 'consistency', 'confidentiality', 'fix_mode', 'language'];
const STRICT = ['accuracy', 'credibility', 'confidentiality', 'pdf_accessibility'];
export const MAX_ROUNDS = 3;

const FORBIDDEN = [/\bcompliant\b/i, /\bcompliance\b/i, /\bconform(s|ant)\b/i, /\bcertified\b/i, /\bcertification\b/i, /\baccredited\b/i, /\bfully accessible\b/i, /\b100\s?% accessible\b/i, /\baccessible to everyone\b/i, /\b(meets|passes|satisfies) WCAG\b/i, /\bADA[- ]compliant\b/i, /\bno accessibility (issues|problems)\b/i, /\bguarantee[sd]?\b/i, /\blawsuit/i, /\blegally safe\b/i];
const PLACEHOLDERS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/, /\bTODO\b/, /lorem ipsum/i, /\bAs an AI\b/i, /\{\{[^}]*\}\}/];
const LEAKS = [
  { id: 'SEC-02', re: /\b(localhost|127\.0\.0\.1)(:\d+)?\b/i, what: 'a local server address' },
  { id: 'SEC-02', re: /[A-Z]:\\(Users|Work|Program)/, what: 'a path on the auditor\'s machine' },
  { id: 'SEC-02', re: /(^|\s)\/(Users|home)\/\w+/, what: 'a path on the auditor\'s machine' },
  { id: 'SEC-02', re: /file:\/\//i, what: 'a local file address' },
  { id: 'SEC-01', re: /[?&](token|key|sig|session|code|auth|password)=[^&\s]{6,}/i, what: 'a secret-looking URL parameter' },
  { id: 'SEC-01', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, what: 'a token' },
  { id: 'SEC-04', re: /\b(subagent|orchestrator|claude|codex|gpt-\d|system prompt)\b/i, what: 'tooling internals' },
];

function i18nStrings(lang, runText) {
  const bundled = readJson(path.join(REFS_DIR, 'i18n', `${lang}.json`), null) ?? runText ?? readJson(path.join(REFS_DIR, 'i18n', 'en.json'), {});
  const out = [];
  const walk = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(bundled);
  return out;
}

// Template disclaimers ("This report is not a certification…") contain forbidden words on purpose; remove the exact
// template strings before looking for claims, so only generated text is judged.
function withoutTemplateText(text, strings) {
  let t = text.replace(/\s+/g, ' ');
  for (const s of strings.filter((x) => x.length > 25).sort((a, b) => b.length - a.length)) {
    const plain = s.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim();
    for (const part of plain.split(/(?<=[.!?])\s+/)) if (part.length > 25) t = t.split(part).join(' ');
  }
  return t;
}

// The site's own words, quoted in the report ("WHAT IS LOREM IPSUM?", a video called "OUR FACTORY
// TOUR") and its page titles in the page list, are evidence, not claims or placeholders of the report: they are
// taken out before those rules look at the text. Quotes may run over a line break in the PDF text.
export function withoutSiteWords(text, titles = []) {
  let t = String(text).replace(/["“][^"“”]{1,240}["”]/g, ' ');
  const flat = t.replace(/\s+/g, ' ');
  t = flat;
  for (const title of titles.filter((x) => x && x.length > 8).sort((a, b) => b.length - a.length)) {
    const words = String(title).replace(/\s+/g, ' ').trim();
    if (!words) continue;
    // The PDF breaks long titles at hyphens and spaces ("Hill- Valley"): match the title with any spacing.
    const re = new RegExp(words.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '-\\s?')).join('\\s+'), 'gi');
    t = t.replace(re, ' ');
  }
  return t;
}

export function lintReport(ctx, texts, report) {
  const { run } = ctx;
  const lang = run.options.lang.split('-')[0];
  const defects = [];
  const add = (check, dimension, severity, cause, page, evidence) => defects.push({ check, dimension, severity, cause, page, evidence });
  const strings = i18nStrings(lang, readJson(ctx.p.text(`i18n.${lang}`), null));
  const titles = [...new Set((report.pages ?? []).map((p) => p.title).filter(Boolean))];
  texts.forEach((raw, i) => {
    const page = i + 1;
    const generated = withoutSiteWords(withoutTemplateText(raw, strings), titles);
    for (const re of FORBIDDEN) {
      const m = re.exec(generated);
      if (m) add('CRED-01', 'credibility', 'blocker', 'content', page, `Claim word "${m[0]}": …${generated.slice(Math.max(0, m.index - 60), m.index + 60)}…`);
    }
    const ownText = withoutSiteWords(raw, titles);
    for (const re of PLACEHOLDERS) {
      const m = re.exec(ownText);
      if (m) add('TON-04', 'tone', 'blocker', 'template', page, `Placeholder text "${m[0]}": …${raw.slice(Math.max(0, m.index - 50), m.index + 50)}…`);
    }
    for (const l of LEAKS) {
      const m = l.re.exec(raw);
      if (m) add(l.id, 'confidentiality', 'blocker', 'content', page, `${l.what}: "${m[0]}"`);
    }
    // Only for a report in a Latin-script language: in a report in Ukrainian, Cyrillic is the report's own text.
    if (usesLatinScript(lang) && /[\u0400-\u04FF]{4,}/.test(generated)) {
      const m = /[\u0400-\u04FF][\u0400-\u04FF\s]{3,}/.exec(generated);
      add('LNG-01', 'language', 'major', 'content', page, `Cyrillic text in a report written in "${lang}": "${m?.[0]}" (fine only if it quotes the site)`);
    }
  });
  // Every finding ID the text cites must still exist: after a merge or removal, prose written earlier (a group
  // summary, a headline) can still point at the old one.
  const known = new Set([...(report.issues ?? []), ...(report.review_items ?? [])].map((x) => x.id));
  const cited = new Map();
  texts.forEach((raw, i) => { for (const m of withoutTemplateText(raw, strings).matchAll(/\b([IR]-\d{2,3})\b/g)) if (!known.has(m[1]) && !cited.has(m[1])) cited.set(m[1], i + 1); });
  for (const g of report.groups ?? []) for (const m of String(g.summary ?? '').matchAll(/\b([IR]-\d{2,3})\b/g)) if (!known.has(m[1]) && !cited.has(m[1])) cited.set(m[1], null);
  for (const [id, page] of cited) add('CON-02', 'consistency', 'major', 'content', page, `The text cites ${id}, which is not in the report (merged or removed): cite the finding that replaced it, or drop the reference.`);
  const all = texts.join('\n');
  // The summary's own numbers against the data the report was rendered from.
  const totals = { issues: (report.issues ?? []).length, review: (report.review_items ?? []).length, pages: [report.scope?.pages_reviewed, report.scope?.pages_discovered, report.scope?.templates_deep].filter((x) => x != null) };
  for (const msg of numberMismatches(`${report.verdict?.headline ?? ''} ${report.verdict?.summary ?? ''}`, totals)) add('CON-01', 'consistency', 'blocker', 'content', 1, `Summary: ${msg}`);
  // Every issue and item to check must appear in the PDF.
  for (const it of [...(report.issues ?? []), ...(report.review_items ?? [])]) {
    if (!all.includes(it.id)) add('COV-01', 'coverage', 'blocker', 'template', null, `${it.id} does not appear in the PDF text`);
  }
  // Fix blocks appear exactly when --fix was asked for. They are counted by their label in the report's language.
  const fixLabel = loadStrings(run.options.lang, ctx.p.dir).t('issues.fix');
  const fixCount = fixLabel ? all.split(fixLabel).length - 1 : 0;
  if (!run.options.fix && fixCount > 0) add('FIX-01', 'fix_mode', 'blocker', 'template', null, `"${fixLabel}" appears ${fixCount} time(s) but --fix was not requested`);
  if (run.options.fix && fixCount < (report.issues ?? []).length) add('FIX-02', 'fix_mode', 'major', 'content', null, `${fixCount} fix blocks for ${(report.issues ?? []).length} issues`);
  return defects;
}

// Deterministic sample: the authors cannot choose what the reviewer re-checks.
export function drawSample(ctx, report, round) {
  const seed = createHash('sha256').update(`${ctx.id}|${round}`).digest();
  let s = seed.readUInt32BE(0);
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const shuffle = (list) => list.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const issues = report.issues ?? [];
  const picked = new Map();
  const take = (list, n, why) => { for (const i of list) { if (n <= 0) break; if (!picked.has(i.id)) { picked.set(i.id, why); n--; } } };
  take(shuffle(issues.filter((i) => i.severity === 'critical')), 10, 'critical');
  take(shuffle(issues.filter((i) => i.basis === 'ai_review')), 5, 'ai_judged');
  const amended = new Set(readJson(ctx.p.amendments, []).map((a) => a.id));
  take(issues.filter((i) => amended.has(i.id)), 20, 'amended');
  take(shuffle(issues), Math.max(0, Math.min(10, issues.length) - picked.size), 'random');
  take(shuffle(report.review_items ?? []), 2, 'needs_review');
  return [...picked].map(([id, why]) => ({ id, why }));
}

export async function prepRound(ctx, round, { recheck = true } = {}) {
  const { p, run } = ctx;
  if (!fs.existsSync(p.pdf)) throw new Error('No report.pdf yet. Run "render" first.');
  const dir = p.reviewDir(round);
  // Re-check screenshots stay: amendments made before this round cite them as evidence.
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f !== 'recheck') fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const pdfSha = createHash('sha256').update(fs.readFileSync(p.pdf)).digest('hex');
  const report = readJson(p.report);
  const images = await rasterize(p.pdf, path.join(dir, 'pages'));
  const texts = await pageTexts(p.pdf);
  texts.forEach((t, i) => writeText(path.join(dir, 'text', `page-${String(i + 1).padStart(3, '0')}.txt`), `${t}\n`));
  const a11y = await pdfAccessibility(p.pdf, { lang: run.options.lang, title: report.report?.title ?? null });
  writeJson(path.join(dir, 'pdf-a11y.json'), a11y);
  const lint = lintReport(ctx, texts, report);
  // Text lint (word limits, banned phrases) on the layered texts, when the content area's lint is available. Only a
  // missing module is skipped: an error inside the lint would otherwise hide every text defect from this round.
  let lintEntry = null;
  try { ({ lintEntry } = await import('./lint-text.mjs')); } catch (e) { if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  if (lintEntry) {
    const { entries } = layeredTexts(p);
    for (const it of [...(report.issues ?? []), ...(report.review_items ?? [])]) {
      const e = entries[it.key];
      if (!e) continue;
      for (const l of lintEntry(e, { kind: it.status === 'fail' || (report.issues ?? []).includes(it) ? 'issue' : 'review', fix: run.options.fix, lang: run.options.lang })) {
        if (l.severity === 'error') lint.push({ check: 'CLR-02', dimension: 'clarity', severity: 'minor', cause: 'content', page: null, evidence: `${it.id} ${l.field}: ${l.message}` });
      }
    }
  }
  writeJson(path.join(dir, 'lint.json'), { defects: lint });
  const sample = drawSample(ctx, report, round);
  if (recheck) {
    for (const item of sample) {
      if (!item.id.startsWith('I-')) { item.recheck = 'not_run'; continue; }
      const r = await recheckIssue(ctx, item.id, { outDir: path.join(dir, 'recheck') });
      Object.assign(item, r);
    }
  }
  writeJson(path.join(dir, 'sample.json'), sample);
  if (round > 1) {
    const prev = readJson(path.join(p.reviewDir(round - 1), 'verdict.json'), null);
    writeJson(path.join(dir, 'prior.json'), { defects: prev?.defects ?? [] });
  }
  const prep = { round, pdf_sha256: pdfSha, page_count: images.length, pages: images.map((f) => path.relative(dir, f).replace(/\\/g, '/')), lint: lint.length, pdfChecksFailed: a11y.checks.filter((c) => !c.ok).map((c) => c.id), sample: sample.length };
  writeJson(path.join(dir, 'prep.json'), prep);
  return prep;
}

export function redteamContext(ctx, round, save) {
  const { root, id, p } = ctx;
  const dir = p.reviewDir(round);
  const prep = readJson(path.join(dir, 'prep.json'), null);
  if (!prep) throw new Error(`Round ${round} is not prepared. Run "redteam-prep --round ${round}" first.`);
  const cmd = wrCommand('save-redteam', root, id, `--round ${round}`);
  return [
    readAgent('red-team'),
    '',
    '## Inputs for this run',
    '',
    `- Round: ${round} of at most ${MAX_ROUNDS}. PDF SHA-256: ${prep.pdf_sha256}. Page count: ${prep.page_count}.`,
    `- Page images: ${path.join(dir, 'pages')} (page-001.png … page-${String(prep.page_count).padStart(3, '0')}.png)`,
    `- Extracted text per page: ${path.join(dir, 'text')}`,
    `- Report data: ${p.report}`,
    `- Run flags: ${p.run}`,
    `- Automated checks: ${path.join(dir, 'lint.json')} and ${path.join(dir, 'pdf-a11y.json')}`,
    `- Sample to spot-check (re-checks already run; fresh screenshots in ${path.join(dir, 'recheck')}): ${path.join(dir, 'sample.json')}`,
    `- Evidence: ${p.issues}; ${p.observationsDir}; ${p.axeDir}; ${path.join(p.dir, 'deep')}; ${p.collectDir}; ${p.shotsDir}`,
    ...(round > 1 ? [`- Earlier defects: ${path.join(dir, 'prior.json')}; amendments since: ${p.amendments}`] : []),
    `- Knowledge base: ${path.join(KB_DIR, 'criteria')} (<id>.md), ${path.join(KB_DIR, 'guides', 'disputed-advice.md')}, ${path.join(KB_DIR, 'guides', 'thresholds.md')}`,
    `- Severity rules: ${path.join(REFS_DIR, 'severity.md')}`,
    `- Re-check command for up to 3 issues of your own choice: ${wrCommand('recheck', root, id, `--round ${round} --issue <I-NN>`)}`,
    '',
    '## Delivering your result',
    '',
    ...saveLines(cmd, save, `{ "schema": "wcag-report/red-team-verdict@1", "run": "${id}", "round": ${round}, "pdf_sha256": "${prep.pdf_sha256}", … }`, `red team r${round}: NOT READY - 2 blocker, 4 major`, `red team r${round}: invalid — <first error>`),
    '',
  ].join('\n');
}

function score(defects) {
  if (defects.some((d) => d.severity === 'blocker')) return 1;
  const majors = defects.filter((d) => d.severity === 'major').length;
  if (majors >= 2) return 2;
  if (majors === 1) return 3;
  return defects.length ? 4 : 5;
}

export function checkVerdict(ctx, round, v) {
  const errors = [];
  const dir = ctx.p.reviewDir(round);
  const prep = readJson(path.join(dir, 'prep.json'));
  const sample = readJson(path.join(dir, 'sample.json'), []);
  if (!v || typeof v !== 'object') return { errors: ['expected a JSON object'] };
  if (v.pdf_sha256 !== prep.pdf_sha256) errors.push(`pdf_sha256 must be ${prep.pdf_sha256} (the PDF you were given)`);
  if (v.round !== round) errors.push(`round must be ${round}`);
  // pages_seen 0 is the reviewer saying it could not view the page images (red-team.md): the verdict is saved and
  // finalizeVerdict makes the round not ready.
  if (v.pages_seen !== prep.page_count && v.pages_seen !== 0) errors.push(`pages_seen is ${v.pages_seen} but the PDF has ${prep.page_count} pages: look at every page`);
  if (!Array.isArray(v.defects)) errors.push('"defects" must be a list');
  for (const [i, d] of (v.defects ?? []).entries()) {
    if (!DIMENSIONS.includes(d.dimension)) errors.push(`defects[${i}].dimension must be one of ${DIMENSIONS.join(', ')}`);
    if (!['blocker', 'major', 'minor'].includes(d.severity)) errors.push(`defects[${i}].severity must be blocker, major or minor`);
    if (!['content', 'evidence', 'template'].includes(d.cause)) errors.push(`defects[${i}].cause must be content, evidence or template`);
    if (!d.evidence) errors.push(`defects[${i}].evidence: say what you saw`);
  }
  const checked = new Set((v.spot_checks ?? []).map((s) => s.issue_id));
  const missing = sample.filter((s) => !checked.has(s.id)).map((s) => s.id);
  if (missing.length && v.pages_seen !== 0) errors.push(`spot_checks missing for sample items: ${missing.join(', ')}`);
  const tmt = v.two_minute_test;
  if (!tmt || !['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].every((q) => q in tmt)) errors.push('"two_minute_test" needs q1…q7 (an answer or null each)');
  return { errors, prep };
}

// The gate decides, not the reviewer: scores and readiness are recomputed from the defects, plus the automated
// blockers the reviewer did not show to be false alarms.
export function finalizeVerdict(ctx, round, v, prep) {
  const dir = ctx.p.reviewDir(round);
  const lint = readJson(path.join(dir, 'lint.json'), { defects: [] }).defects;
  const a11y = readJson(path.join(dir, 'pdf-a11y.json'), { checks: [] });
  const dismissed = new Set((v.dismissed_automated ?? []).map((d) => d.check));
  const automated = [
    ...lint.filter((d) => d.severity !== 'minor' && !dismissed.has(d.check)),
    ...a11y.checks.filter((c) => !c.ok).map((c) => ({ check: c.id, dimension: 'pdf_accessibility', severity: c.severity, cause: 'template', page: null, evidence: c.message })),
  ].map((d, i) => ({ id: `AUTO-${String(i + 1).padStart(3, '0')}`, ...d, automated: true }));
  const defects = [...(v.defects ?? []), ...automated];
  const scores = Object.fromEntries(DIMENSIONS.map((dim) => [dim, v.pages_seen === 0 ? 0 : score(defects.filter((d) => d.dimension === dim))]));
  const blockers = defects.filter((d) => d.severity === 'blocker');
  const majors = defects.filter((d) => d.severity === 'major');
  const reasons = [];
  if (v.pages_seen !== prep.page_count) reasons.push('not every page was reviewed');
  if (blockers.length) reasons.push(`${blockers.length} blocker(s)`);
  if (majors.length > 3) reasons.push(`${majors.length} majors (at most 3 allowed)`);
  const strictMajors = majors.filter((d) => STRICT.includes(d.dimension));
  if (strictMajors.length) reasons.push(`major defect(s) in ${[...new Set(strictMajors.map((d) => d.dimension))].join(', ')}`);
  const tmt = v.two_minute_test ?? {};
  const unanswered = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].filter((q) => tmt[q] == null);
  if (unanswered.length) reasons.push(`two-minute test unanswered: ${unanswered.join(', ')}`);
  const ready = reasons.length === 0;
  return {
    ...v,
    defects,
    scores,
    ready,
    reviewer_ready: v.ready,
    not_ready_because: reasons,
    counts: { blocker: blockers.length, major: majors.length, minor: defects.length - blockers.length - majors.length },
    two_minute_test: { ...tmt, passed: unanswered.length === 0 },
    saved_at: new Date().toISOString(),
  };
}

export function statusLine(v) {
  return `red team r${v.round}: ${v.ready ? 'READY' : 'NOT READY'} - ${v.counts.blocker} blocker, ${v.counts.major} major, ${v.counts.minor} minor`;
}
