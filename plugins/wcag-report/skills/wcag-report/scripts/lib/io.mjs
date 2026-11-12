import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (arguments.length > 1) return fallback;
    throw new Error(`File not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

// Subagents sometimes wrap their JSON in a fence or a sentence; take the first top-level object that parses.
export function parseLooseJson(text) {
  let t = String(text).replace(/^﻿/, '').trim();
  const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch { /* look for an object inside surrounding prose */ }
  for (const span of topLevelObjectSpans(t)) {
    let value;
    try { value = JSON.parse(span); } catch { continue; }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  throw new Error('No JSON object found');
}

function topLevelObjectSpans(t) {
  const spans = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (depth === 0) {
      if (c === '{') { depth = 1; start = i; }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}' && --depth === 0) spans.push(t.slice(start, i + 1));
  }
  return spans;
}

export function sha256File(file) {
  return import('node:crypto').then(({ createHash }) => createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}

export function listFiles(dir, re = /./) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => path.join(dir, f));
}
