// A small JSON Schema subset, enough for the KB observation schema and the skill's own schemas:
// type, enum, const, pattern, minLength/maxLength, minimum/exclusiveMinimum, required, properties,
// additionalProperties:false, items, minItems/maxItems, uniqueItems, $ref (#/$defs/…), allOf, if/then, not.
import fs from 'node:fs';
import path from 'node:path';
import { KB_DIR, REFS_DIR } from './paths.mjs';

const cache = new Map();

export function loadSchema(name) {
  if (!cache.has(name)) {
    const file = name === 'observation'
      ? path.join(KB_DIR, 'schemas', 'observation.schema.json')
      : path.join(REFS_DIR, `${name}.schema.json`);
    cache.set(name, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return cache.get(name);
}

export function validate(schema, value, at = '$') {
  const errors = [];
  check(schema, value, at, errors, schema);
  return errors;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number' && Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchesType(type, v) {
  const actual = typeOf(v);
  return type === actual || (type === 'number' && actual === 'integer');
}

function resolve(s, root) {
  if (!s.$ref) return s;
  const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
  if (!m || !root.$defs?.[m[1]]) throw new Error(`Unsupported $ref ${s.$ref}`);
  return { ...root.$defs[m[1]], ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== '$ref')) };
}

function check(schema, v, at, errors, root) {
  const s = resolve(schema, root);
  if (s.type) {
    const types = [].concat(s.type);
    if (!types.some((t) => matchesType(t, v))) {
      errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(v)}`);
      return;
    }
  }
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(v)) errors.push(`${at}: must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some((e) => e === v)) errors.push(`${at}: must be one of ${s.enum.map(String).join(', ')}`);
  if (typeof v === 'string') {
    if (s.minLength != null && v.length < s.minLength) errors.push(`${at}: must be at least ${s.minLength} characters`);
    if (s.maxLength != null && v.length > s.maxLength) errors.push(`${at}: must be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) errors.push(`${at}: must match ${s.pattern}`);
  }
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) errors.push(`${at}: must be ≥ ${s.minimum}`);
    if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) errors.push(`${at}: must be > ${s.exclusiveMinimum}`);
    if (s.maximum != null && v > s.maximum) errors.push(`${at}: must be ≤ ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) errors.push(`${at}: must have at least ${s.minItems} item(s)`);
    if (s.maxItems != null && v.length > s.maxItems) errors.push(`${at}: must have at most ${s.maxItems} item(s)`);
    if (s.uniqueItems && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) errors.push(`${at}: items must be unique`);
    if (s.items) v.forEach((item, i) => check(s.items, item, `${at}[${i}]`, errors, root));
  }
  if (typeOf(v) === 'object') {
    for (const key of s.required ?? []) if (!(key in v)) errors.push(`${at}: missing required property "${key}"`);
    for (const [key, child] of Object.entries(v)) {
      const sub = s.properties?.[key];
      if (sub) check(sub, child, `${at}.${key}`, errors, root);
      else if (s.additionalProperties === false) errors.push(`${at}: unknown property "${key}"`);
    }
  }
  if (s.not) {
    const inner = [];
    check(s.not, v, at, inner, root);
    if (!inner.length) errors.push(`${at}: must not match ${JSON.stringify(s.not)}`);
  }
  for (const sub of s.allOf ?? []) check(sub, v, at, errors, root);
  // oneOf/anyOf: accepted when at least one branch matches (branches here never overlap).
  for (const key of ['oneOf', 'anyOf']) {
    if (!s[key]) continue;
    const branches = s[key].map((sub) => { const e = []; check(sub, v, at, e, root); return e; });
    if (!branches.some((e) => e.length === 0)) errors.push(`${at}: matches none of the allowed shapes (${branches.map((e) => e[0]).join(' | ')})`);
  }
  if (s.if) {
    const probe = [];
    check(s.if, v, at, probe, root);
    if (!probe.length && s.then) check(s.then, v, at, errors, root);
    else if (probe.length && s.else) check(s.else, v, at, errors, root);
  }
}
