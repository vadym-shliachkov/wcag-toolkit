// UI strings for the report. Bundled languages live in references/i18n (today only en.json, and --lang accepts only
// bundled languages); a run folder may also hold text/i18n.<lang>.json. Missing keys fall back to English and are
// reported, so a half-translated report never goes out silently.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';
import { REFS_DIR } from './paths.mjs';

// Languages written in the Latin alphabet: in a report in one of them, Cyrillic outside a quote is a defect. For any
// other language (Ukrainian, Greek, Japanese, …) that check does not apply.
const LATIN_LANGS = new Set(['en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hr', 'ro', 'hu', 'fi', 'sv', 'da', 'no', 'nb', 'et', 'lv', 'lt', 'tr', 'id', 'ms', 'vi']);

export function baseLang(lang) {
  return String(lang ?? '').split('-')[0].trim().toLowerCase();
}

export function usesLatinScript(lang) {
  return LATIN_LANGS.has(baseLang(lang));
}

export function bundledLanguages() {
  return fs.readdirSync(path.join(REFS_DIR, 'i18n')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
}

function flatKeys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

function lookup(obj, key) {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

export function loadStrings(lang, runDir = null) {
  const en = readJson(path.join(REFS_DIR, 'i18n', 'en.json'));
  const base = lang.split('-')[0];
  const candidates = [
    path.join(REFS_DIR, 'i18n', `${lang}.json`),
    path.join(REFS_DIR, 'i18n', `${base}.json`),
    ...(runDir ? [path.join(runDir, 'text', `i18n.${lang}.json`), path.join(runDir, 'text', `i18n.${base}.json`)] : []),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  const strings = file ? readJson(file) : null;
  const missing = lang === 'en' ? [] : flatKeys(en).filter((k) => lookup(strings ?? {}, k) == null);

  const fill = (v, vars) => v.replace(/\{(\w+)\}/g, (m, name) => (vars[name] == null ? m : String(vars[name])));
  // t('a.b', { n: 3 }) → string with {n} replaced; in a list of strings each one is filled; objects are returned as is.
  function t(key, vars = {}) {
    let v = lookup(strings ?? {}, key);
    if (v == null) v = lookup(en, key);
    if (v == null) return key;
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? fill(x, vars) : x));
    if (typeof v !== 'string') return v;
    return fill(v, vars);
  }
  // tn('a.b', 3) uses the language's plural form "a.b_one", "a.b_few", "a.b_many" or "a.b_other", then "a.b".
  const rules = new Intl.PluralRules(lang);
  function tn(key, count, vars = {}) {
    const k = `${key}_${rules.select(count)}`;
    const has = (x) => lookup(strings ?? {}, x) != null || lookup(en, x) != null;
    return t(has(k) ? k : has(`${key}_other`) ? `${key}_other` : key, { n: count, ...vars });
  }
  return { t, tn, lang, source: file, missing };
}

export function englishKeys() {
  return flatKeys(readJson(path.join(REFS_DIR, 'i18n', 'en.json')));
}
