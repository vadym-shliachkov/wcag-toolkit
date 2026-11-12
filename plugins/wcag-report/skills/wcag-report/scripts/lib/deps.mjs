// Runtime dependencies (playwright-core, axe-core, pdfjs-dist) live in a per-user cache keyed by the lockfile hash.
// Claude Code and Codex keep separate copies of the plugin and replace them on update; the cache is shared by both,
// installed once, and the plugin folder never needs to be writable.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SCRIPTS_DIR } from './paths.mjs';

export const DEPS_SRC = path.join(SCRIPTS_DIR, 'deps');
export const REQUIRED = ['playwright-core', 'axe-core', 'pdfjs-dist'];

export function cacheRoot(env = process.env, platform = process.platform) {
  if (env.WR_DEPS_DIR) return env.WR_DEPS_DIR;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'wcag-report', 'deps');
  if (platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'wcag-report', 'deps');
  return path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'wcag-report', 'deps');
}

export function lockHash() {
  return createHash('sha256').update(fs.readFileSync(path.join(DEPS_SRC, 'package-lock.json'))).digest('hex').slice(0, 12);
}

export function depsDir() {
  return path.join(cacheRoot(), lockHash());
}

function hasAll(dir) {
  return REQUIRED.every((n) => fs.existsSync(path.join(dir, 'node_modules', n, 'package.json')));
}

// A developer checkout may have the deps installed next to the manifest; prefer the cache otherwise.
export function findDeps() {
  for (const dir of [depsDir(), DEPS_SRC]) if (hasAll(dir)) return dir;
  return null;
}

export function depsStatus() {
  const dir = findDeps();
  if (!dir) return { ok: false, dir: depsDir(), needs: 'setup' };
  const req = createRequire(path.join(dir, 'package.json'));
  const versions = Object.fromEntries(REQUIRED.map((n) => [n, req(`${n}/package.json`).version]));
  return { ok: true, dir, versions };
}

export function setup({ offline = false } = {}) {
  const dir = depsDir();
  if (hasAll(dir)) return { ok: true, dir, installed: false };
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(DEPS_SRC, f), path.join(dir, f));
  const args = ['ci', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--ignore-scripts'];
  if (offline) args.push('--offline'); else args.push('--prefer-offline');
  // npm is a .cmd on Windows, which Node only spawns through a shell; the arguments are fixed strings, so one
  // command line is safe there.
  const r = process.platform === 'win32'
    ? spawnSync(`npm ${args.join(' ')}`, { cwd: dir, shell: true, encoding: 'utf8', timeout: 600000 })
    : spawnSync('npm', args, { cwd: dir, encoding: 'utf8', timeout: 600000 });
  if (r.status !== 0 || !hasAll(dir)) {
    return { ok: false, dir, error: `npm ci failed (exit ${r.status}): ${String(r.stderr || r.stdout || '').trim().slice(-600)}` };
  }
  return { ok: true, dir, installed: true };
}

function requireFrom() {
  const dir = findDeps();
  if (!dir) {
    throw new Error('Runtime dependencies are not installed. Run: node "<SKILL_DIR>/scripts/wr.mjs" setup');
  }
  return createRequire(path.join(dir, 'package.json'));
}

export function requireDep(name) {
  return requireFrom()(name);
}

export function resolveDep(spec) {
  return requireFrom().resolve(spec);
}

export async function importDep(spec) {
  return import(pathToFileURL(resolveDep(spec)).href);
}

export function axeSource() {
  return fs.readFileSync(resolveDep('axe-core/axe.min.js'), 'utf8');
}

export async function pdfjs() {
  return importDep('pdfjs-dist/legacy/build/pdf.mjs');
}
