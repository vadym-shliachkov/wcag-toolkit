// Judges are subagents that review what automation cannot decide (alt text meaning, link purpose, headings,
// consistency…). They reply in a slim format; this module turns it into knowledge-base observations and refuses
// anything a judge cannot prove: a fail must quote text that really is in the collected data.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { REFS_DIR, KB_DIR } from './paths.mjs';
import { criterion, inProfile, cardPath, criterionFailures } from './criteria.mjs';
import { signalToObservation, checkObservation } from './observations.mjs';
import { readAgent, saveLines, wrCommand, fenceJson } from './context.mjs';
import { isReviewed } from './merge.mjs';
import { plainSuggestion } from './dedupe.mjs';

export const CONSISTENCY_SCS = ['2.4.5', '3.2.3', '3.2.4', '3.2.6'];
const NEEDS_PERSON = ['owner_knowledge', 'needs_playback', 'needs_login', 'would_send_data', 'outside_site'];
const STATUSES = ['fail', 'needs_review', 'pass', 'not_applicable'];
const BARRIERS = ['blocker', 'major', 'minor'];

function coverage() {
  return readJson(path.join(REFS_DIR, 'coverage.json'), {});
}

export function judgeCriteria(level, { consistency }) {
  const cov = coverage();
  return Object.entries(cov)
    .filter(([sc, c]) => c.judge && inProfile(sc, level) && (consistency ? CONSISTENCY_SCS.includes(sc) : !CONSISTENCY_SCS.includes(sc)))
    .map(([sc, c]) => {
      const failures = criterionFailures(sc);
      return {
        sc, name: criterion(sc)?.name, level: criterion(sc)?.level, topic: c.judge, card: cardPath(sc),
        // The documented failures the judge decides, and those the measurements already decide.
        failures: failures.filter((f) => f.by.includes('judge')),
        settled: failures.filter((f) => !f.by.includes('judge') && !f.by.includes('aaa-not-tested')),
      };
    });
}

