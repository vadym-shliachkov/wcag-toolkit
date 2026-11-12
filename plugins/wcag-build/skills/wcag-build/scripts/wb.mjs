#!/usr/bin/env node
// wcag-build: plan-time WCAG brief for UI work. Plain Node, no dependencies.
//   wb.mjs list
//   wb.mjs brief --components a,b --changes x,y [--level A|AA|AAA] [--compact]
//   wb.mjs contrast <fg> <bg> [<fg> <bg> ...] [--large]
//   wb.mjs criterion <id>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KB = path.join(SKILL_DIR, 'kb');
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(SKILL_DIR, ...p), 'utf8'));

export const FULL_MAX = 120;
export const COMPACT_MAX = 30;
const LEVELS = { A: ['A'], AA: ['A', 'AA'], AAA: ['A', 'AA', 'AAA'] };

let cache;
function kb() {
  if (cache) return cache;
  const criteria = new Map(readJson('kb', 'data', 'criteria.json').map((c) => [c.id, c]));
  const plain = readJson('references', 'criteria-plain.en.json');
  const patterns = new Map(readJson('kb', 'data', 'patterns.json').map((p) => [p.id, p]));
  const thresholds = readJson('kb', 'data', 'thresholds.json').thresholds;
  const map = readJson('references', 'build-map.json');
  return (cache = { criteria, plain, patterns, thresholds, map });
}

export const compareSc = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

class UsageError extends Error {}

function pick(kind, keys) {
  const table = kb().map[kind];
  const bad = keys.filter((k) => !table[k]);
  if (bad.length) throw new UsageError(`Unknown ${kind}: ${bad.join(', ')}. Valid: ${Object.keys(table).join(', ')}`);
  return keys.map((k) => ({ key: k, ...table[k] }));
}

