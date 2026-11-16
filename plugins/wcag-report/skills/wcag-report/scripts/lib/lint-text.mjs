// Deterministic checks on the reader-facing text written by the writer, editor and fixer agents.
// Errors block a save; warnings go back to the editor. Rules come from references/banned.<lang>.json; the rules that
// do not depend on language (code, placeholders, punctuation) always apply.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';
import { REFS_DIR } from './paths.mjs';
import { baseLang, usesLatinScript } from './i18n.mjs';

const UNIVERSAL = new Set(['code-like', 'placeholder', 'exclamation', 'question']);

// Word limits per field (design.md §3). Over by up to 10 % is a warning, more is an error.
export const LIMITS = {
  issue: { title: 12, where: 20, observed: 40, cause: 35, impact: 25, severity_reason: 20, alt: 40, caption: 15, fix_step: 20, dev_note: 25, done_when: 25 },
  review: { title: 12, where: 20, observed: 30, why_uncertain: 25, what_to_check: 30, alt: 40, caption: 15 },
  editor: { verdict_headline: 30, summary: 90, groups_summary: 50, journeys_note: 40, glossary: 30 },
};
export const TITLE_CHARS = 70;
export const MAX_IMPACTS = 4;
export const MAX_FIX_STEPS = 3;
const SENTENCE_WARN = 22;
const SENTENCE_ERROR = 28;

const L = '[\\p{L}\\p{N}_]';
const BOUNDARY = `(?:(?<=${L})(?!${L})|(?<!${L})(?=${L}))`;

// `\b` and `\w` are ASCII-only in JavaScript even with the u flag; rewrite them so non-ASCII letters count as word characters too.
export function unicodePattern(src) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (n === 'b' && !inClass) out += BOUNDARY;
      else if (n === 'w') out += inClass ? '\\p{L}\\p{N}_' : L;
      else out += c + n;
      i++;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    out += c;
  }
  return out;
}

const cache = new Map();

function compile(rule) {
  const flags = `${rule.flags ?? 'i'}u`.replace(/(.)(?=.*\1)/g, '');
  return { ...rule, re: new RegExp(unicodePattern(rule.pattern), `${flags}g`) };
}

export function rulesFor(lang = 'en') {
  const base = String(lang).split('-')[0].toLowerCase();
  if (cache.has(base)) return cache.get(base);
  const en = readJson(path.join(REFS_DIR, 'banned.en.json'));
  const file = path.join(REFS_DIR, `banned.${base}.json`);
  const own = fs.existsSync(file) ? readJson(file) : null;
  const rules = [];
  if (base === 'en') rules.push(...en.rules);
  else {
    rules.push(...en.rules.filter((r) => UNIVERSAL.has(r.id)));
    if (own) rules.push(...own.rules.filter((r) => !UNIVERSAL.has(r.id)));
  }
  const src = base === 'en' ? en : own;
  const result = {
    lang: base,
    hasList: base === 'en' || Boolean(own),
    rules: rules.map(compile),
    hedges: src?.hedges ? new RegExp(unicodePattern(src.hedges), 'giu') : null,
    consequence: src?.consequence ? new RegExp(unicodePattern(src.consequence), 'iu') : null,
    reviewTitleStart: src?.reviewTitleStart ? new RegExp(unicodePattern(src.reviewTitleStart), 'iu') : null,
  };
  cache.set(base, result);
  return result;
}

let groupIds = null;
function validGroups() {
  if (!groupIds) groupIds = new Set(readJson(path.join(REFS_DIR, 'groups.json')).order);
  return groupIds;
}

// Quoted on-screen text is the site's own wording, in its own language: exempt from style rules.
const QUOTES = /“[^”]*”|"[^"]*"|«[^»]*»|„[^“”]*[“”]|‘[^’]*’/g;
const URLS = /\bhttps?:\/\/\S+|(?<![\p{L}\p{N}])\/[\w\-./%~?=&#]*/gu;

export function stripQuoted(text) {
  return String(text).replace(QUOTES, ' ').replace(/\bhttps?:\/\/\S+/g, ' ');
}

export function words(text) {
  return String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.,:%]*/gu)?.filter((w) => /[\p{L}\p{N}]/u.test(w)) ?? [];
}

export function wordCount(text) {
  return words(text).length;
}

