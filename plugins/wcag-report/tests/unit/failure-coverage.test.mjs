// Every documented WCAG 2.2 failure technique is covered by something real: an axe rule, a check that emits signals,
// the content judge (for a criterion it judges), or collected data the judge reads. Only Level AAA criteria may be
// left untested, and only technology browsers no longer run may be called obsolete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/wcag-report');
const imp = (m) => import(new URL(`file:///${path.join(SKILL, 'scripts/lib', m).replace(/\\/g, '/')}`).href);
const { allFailureIds, allCriteria, criterionFailures, failureTitle } = await imp('criteria.mjs');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SKILL, f), 'utf8'));
const coverage = read('references/failure-coverage.json');
const scCoverage = read('references/coverage.json');
const axeRules = new Set(Object.keys(read('references/axe-map.json').rules));

const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sources(path.join(dir, d.name)) : d.name.endsWith('.mjs') ? [fs.readFileSync(path.join(dir, d.name), 'utf8')] : []));
const code = sources(path.join(SKILL, 'scripts/lib')).join('\n');
const collect = fs.readFileSync(path.join(SKILL, 'scripts/inpage/collect.js'), 'utf8');
const checkIds = new Set([...code.matchAll(/check: '([a-z0-9-]+)'/g), ...code.matchAll(/export const check = '([a-z0-9-]+)'/g)].map((m) => m[1]));

const BY = new Set(['automated', 'measure', 'deep', 'judge', 'consistency', 'aaa-not-tested', 'obsolete']);
const scOf = {};
for (const c of allCriteria()) for (const f of criterionFailures(c.id)) (scOf[f.id] ??= []).push(c);

test('every documented failure has a coverage entry', () => {
  const ids = allFailureIds();
  assert.ok(ids.length >= 85, `expected the W3C failure list, got ${ids.length}`);
  const missing = ids.filter((id) => !coverage[id]?.by?.length);
  assert.deepEqual(missing, [], 'failures without coverage');
});

test('coverage names only real checks', () => {
  const bad = [];
  for (const [id, entry] of Object.entries(coverage)) {
    if (id.startsWith('_')) continue;
    for (const b of entry.by) if (!BY.has(b)) bad.push(`${id}: unknown "by" ${b}`);
    for (const c of entry.checks) {
      const judge = /^judge-(.+)$/.exec(c);
      const field = /^collect\.(\w+)$/.exec(c);
      const real = judge ? Boolean(scCoverage[judge[1]]?.judge)
        : field ? new RegExp(`\\b${field[1]}(,|:)`).test(collect)
          : axeRules.has(c) || checkIds.has(c);
      if (!real) bad.push(`${id}: ${c} is not an axe rule, a check, a judged criterion or a collected field`);
    }
    if (entry.by.some((b) => b !== 'aaa-not-tested' && b !== 'obsolete') && !entry.checks.length) bad.push(`${id}: names no check`);
  }
  assert.deepEqual(bad, []);
});

test('only Level AAA failures are left untested, and the judge only decides criteria it judges', () => {
  const bad = [];
  for (const [id, entry] of Object.entries(coverage)) {
    if (id.startsWith('_')) continue;
    const scs = scOf[id] ?? [];
    if (entry.by.includes('aaa-not-tested') && scs.some((c) => c.level !== 'AAA')) bad.push(`${id} is left untested but belongs to ${scs.filter((c) => c.level !== 'AAA').map((c) => c.id).join(', ')}`);
    if (entry.by.includes('judge') && !scs.some((c) => scCoverage[c.id]?.judge)) bad.push(`${id} is given to the judge, but none of ${scs.map((c) => c.id).join(', ')} is judged`);
  }
  assert.deepEqual(bad, []);
});

test('failure titles read without the criterion prefix', () => {
  assert.equal(failureTitle('Failure of Success Criterion 1.4.4 due to incorrect use of viewport units to resize text'), 'incorrect use of viewport units to resize text');
  assert.equal(failureTitle('Failure of Success Criteria 1.3.1, 2.5.3, and 4.1.2 due to a control with visible label text but no accessible name'), 'a control with visible label text but no accessible name');
  assert.equal(failureTitle('Failure of Success Criterion 2.4.11 Focus Not Obscured (Minimum) due to a sticky footer or header completely hiding focused elements'), 'a sticky footer or header completely hiding focused elements');
});
