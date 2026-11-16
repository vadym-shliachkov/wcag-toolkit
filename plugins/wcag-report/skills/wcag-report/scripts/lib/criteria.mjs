// The WCAG 2.2 criteria from the bundled knowledge base, plus the skill's own plain-language references.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';
import { KB_DIR, REFS_DIR } from './paths.mjs';

const LEVEL_RANK = { A: 1, AA: 2, AAA: 3 };
const PRINCIPLES = { 1: 'perceivable', 2: 'operable', 3: 'understandable', 4: 'robust' };

let all = null;

export function allCriteria() {
  if (!all) {
    const kb = readJson(path.join(KB_DIR, 'data', 'criteria.json'));
    const plain = readJson(path.join(REFS_DIR, 'criteria-plain.en.json'), {});
    all = kb
      .filter((c) => c.id !== '4.1.1')
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.title_en,
        level: c.level,
        principle: PRINCIPLES[c.id[0]],
        url: c.normative_url,
        plain: plain[c.id]?.plain ?? null,
        groups: plain[c.id]?.groups ?? [],
        // The knowledge base's worked patterns for this criterion (kb/examples/<slug>.md): the broken markup, why it
        // fails, and the corrected markup.
        examples: (c.code_patterns ?? []).map((slug) => path.join(KB_DIR, 'examples', `${slug}.md`)).filter((f) => fs.existsSync(f)),
      }))
      .sort((a, b) => compareSc(a.id, b.id));
  }
  return all;
}

// The documented failure techniques of a criterion (W3C "Techniques for WCAG 2.2"), with their titles and test
// procedures, and how this review covers each (references/failure-coverage.json).
let failureData = null;
function failureIndex() {
  if (!failureData) {
    const relations = readJson(path.join(KB_DIR, 'data', 'technique-relations.json'), {});
    const techniques = readJson(path.join(KB_DIR, 'data', 'techniques.json'), []);
    const coverage = readJson(path.join(REFS_DIR, 'failure-coverage.json'), {});
    const byId = new Map((Array.isArray(techniques) ? techniques : Object.values(techniques)).map((t) => [t.id, t]));
    const bySc = {};
    for (const [sc, rel] of Object.entries(relations)) {
      const ids = [];
      const walk = (x) => {
        if (!x) return;
        if (typeof x === 'string') { if (/^F\d+$/.test(x)) ids.push(x); return; }
        if (Array.isArray(x)) { x.forEach(walk); return; }
        walk(x.techniques);
        walk(x.groups);
      };
      walk(rel.failure);
      bySc[sc] = [...new Set(ids)];
    }
    failureData = { bySc, byId, coverage };
  }
  return failureData;
}

// Strips "Failure of Success Criterion 1.1.1 due to" so the title says only what the failure is.
export function failureTitle(title) {
  return String(title || '').replace(/^Failure (of|due to)\s+(Success Criteri(on|a)\s+)?[\d., ]*(,? ?(and|or) [\d.]+)*\s*(and Conformance Requirement 5\s*)?/i, '').replace(/^(Focus Not Obscured \(Minimum\)|Dragging Movements|Content on hover or focus)\s+/i, '').replace(/^(due to|for|when|by)\s+/i, '').trim();
}

export function criterionFailures(sc) {
  const { bySc, byId, coverage } = failureIndex();
  return (bySc[sc] ?? []).map((id) => {
    const t = byId.get(id);
    const procedure = String(t?.test_procedure_en ?? '').replace(/^Tests? Procedure\s*/i, '').replace(/\s*Expected Results?.*$/is, '').trim();
    return { id, title: failureTitle(t?.title_en), procedure, by: coverage[id]?.by ?? [], checks: coverage[id]?.checks ?? [], how: coverage[id]?.how ?? null };
  });
}

export function allFailureIds() {
  return [...new Set(Object.entries(failureIndex().bySc).filter(([sc]) => sc !== '4.1.1').flatMap(([, ids]) => ids))];
}

export function compareSc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export function criterion(id) {
  return allCriteria().find((c) => c.id === id) ?? null;
}

// The rank of a conformance level. Case does not matter ("aa" is AA). Anything else is an error: an unknown level
// would otherwise match no criterion and the audit would silently test nothing.
function levelRank(level) {
  const rank = LEVEL_RANK[String(level ?? '').trim().toUpperCase()];
  if (!rank) throw new Error(`Unknown WCAG level "${level}": use A, AA or AAA.`);
  return rank;
}

export function inProfile(id, level) {
  const max = levelRank(level);
  const c = criterion(id);
  return Boolean(c) && LEVEL_RANK[c.level] <= max;
}

export function profileCriteria(level) {
  const max = levelRank(level);
  return allCriteria().filter((c) => LEVEL_RANK[c.level] <= max);
}

export function cardPath(id) {
  const file = path.join(KB_DIR, 'criteria', `${id}.md`);
  return fs.existsSync(file) ? file : null;
}

export function kbVersion() {
  return readJson(path.join(KB_DIR, 'KB-VERSION.json'), {}).syncedAt ?? null;
}