// Sentences end at . ! ? ; followed by a space or the end; "4.5:1" and "e.g." style dots inside tokens stay put.
export function sentences(text) {
  return String(text).replace(QUOTES, ' Q ').split(/(?<=[.!?;])\s+(?=[\p{Lu}\p{N}«“"(])|\n+/u).map((s) => s.trim()).filter(Boolean);
}

function excerpt(text, index, len = 40) {
  const s = Math.max(0, index - 15);
  return String(text).slice(s, s + len).replace(/\s+/g, ' ').trim();
}

// Every text field of an entry, with the scope tags the rules match against.
export function fieldsOf(entry, kind) {
  const out = [];
  const add = (field, text, tags = [], limit = null) => {
    if (text == null || text === '') return;
    out.push({ field, text: String(text), tags: new Set(tags), limit });
  };
  const lim = LIMITS[kind] ?? {};
  if (kind === 'editor') {
    add('verdict_headline', entry.verdict_headline, [], lim.verdict_headline);
    add('summary', entry.summary, [], lim.summary);
    add('journeys_note', entry.journeys_note, [], lim.journeys_note);
    for (const [g, t] of Object.entries(entry.groups_summary ?? {})) add(`groups_summary.${g}`, t, [], lim.groups_summary);
    (entry.glossary ?? []).forEach((g, i) => add(`glossary[${i}].meaning`, g?.meaning, ['glossary'], lim.glossary));
    return out;
  }
  add('title', entry.title, ['title'], lim.title);
  add('where', String(entry.where ?? '').replace(URLS, ' '), ['where'], lim.where);
  add('observed', entry.observed, [], lim.observed);
  if (kind === 'issue') {
    add('cause', entry.cause, ['cause'], lim.cause);
    (entry.impacts ?? []).forEach((im, i) => add(`impacts[${i}].text`, im?.text, ['impact'], lim.impact));
    add('severity_reason', entry.severity_reason, [], lim.severity_reason);
  } else {
    add('why_uncertain', entry.why_uncertain, [], lim.why_uncertain);
    add('what_to_check', entry.what_to_check, [], lim.what_to_check);
  }
  (entry.shots ?? []).forEach((s, i) => {
    add(`shots[${i}].alt`, s?.alt, ['alt'], lim.alt);
    add(`shots[${i}].caption`, s?.caption, ['caption'], lim.caption);
  });
  if (entry.fix && typeof entry.fix === 'object') {
    (entry.fix.steps ?? []).forEach((s, i) => add(`fix.steps[${i}]`, s, ['fix'], lim.fix_step));
    add('fix.dev_note', entry.fix.dev_note, ['fix', 'devNote'], lim.dev_note);
    add('fix.done_when', entry.fix.done_when, ['fix'], lim.done_when);
  }
  return out;
}

function inScope(scope, f) {
  if (scope === 'all') return true;
  if (scope === 'prose') return !f.tags.has('fix');
  if (scope === 'notDevNote') return !f.tags.has('devNote') && !f.tags.has('glossary');
  if (scope === 'cause') return f.tags.has('cause');
  if (scope === 'title') return f.tags.has('title');
  return true;
}

function scriptCheck(lang, text) {
  if (!usesLatinScript(lang)) return null;
  const cyr = (stripQuoted(text).match(/\p{Script=Cyrillic}/gu) ?? []).length;
  if (cyr > 0) return `Cyrillic text in a report written in "${baseLang(lang)}".`;
  return null;
}

export function lintEntry(entry, { kind = 'issue', fix = false, lang = 'en', key = entry?.key ?? null } = {}) {
  const out = [];
  const push = (field, severity, rule, message, ex) => out.push({ key, field, severity, rule, message, ...(ex ? { excerpt: ex } : {}) });
  if (!entry || typeof entry !== 'object') {
    push(null, 'error', 'missing', 'Entry is empty.');
    return out;
  }
  const R = rulesFor(lang);
  const fields = fieldsOf(entry, kind);

  const required = kind === 'issue' ? ['title', 'where', 'observed', 'cause', 'severity_reason']
    : kind === 'review' ? ['title', 'where', 'observed', 'why_uncertain', 'what_to_check']
      : ['verdict_headline', 'summary'];
  for (const r of required) if (!String(entry[r] ?? '').trim()) push(r, 'error', 'missing', `"${r}" is empty.`);

  if (kind === 'issue') {
    const impacts = entry.impacts ?? [];
    if (!impacts.length) push('impacts', 'error', 'missing', 'Say who is affected: at least one group.');
    if (impacts.length > MAX_IMPACTS) push('impacts', 'error', 'too-many', `At most ${MAX_IMPACTS} groups; put the rest under "also affects".`);
    const seen = new Set();
    impacts.forEach((im, i) => {
      if (!validGroups().has(im?.group)) push(`impacts[${i}].group`, 'error', 'group', `Unknown group "${im?.group}". Use one of: ${[...validGroups()].join(', ')}.`);
      if (seen.has(im?.group)) push(`impacts[${i}].group`, 'error', 'group', `Group "${im?.group}" listed twice.`);
      seen.add(im?.group);
      if (!['blocks', 'harder'].includes(im?.level)) push(`impacts[${i}].level`, 'error', 'impact-level', 'level must be "blocks" or "harder".');
      if (R.consequence && im?.text && !R.consequence.test(stripQuoted(im.text))) push(`impacts[${i}].text`, 'warning', 'consequence', 'Say the consequence for the task (…, so they …).');
    });
    // A fix block is always written (it goes to findings.csv); `fix` here means it is required. Without --fix the
    // report simply does not print it, so its presence is never an error.
    if (fix && !entry.fix) push('fix', 'error', 'fix-missing', 'Every confirmed problem needs a fix block.');
    if (entry.fix) {
      const steps = entry.fix.steps ?? [];
      if (!steps.length) push('fix.steps', 'error', 'missing', 'Give 1 to 3 steps.');
      if (steps.length > MAX_FIX_STEPS) push('fix.steps', 'error', 'too-many', `At most ${MAX_FIX_STEPS} steps.`);
      if (!String(entry.fix.done_when ?? '').trim()) push('fix.done_when', 'error', 'missing', 'Say how the owner can tell it is fixed.');
    }
  }
  if (kind === 'review' && entry.fix) push('fix', 'error', 'fix-on-review', 'Items to check never carry a fix.');
  if (kind === 'review' && R.reviewTitleStart && entry.title && !R.reviewTitleStart.test(entry.title.trim())) {
    push('title', 'error', 'review-title', 'A review item title starts with "Check whether…" (or its translation).');
  }

  if (entry.title && kind !== 'editor') {
    const t = String(entry.title).trim();
    if (t.length > TITLE_CHARS) push('title', 'error', 'title-length', `Title is ${t.length} characters; at most ${TITLE_CHARS}.`);
    const n = wordCount(t);
    if (kind === 'issue' && n < 4) push('title', 'warning', 'title-short', 'A title of 4 to 12 words reads better.');
    if (/[.:]$/.test(t)) push('title', 'warning', 'title-punctuation', 'No full stop or colon at the end of a title.');
    if (/\b\d\.\d\.\d{1,2}\b/.test(t)) push('title', 'error', 'title-criterion', 'No criterion number in the title.');
  }

  let hedges = 0;
  for (const f of fields) {
    const plain = stripQuoted(f.text);
    if (f.limit) {
      const n = wordCount(f.text); // "where" arrives here without its web addresses (see add('where', …))
      if (n > f.limit) push(f.field, n > f.limit * 1.1 ? 'error' : 'warning', 'length', `${n} words; at most ${f.limit}.`);
    }
    if (!f.tags.has('devNote')) {
      for (const s of sentences(f.text)) {
        const n = wordCount(s);
        if (n > SENTENCE_ERROR) push(f.field, 'error', 'sentence-length', `A sentence of ${n} words; keep sentences under ${SENTENCE_WARN}.`, s.slice(0, 50));
        else if (n > SENTENCE_WARN) push(f.field, 'warning', 'sentence-length', `A sentence of ${n} words; keep sentences under ${SENTENCE_WARN}.`, s.slice(0, 50));
      }
    }
    for (const rule of R.rules) {
      if (!inScope(rule.scope, f)) continue;
      if (rule.id === 'question' && f.tags.has('title') && kind === 'review') continue;
      rule.re.lastIndex = 0;
      const m = rule.re.exec(plain);
      if (m) push(f.field, rule.severity, rule.id, rule.message, excerpt(plain, m.index));
    }
    if (R.hedges && !f.tags.has('fix')) {
      const count = (plain.match(R.hedges) ?? []).length;
      if (count && f.tags.has('title')) push(f.field, 'warning', 'hedge', 'No hedging in a title; state the problem.');
      hedges += count;
    }
    const wrong = f.tags.has('devNote') ? null : scriptCheck(lang, f.text);
    if (wrong) push(f.field, 'error', 'wrong-script', wrong, f.text.slice(0, 40));
  }
  if (kind !== 'editor' && hedges > 1) push(null, 'warning', 'hedge', `${hedges} hedging words in one entry; at most 1.`);
  if (!R.hasList) push(null, 'warning', 'no-lint-list', `No banned-word list for "${lang}"; only language-independent checks ran.`);
  return out;
}

// texts: { issues: [entry|{key,…}] or { key: entry }, reviews: same, editor: {…} }
export function lintReportTexts(texts, opts = {}) {
  const out = [];
  const asList = (x) => (Array.isArray(x) ? x : Object.entries(x ?? {}).map(([key, v]) => ({ key, ...v })));
  for (const e of asList(texts.issues)) out.push(...lintEntry(e, { ...opts, kind: 'issue', key: e.key }));
  for (const e of asList(texts.reviews)) out.push(...lintEntry(e, { ...opts, kind: 'review', fix: false, key: e.key }));
  if (texts.editor) out.push(...lintEntry(texts.editor, { ...opts, kind: 'editor', key: 'editor' }));
  // The "no list" warning once per report, not once per entry.
  let warned = false;
  return out.filter((f) => f.rule !== 'no-lint-list' || (!warned && (warned = true)));
}

export function summarize(findings) {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}
