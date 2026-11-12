#!/usr/bin/env node
// Copies the part of the wcag-report knowledge base that wcag-build needs.
// wcag-report stays the single source: edit the KB there, then run this.
//   node tools/sync-kb.mjs           write the copy
//   node tools/sync-kb.mjs --check   exit 1 if the copy is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'wcag-report', 'skills', 'wcag-report');
const DEST = path.resolve(here, '..', 'skills', 'wcag-build');

// Fields of a criterion that matter when building. Technique lists, test
// evidence and source provenance stay in wcag-report.
const CRITERION_FIELDS = [
  'id', 'slug', 'title_en', 'level', 'normative_url', 'applicability', 'requirement_summary',
  'failure_condition', 'remediation', 'exceptions_and_false_positives', 'code_patterns',
];

const lf = (s) => s.replace(/\r\n/g, '\n');
const readText = (p) => lf(fs.readFileSync(p, 'utf8'));
const json = (v) => JSON.stringify(v, null, 1) + '\n';

function listMd(dir, skip = () => false) {
  return fs.readdirSync(path.join(SRC, dir)).filter((f) => f.endsWith('.md') && !skip(f)).sort()
    .map((f) => `${dir}/${f}`);
}

/** The full target state: relative path -> text. */
export function plan() {
  const out = new Map();
  const copy = (rel) => out.set(rel, readText(path.join(SRC, rel)));

  for (const rel of listMd('kb/criteria', (f) => f.includes('legacy'))) copy(rel);
  for (const rel of listMd('kb/examples')) copy(rel);
  for (const g of ['components', 'disputed-advice', 'thresholds']) copy(`kb/guides/${g}.md`);
  for (const d of ['patterns', 'thresholds']) copy(`kb/data/${d}.json`);
  copy('references/criteria-plain.en.json');

  const criteria = JSON.parse(readText(path.join(SRC, 'kb/data/criteria.json')));
  out.set('kb/data/criteria.json', json(criteria.map((c) => Object.fromEntries(CRITERION_FIELDS.map((k) => [k, c[k]])))));
  return out;
}

function existing() {
  const found = [];
  const walk = (rel) => {
    const abs = path.join(DEST, rel);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else found.push(r);
    }
  };
  walk('kb');
  return found;
}

/** Paths that differ from the source: changed, missing or left over. */
export function drift() {
  const want = plan();
  const bad = [];
  for (const [rel, text] of want) {
    const abs = path.join(DEST, rel);
    if (!fs.existsSync(abs)) bad.push(`missing ${rel}`);
    else if (readText(abs) !== text) bad.push(`changed ${rel}`);
  }
  for (const rel of existing()) if (!want.has(rel)) bad.push(`stale ${rel}`);
  return bad;
}

function write() {
  const want = plan();
  for (const rel of existing()) if (!want.has(rel)) fs.rmSync(path.join(DEST, rel));
  for (const [rel, text] of want) {
    const abs = path.join(DEST, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
  return want.size;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drift();
    console.log(JSON.stringify({ ok: bad.length === 0, drift: bad }, null, 1));
    process.exit(bad.length ? 1 : 0);
  }
  console.log(JSON.stringify({ ok: true, files: write() }));
}