const csv = (s) => (s ? s.split(',').map((v) => v.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------- brief

/** Risks of the chosen entries that are in the level profile, without repeats. */
function collectRisks(entries, levels) {
  const { criteria } = kb();
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    for (const r of e.risks) {
      if (seen.has(r.risk)) continue;
      const inScope = r.sc.filter((id) => levels.includes(criteria.get(id).level));
      if (!inScope.length && !r.always) continue;
      seen.add(r.risk);
      out.push({ ...r, from: e.key, sc: inScope.length ? inScope : r.sc, beyond: !inScope.length });
    }
  }
  return out;
}

const riskLine = (r) => `- [${r.sc.join(', ')}${r.beyond ? ', above this level but cheap' : ''}] ${r.risk} Build: ${r.build}`;

function thresholdLines(scope) {
  const human = (t) => `${t.criterion} ${t.metric.replace(/_/g, ' ')} ${t.operator} ${t.value} ${t.unit.replace(/_/g, ' ')}`;
  return kb().thresholds.filter((t) => scope.has(t.criterion)).map(human);
}

export function brief({ components = [], changes = [], level = 'AA', compact = false }) {
  const levels = LEVELS[level];
  if (!levels) throw new UsageError(`Unknown level: ${level}. Valid: A, AA, AAA`);
  if (!components.length && !changes.length) throw new UsageError('Give --components and/or --changes. Run "list" for the keys.');
  const { criteria, plain, patterns, map } = kb();
  const comp = pick('components', components);
  const chg = pick('changes', changes);

  const changeRisks = collectRisks(chg, levels);
  let compRisks = collectRisks(comp, levels).filter((r) => !changeRisks.some((c) => c.risk === r.risk));
  let skipped = 0;
  if (compact && chg.length) {
    // A restyle can only break what the change kinds touch: keep the component
    // risks that share a criterion with them.
    const touched = new Set(changeRisks.flatMap((r) => r.sc));
    const kept = compRisks.filter((r) => r.sc.some((id) => touched.has(id)));
    skipped = compRisks.length - kept.length;
    compRisks = kept;
  }
  const risks = [...changeRisks, ...compRisks];
  const scope = new Set(risks.filter((r) => !r.beyond).flatMap((r) => r.sc));
  const ids = [...scope].sort(compareSc);
  const title = `# WCAG brief (${level}): ${[...components, ...changes].join(', ')}`;
  const thresholds = thresholdLines(scope);

  if (compact) {
    const head = [title, 'Ways this change can fail. For each: does it apply here, and what will the build do about it?', ''];
    const tail = [];
    if (thresholds.length) tail.push('', `Thresholds: ${thresholds.join('; ')}.`);
    if (skipped) tail.push(`${skipped} component risks outside these change kinds are left out; run without --compact when markup or behaviour changes.`);
    const room = COMPACT_MAX - head.length - tail.length;
    let lines = risks.map(riskLine);
    if (lines.length > room) {
      const more = lines.length - (room - 1);
      lines = [...lines.slice(0, room - 1), `- ${more} more risks: run without --compact.`];
    }
    return [...head, ...lines, ...tail].join('\n');
  }

  const out = [title, '', 'Ways this work can fail WCAG, and what to build so it does not. Go through every line before choosing the approach: does it apply to this design and this code, and how will the build satisfy it?', ''];
  const section = (heading, entries, list) => {
    if (!list.length) return;
    out.push(`## ${heading}: ${entries.map((e) => e.title).join('; ')}`, ...list.map(riskLine), '');
  };
  section('What the change touches', chg, changeRisks);
  section('What is being built', comp, compRisks);

  if (thresholds.length) out.push('## Numbers', ...thresholds.map((t) => `- ${t}`), '');

  out.push('## Criteria in scope');
  if (out.length + ids.length > FULL_MAX - 20) {
    // A wide task: the risk lines matter more than one line per criterion.
    out.push(ids.map((id) => `${id} ${criteria.get(id).title_en}`).join('; ') + '.');
  } else {
    for (const id of ids) {
      const c = criteria.get(id);
      out.push(`- ${id} ${c.title_en} (${c.level}): ${plain[id]?.plain ?? c.requirement_summary}`);
    }
  }
  out.push(`Full card for any of them: ${path.join(KB, 'criteria', '<id>.md')}`, '');

  const cautions = map.cautions.filter((c) => c.sc.some((id) => scope.has(id))).slice(0, 5);
  const cautionBlock = cautions.length ? ['## Do not over-apply', ...cautions.map((c) => `- ${c.text}`), ''] : [];

  // Pattern contracts fill what is left of the line budget; the rest are linked.
  const patternIds = [...new Set([...chg, ...comp].flatMap((e) => e.patterns))];
  const linked = [];
  if (patternIds.length) {
    let room = FULL_MAX - out.length - cautionBlock.length - 2;
    const blocks = [];
    for (const id of patternIds) {
      const p = patterns.get(id);
      const block = [`### ${p.title_en} (${p.criteria.join(', ')})`, '```html', ...p.good.split('\n'), '```', `Check: ${p.verification}`];
      if (block.length <= room - 1) { blocks.push(...block); room -= block.length; } else linked.push(id);
    }
    if (blocks.length || linked.length) out.push('## Pattern contracts', ...blocks);
    if (linked.length) out.push(`More patterns in ${path.join(KB, 'examples')}: ${linked.map((id) => `${id}.md`).join(', ')}`);
    out.push('');
  }
  out.push(...cautionBlock);
  while (out.at(-1) === '') out.pop();
  return out.join('\n');
}

export function list() {
  const { map } = kb();
  const rows = (table) => Object.entries(table).map(([k, v]) => `- ${k}: ${v.title}`);
  return ['Components (what is being built or changed):', ...rows(map.components), '', 'Changes (what the task touches):', ...rows(map.changes)].join('\n');
}

export function criterionCard(id) {
  const file = path.join(KB, 'criteria', `${id}.md`);
  if (!/^\d\.\d\.\d{1,2}$/.test(id ?? '') || !fs.existsSync(file)) throw new UsageError(`No criterion "${id}". Example: criterion 1.4.3`);
  return fs.readFileSync(file, 'utf8').trimEnd();
}

// ---------------------------------------------------------------- contrast

export function parseColour(input) {
  const s = String(input).trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3,8})$/);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const ch = (v) => (v.endsWith('%') ? (parseFloat(v) / 100) * 255 : parseFloat(v));
      const a = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      const c = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]), a };
      if (Object.values(c).every(Number.isFinite)) return c;
    }
  }
  throw new UsageError(`Cannot read colour "${input}". Use #rgb, #rrggbb, #rrggbbaa or rgb()/rgba().`);
}

