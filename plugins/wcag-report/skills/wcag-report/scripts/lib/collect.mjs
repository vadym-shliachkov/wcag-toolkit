// Runs the in-page collectors and redacts what they return.
import fs from 'node:fs';
import path from 'node:path';
import { SCRIPTS_DIR } from './paths.mjs';

const INPAGE = path.join(SCRIPTS_DIR, 'inpage');
const scripts = {};

export function inpage(name) {
  if (!scripts[name]) scripts[name] = fs.readFileSync(path.join(INPAGE, `${name}.js`), 'utf8').trim().replace(/;\s*$/, '');
  return scripts[name];
}

// Evaluates an in-page script file (an arrow-function expression) with one JSON argument.
export function runInpage(page, name, arg) {
  return page.evaluate(`(${inpage(name)})(${JSON.stringify(arg ?? null)})`);
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?<![\w/])\+?\d[\d\s().-]{7,}\d(?![\w/])/g;
const TOKEN = /\b(?:eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}|[A-Za-z0-9_-]{32,}|(?:sk|pk|ghp|gho|xox[abp])_[A-Za-z0-9_-]{10,})\b/g;
const SECRET_PARAMS = /([?&](?:token|access_token|auth|key|api_key|apikey|sig|signature|session|sessionid|sid|code|password|pwd)=)[^&#]*/gi;

// A long run of word characters is a secret only when it looks random. A readable slug made of words and short
// numbers ("telecommunications-communications", "california-closets-design-consultation-2024") is a page address or a
// file name the owner needs to see, and has no digits mixed into its words.
export function isSlug(m) {
  if (m.startsWith('eyJ') || /^(?:sk|pk|ghp|gho|xox[abp])_/.test(m)) return false;
  const parts = m.split(/[-_]+/).filter(Boolean);
  return parts.length > 1 && parts.every((x) => /^[a-z]+$/i.test(x) || /^\d{1,4}$/.test(x));
}

// Personal data and secrets never leave the page as text: the subagents and the report only see the redacted form.
export function redactString(s, { personal = false } = {}) {
  if (typeof s !== 'string' || !s) return s;
  let out = s.replace(SECRET_PARAMS, '$1[redacted]').replace(TOKEN, (m) => (isSlug(m) ? m : '[redacted]'));
  if (personal) out = out.replace(EMAIL, '[email]').replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m));
  return out;
}

export function redactDeep(value, opts) {
  if (typeof value === 'string') return redactString(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, opts));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = k === 'selector' || k === 'fingerprint' ? v : redactDeep(v, opts);
    return out;
  }
  return value;
}

export async function collectPage(page, { pageId, mask = [], personal = false }) {
  const data = await runInpage(page, 'collect', { mask });
  const fingerprint = await runInpage(page, 'fingerprint');
  return redactDeep({ pageId, ...data, fingerprint }, { personal });
}