// The W3C test procedure of every failure a judge decides, in one file per judge: judges whose contexts are built
// at the same time must not overwrite each other's (the consistency judge decides other criteria).
function writeFailureGuide(dir, criteria, name) {
  const lines = ['# Documented failures to decide', '', 'From W3C "Techniques for WCAG 2.2". For each failure: the test procedure, and what this review collects for it.', ''];
  for (const c of criteria) {
    if (!c.failures.length) continue;
    lines.push(`## ${c.sc} ${c.name}`, '');
    for (const f of c.failures) {
      lines.push(`### ${f.id}: ${f.title}`, '', `Test procedure: ${f.procedure || '(none published)'}`, '');
      if (f.how) lines.push(`How this review covers it: ${f.how}`, '');
    }
  }
  const file = path.join(dir, `judge-failures-${name}.md`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}

// Up to 5 pages per template: the representative first, then the most different others (by title), so the judge
// sees variety rather than five near-copies.
export function samplePages(template, pages, n = 5) {
  const own = pages.filter((p) => template.pageIds.includes(p.id) && isReviewed(p));
  const rep = own.find((p) => p.id === template.representative) ?? own[0];
  const rest = own.filter((p) => p !== rep);
  const step = Math.max(1, Math.floor(rest.length / (n - 1)));
  return [rep, ...rest.filter((_, i) => i % step === 0)].filter(Boolean).slice(0, n);
}

function automatedSummary(ctx, pageIds) {
  const signals = readJson(ctx.p.signals, { signals: [] }).signals;
  const counts = {};
  for (const s of signals) {
    if (!pageIds.includes(s.pageId) || s.status === 'pass') continue;
    const k = `${s.check} (${s.sc.join(', ')}, ${s.status})`;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `- ${k}: ${n}`);
}

export function judgeContext(ctx, { template: tid, consistency, save }) {
  const { root, id, p, run } = ctx;
  const level = run.options.level;
  const pages = readJson(p.pages).pages;
  const templates = readJson(p.templates).templates;
  const criteria = judgeCriteria(level, { consistency });
  // The automated checks decide every criterion of this judge: there is nothing to start a subagent for.
  if (!criteria.length) return `Nothing to judge: the measurements decide every criterion of the ${consistency ? 'consistency' : `${tid}`} judge. Do not start this judge.`;
  const shots = readJson(p.shotsIndex, { templates: {} });
  let scope;
  let sample;
  if (consistency) {
    sample = templates.map((t) => pages.find((x) => x.id === t.representative)).filter(Boolean);
    scope = [`- Scope: consistency across ${templates.length} page types. One representative page per type:`];
  } else {
    const t = templates.find((x) => x.id === tid);
    if (!t) throw new Error(`Unknown template "${tid}". Known: ${templates.map((x) => x.id).join(', ')}`);
    sample = samplePages(t, pages);
    scope = [`- Scope: page type ${t.id} "${t.name}" (${t.kind}), ${t.pageIds.length} page(s). ${sample.length < t.pageIds.length ? `Review this sample of ${sample.length}; the measurements cover the others` : 'Pages to review'}:`];
  }
  const name = consistency ? 'consistency' : tid;
  const cmd = wrCommand('save-judge', root, id, consistency ? '--consistency' : `--template ${tid}`);
  const shotLines = Object.entries(shots.templates ?? {})
    .filter(([t]) => consistency || t === tid)
    .flatMap(([t, s]) => Object.entries(s)
      .filter(([, f]) => typeof f === 'string' && /\.(jpe?g|png|webp)$/i.test(f))
      .map(([k, f]) => `- Screenshot ${t} ${k}: ${path.join(p.dir, f)}`));
  // The same picture file on other pages (other page types are judged by other judges): it gets one decision.
  const pagesBySrc = new Map();
  for (const [pid, list] of Object.entries(shots.images ?? {})) for (const im of list) if (im.src) pagesBySrc.set(im.src, [...new Set([...(pagesBySrc.get(im.src) ?? []), pid])]);
  const imageLines = consistency ? [] : sample.flatMap((s) => (shots.images?.[s.id] ?? []).map((im) => {
    const others = (pagesBySrc.get(im.src) ?? []).filter((x) => x !== s.id);
    const around = im.caption != null
      ? `${im.caption ? `visible caption (figcaption): "${im.caption}"` : 'no caption'}${im.heading ? `; section heading: "${im.heading}"` : ''}${!im.caption && im.near ? `; text around it: "${im.near}"` : ''}`
      : `text around it: "${im.near}"`;
    return `- Image ${s.id}: ${path.join(p.dir, im.file)} — ${im.alt === null ? 'NO alt attribute' : `alt="${im.alt}"`}${im.ariaLabel ? `, aria-label="${im.ariaLabel}"` : ''}${im.ariaHidden ? ', hidden from assistive technology' : ''}${im.inLink ? `, inside a link or button whose text is "${im.inLink}"` : ''}; file ${im.src}${others.length ? ` (the same file is also on ${others.slice(0, 6).join(', ')})` : ''}; ${around}; selector ${im.selector}`;
  }));
  const deepLines = consistency ? [] : fs.existsSync(p.deepDir(tid))
    ? fs.readdirSync(p.deepDir(tid)).filter((f) => f.endsWith('.json')).map((f) => `- Deep check result: ${path.join(p.deepDir(tid), f)}`)
    : ['- No deep check results for this page type.'];
  const failureGuide = writeFailureGuide(p.dir, criteria, name);
  const cut = (t) => (t.length > 90 ? `${t.slice(0, 89)}…` : t);
  const criterionLines = criteria.flatMap((c) => [
    `- **${c.sc} ${c.name}** (Level ${c.level}) — look at: ${c.topic}. Card: ${c.card}`,
    ...(c.failures.length ? [`  - Documented failures you decide: ${c.failures.map((f) => `${f.id} ${cut(f.title)}`).join('; ')}.`] : []),
    ...(c.settled.length ? [`  - Decided by the measurements (report one only if you see a case they missed): ${c.settled.map((f) => f.id).join(', ')}.`] : []),
  ]);
  return [
    readAgent('_contract'),
    '',
    readAgent(consistency ? 'consistency-judge' : 'judge'),
    '',
    '## Inputs for this run',
    '',
    `- Run: ${id}; WCAG 2.2 profile ${level}; your name for this result: "${name}"`,
    ...scope,
    ...sample.map((s) => `  - ${s.id} ${s.url} — collected data: ${p.collect(s.id)}`),
    ...shotLines,
    ...(imageLines.length ? ['- Close-ups of every image on these pages (look at each one before you judge 1.1.1 or 1.4.5):', ...imageLines.map((l) => `  ${l}`)] : []),
    ...deepLines,
    `- Disputed advice (never a fail on its own): ${path.join(KB_DIR, 'guides', 'disputed-advice.md')}`,
    `- Status rules: ${path.join(KB_DIR, 'guides', 'reporting.md')}`,
    '',
    '### Criteria you judge',
    '',
    'Judge each of these for the pages above, and nothing else. The card explains applicability, the failure condition and the exceptions.',
    `Each documented failure listed under a criterion is a test you run: its W3C test procedure is in ${failureGuide}. A pass lists every one of them in \`failures_checked\`; a fail names the one it matches in \`failure\`.`,
    '',
    ...criterionLines,
    '',
    '### Already found by automated checks on these pages (do not repeat them)',
    '',
    ...(automatedSummary(ctx, sample.map((s) => s.id)).length ? automatedSummary(ctx, sample.map((s) => s.id)) : ['- nothing']),
    '',
    '## Delivering your result',
    '',
    ...saveLines(cmd, save, `{ "judge": "${name}", "observations": [ ... ] }`, `${name}: ok, 3 fail, 2 needs_review, 9 pass`, `${name}: invalid — <first error>`),
    '',
  ].join('\n');
}

function evidenceHasQuote(runDir, file, quote) {
  const abs = path.isAbsolute(file) ? file : path.join(runDir, file);
  if (!fs.existsSync(abs) || !/\.(json|txt|html?)$/.test(abs)) return false;
  const norm = (s) => String(s).replace(/\\"/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(fs.readFileSync(abs, 'utf8')).includes(norm(quote));
}

// A recommended alt text is written to be read aloud next to the rest of the page (W3C images tutorial):
// a screen reader already says "image", so "image of" is noise; one short sentence carries a photo, and more belongs
// in visible text; words the visible caption already gives are heard twice.
const ALT_LEADIN = /^\s*(an?\s+)?(image|photo(graph)?|picture|graphic|illustration|screenshot)\s+(of|showing|shows|depicting)\b/i;
const ALT_MAX = 150;
export function altSuggestionProblems(j, shotsIndex = {}) {
  const s = j.suggestion;
  if (s == null || s === '') return [];
  const out = [];
  if (ALT_LEADIN.test(s)) out.push('starts with "image of" or similar: a screen reader already says it is an image; start with what it shows');
  if (String(s).length > ALT_MAX) out.push(`is ${String(s).length} characters: keep an alt text to one short sentence (at most ${ALT_MAX}); information that needs more belongs in visible text next to the image`);
  const norm = (x) => String(x ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const sel = String(j.selector ?? '');
  const im = (shotsIndex.images?.[j.pageId] ?? []).find((x) => x.selector && sel && (x.selector === sel || x.selector.endsWith(sel) || sel.endsWith(x.selector)));
  const cap = norm(im?.caption);
  // A suggestion that is only a short caption names what the caption names: a portrait's alt is the person's name
  // (judge.md), which is not a repeat to cut.
  const nameOnly = norm(s) === cap && cap.split(' ').length <= 4;
  if (cap.length >= 12 && norm(s).includes(cap) && !nameOnly) out.push(`repeats the visible caption ("${im.caption}"): say only what the caption does not, or recommend "" when the caption already says all that matters`);
  return out;
}

// Paths in judge output may be absolute (as printed in the context) or relative to the run folder.
function relToRun(runDir, file) {
  const abs = path.resolve(path.isAbsolute(file) ? file : path.join(runDir, file));
  const rel = path.relative(runDir, abs);
  return rel.startsWith('..') ? null : rel.replace(/\\/g, '/');
}

export function convertJudgeOutput(ctx, data, { template: tid, consistency }) {
  const errors = [];
  const { p, run } = ctx;
  const level = run.options.level;
  const pages = readJson(p.pages).pages;
  const templates = readJson(p.templates).templates;
  const judged = judgeCriteria(level, { consistency });
  const allowed = new Set(judged.map((c) => c.sc));
  const toDecide = Object.fromEntries(judged.map((c) => [c.sc, c.failures.map((f) => f.id)]));
  const known = Object.fromEntries(judged.map((c) => [c.sc, new Set([...c.failures, ...c.settled].map((f) => f.id))]));
  const allowedPages = new Set(consistency ? pages.map((x) => x.id) : (templates.find((t) => t.id === tid)?.pageIds ?? []));
  // A page-type judge looked at that type's pages, its representative first: a finding without a page belongs there.
  // Without any page it could not be screenshotted, re-checked or listed in the pages appendix.
  const fallbackPage = consistency ? null : templates.find((t) => t.id === tid)?.representative ?? null;
  const shotsIndex = readJson(p.shotsIndex, { images: {} });
  if (!data || typeof data !== 'object' || !Array.isArray(data.observations)) return { errors: ['expected { "judge": "…", "observations": [ … ] }'], observations: [] };
  const observations = [];
  data.observations.forEach((j, i) => {
    const at = `observations[${i}]`;
    const e = [];
    // For "does not apply" the reason is the observation.
    if (j.status === 'not_applicable' && !j.observed && j.reason) j.observed = j.reason;
    if (!allowed.has(j.sc)) e.push(`${at}.sc "${j.sc}" is not one of your criteria (${[...allowed].join(', ')})`);
    if (!STATUSES.includes(j.status)) e.push(`${at}.status must be one of ${STATUSES.join(', ')}`);
    if (j.pageId && !allowedPages.has(j.pageId)) e.push(`${at}.pageId "${j.pageId}" is not a page of this scope`);
    if (!j.observed || String(j.observed).length < 10) e.push(`${at}.observed must describe what you saw`);
    if (j.status === 'fail') {
      if (!BARRIERS.includes(j.barrier)) e.push(`${at}.barrier must be blocker, major or minor for a fail`);
      if (!j.pageId) e.push(`${at}.pageId is required for a fail`);
      const rel = j.evidence_file ? relToRun(p.dir, j.evidence_file) : null;
      if (!j.evidence_file) e.push(`${at}: a fail needs evidence_file (a collected data file or a screenshot or image close-up)`);
      else if (!rel || !fs.existsSync(path.join(p.dir, rel))) e.push(`${at}.evidence_file must be a file inside the run folder`);
      else if (/\.(jpe?g|png|webp)$/i.test(rel)) {
        // A picture is evidence too: say what can be seen in it.
        if (!j.evidence_seen || String(j.evidence_seen).length < 15) e.push(`${at}: a fail shown by a picture needs evidence_seen, what can be seen in ${rel}`);
      } else if (!j.evidence_quote) e.push(`${at}: a fail from a data file needs evidence_quote (exact text from that file)`);
      else if (!evidenceHasQuote(p.dir, rel, j.evidence_quote)) e.push(`${at}.evidence_quote was not found in ${rel}: quote it exactly`);
    }
    // Every documented failure of a passed criterion was looked for.
    if (j.status === 'pass' && toDecide[j.sc]?.length) {
      const checked = new Set(Array.isArray(j.failures_checked) ? j.failures_checked.map(String) : []);
      const missing = toDecide[j.sc].filter((id) => !checked.has(id));
      if (missing.length) e.push(`${at}: a pass of ${j.sc} needs failures_checked with every documented failure you decide (${toDecide[j.sc].join(', ')}); missing ${missing.join(', ')}`);
    }
    if (j.failure != null && j.failure !== '' && !known[j.sc]?.has(String(j.failure))) e.push(`${at}.failure "${j.failure}" is not a documented failure of ${j.sc} (${[...(known[j.sc] ?? [])].join(', ') || 'none'}); leave it out when none matches`);
    if (j.status === 'needs_review' && !j.question) e.push(`${at}.question is required for needs_review`);
    // "To check" is only for what nobody can decide from the site: knowledge only the owner has, a video to watch,
    // content behind a sign-in, or a step that would send real data.
    if (j.status === 'needs_review' && !NEEDS_PERSON.includes(j.needs_person_because)) e.push(`${at}.needs_person_because must be one of ${NEEDS_PERSON.join(', ')}; if you can see it on the pages, screenshots or close-ups, decide pass or fail`);
    if (j.confidence && !['high', 'medium'].includes(j.confidence)) e.push(`${at}.confidence must be high or medium`);
    // One replacement for one element: different images on different pages need separate observations.
    if (j.suggestion != null && /\bp\d{3}\b\s*:/.test(String(j.suggestion))) e.push(`${at}.suggestion holds several replacements; give each image its own observation (with its pageId and selector), and use also_on only for the same image`);
    if (j.sc === '1.1.1' && j.status === 'fail') e.push(...altSuggestionProblems(j, shotsIndex).map((m) => `${at}.suggestion ${m}`));
    if (j.confidence === 'medium' && (!j.confidence_note || String(j.confidence_note).length < 10)) e.push(`${at}: confidence "medium" needs confidence_note, what you are not sure about`);
    if (j.status === 'needs_review' && !j.pageId && !fallbackPage) e.push(`${at}.pageId is required for needs_review (the page where you saw it)`);
    if (j.status === 'not_applicable' && !j.reason) e.push(`${at}.reason is required for not_applicable`);
    if (e.length) { errors.push(...e); return; }
    if (!j.pageId && ['fail', 'needs_review'].includes(j.status)) j.pageId = fallbackPage;
    const page = pages.find((x) => x.id === j.pageId);
    const evidence = j.evidence_file ? [relToRun(p.dir, j.evidence_file)].filter(Boolean) : [];
    const obs = signalToObservation({
      source: 'judge',
      check: `judge-${j.sc}`,
      sc: [j.sc],
      status: j.status,
      pageId: j.pageId ?? null,
      templateId: consistency ? null : tid,
      url: page ? page.finalUrl || page.url : null,
      state: 'default',
      viewport: [1280, 900],
      selector: j.selector ?? null,
      html: j.evidence_quote ?? (j.evidence_seen ? `Seen in the picture: ${j.evidence_seen}` : null),
      bbox: null,
      description: j.observed,
      expected: j.expected ?? null,
      question: j.question ?? null,
      barrier: j.barrier ?? null,
      trust: j.status === 'fail' ? 'confirmed' : 'review',
      evidence: evidence.length ? evidence : ['collect/'],
      exceptionsChecked: j.exceptions_checked ?? [],
      steps: [`Read the collected content of ${page?.url ?? 'the pages in scope'}`, `Judge it against ${j.sc} ${criterion(j.sc)?.name ?? ''}`.trim()],
    }, i + 1, { level, userAgent: run.versions?.browser ?? null });
    obs.id = `J-${consistency ? 'cons' : tid}-${String(i + 1).padStart(3, '0')}`;
    if (j.same_as) obs.x.sameAs = String(j.same_as);
    if (j.failure) obs.x.failure = String(j.failure);
    if (Array.isArray(j.failures_checked)) obs.x.failuresChecked = j.failures_checked.map(String);
    if (j.confidence) obs.x.confidence = j.confidence;
    if (j.confidence_note) obs.x.confidenceNote = String(j.confidence_note);
    if (j.suggestion != null) obs.x.suggestion = plainSuggestion(j.suggestion);
    if (j.needs_person_because) obs.x.needsPersonBecause = j.needs_person_because;
    if (j.status === 'not_applicable') obs.applicability.reason = j.reason;
    const oe = checkObservation(obs, p.dir);
    if (oe.length) { errors.push(...oe); return; }
    observations.push(obs);
    // The same problem seen on other pages of the scope: one observation per page, so reach is counted, not guessed.
    for (const [k, pid] of (Array.isArray(j.also_on) ? j.also_on : []).entries()) {
      if (!allowedPages.has(pid) || pid === j.pageId) continue;
      const other = pages.find((x) => x.id === pid);
      observations.push({ ...obs, id: `${obs.id}-${k + 2}`, scope: { ...obs.scope, url: other ? other.finalUrl || other.url : obs.scope.url }, x: { ...obs.x, pageId: pid } });
    }
  });
  // Every criterion of the scope gets a decision: a silent one would be reported as not tested.
  const decided = new Set(data.observations.map((j) => j.sc));
  const missing = [...allowed].filter((sc) => !decided.has(sc));
  if (missing.length) errors.push(`every criterion you judge needs at least one observation; missing: ${missing.join(', ')}`);
  return { errors, observations };
}

export function saveJudgeFile(ctx, name, payload) {
  writeJson(ctx.p.observation(`judge-${name}`), payload);
}