const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
});
const luminance = ({ r, g, b }) => {
  const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function toHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
function fromHsl({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: 1 };
}

/** Same hue, lightness moved the least distance that reaches the target ratio. */
export function nearestPassing(fg, bg, target) {
  const base = toHsl(fg);
  let best = null;
  for (const end of [0, 1]) {
    const at = (l) => { const c = fromHsl({ ...base, l }); const q = { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b), a: 1 }; return { c: q, ok: ratio(q, bg) >= target }; };
    if (!at(end).ok) continue;
    let fail = base.l, pass = end;
    for (let i = 0; i < 24; i++) { const mid = (fail + pass) / 2; if (at(mid).ok) pass = mid; else fail = mid; }
    const dist = Math.abs(pass - base.l);
    if (!best || dist < best.dist) best = { dist, colour: at(pass).c };
  }
  return best && best.colour;
}

export function contrast(fgIn, bgIn, { large = false } = {}) {
  const bgRaw = parseColour(bgIn);
  const note = bgRaw.a < 1 ? ' (background alpha ignored: give the colour it ends up as)' : '';
  const bg = { ...bgRaw, a: 1 };
  const fg = over(parseColour(fgIn), bg);
  const r = ratio(fg, bg);
  const shown = Math.floor(r * 100) / 100; // never round up to a pass
  const textNeed = large ? 3 : 4.5;
  const verdict = (need) => (r >= need ? 'pass' : 'FAIL');
  let line = `${fgIn} on ${bgIn}: ${shown.toFixed(2)}:1. ${large ? 'Large text' : 'Text'} (1.4.3, needs ${textNeed}): ${verdict(textNeed)}. UI parts and icons (1.4.11, needs 3): ${verdict(3)}.${note}`;
  if (r < textNeed) {
    const fix = nearestPassing(fg, bg, textNeed);
    line += fix ? ` Nearest passing text colour: ${hex(fix)} (${(Math.floor(ratio(fix, bg) * 100) / 100).toFixed(2)}:1).` : ` No lightness of this hue reaches ${textNeed}:1 here; change the background.`;
  }
  return { ratio: r, passText: r >= textNeed, passUi: r >= 3, line };
}

// ---------------------------------------------------------------- CLI

const USAGE = `Usage:
  wb.mjs list
  wb.mjs brief --components a,b --changes x,y [--level A|AA|AAA] [--compact]
  wb.mjs contrast <fg> <bg> [<fg> <bg> ...] [--large]
  wb.mjs criterion <id>`;

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      components: { type: 'string' }, changes: { type: 'string' }, level: { type: 'string', default: 'AA' },
      compact: { type: 'boolean', default: false }, large: { type: 'boolean', default: false },
    },
  });
  const [cmd, ...rest] = positionals;
  switch (cmd) {
    case 'list': return list();
    case 'brief': return brief({ components: csv(values.components), changes: csv(values.changes), level: values.level.toUpperCase(), compact: values.compact });
    case 'criterion': return criterionCard(rest[0]);
    case 'contrast': {
      if (!rest.length || rest.length % 2) throw new UsageError('contrast needs pairs: <foreground> <background> ...');
      const lines = [];
      for (let i = 0; i < rest.length; i += 2) lines.push(contrast(rest[i], rest[i + 1], { large: values.large }).line);
      return lines.join('\n');
    }
    default: throw new UsageError(USAGE);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    if (err instanceof UsageError || err.code?.startsWith?.('ERR_PARSE_ARGS')) { console.error(err.message); process.exit(1); }
    throw err;
  }
}
