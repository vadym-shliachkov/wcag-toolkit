// Works out how to run a repository locally: a static folder we serve ourselves, or a Node project with its own
// build and server scripts. Returns a plan; nothing is executed here.
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './io.mjs';

const STATIC_DIRS = ['', 'public', 'dist', 'build', 'out', '_site', 'site', 'docs', 'www', 'html'];

const has = (dir, f) => fs.existsSync(path.join(dir, f));

function packageManager(dir, pkg) {
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg?.packageManager || '');
  if (declared) return declared[1];
  if (has(dir, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(dir, 'yarn.lock')) return 'yarn';
  if (has(dir, 'bun.lockb') || has(dir, 'bun.lock')) return 'bun';
  return 'npm';
}

// Installs use the lockfile and never write it.
export function installCommand(dir, pm, pkg = null) {
  if (has(dir, 'node_modules')) return null;
  // Nothing to install: running a package manager would only add an empty node_modules to the user's repo.
  if (pkg && !Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).length) return null;
  if (pm === 'pnpm') return ['pnpm', ['install', '--frozen-lockfile']];
  if (pm === 'yarn') return ['yarn', has(dir, '.yarnrc.yml') ? ['install', '--immutable'] : ['install', '--frozen-lockfile', '--non-interactive']];
  if (pm === 'bun') return ['bun', ['install', '--frozen-lockfile']];
  if (has(dir, 'package-lock.json') || has(dir, 'npm-shrinkwrap.json')) return ['npm', ['ci', '--no-audit', '--no-fund']];
  return ['npm', ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund']];
}

export function framework(pkg) {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const order = [
    ['next', 'next'], ['nuxt', 'nuxt'], ['@sveltejs/kit', 'sveltekit'], ['astro', 'astro'], ['@remix-run/dev', 'remix'],
    ['gatsby', 'gatsby'], ['react-scripts', 'cra'], ['@angular/cli', 'angular'], ['@vue/cli-service', 'vue-cli'],
    ['@11ty/eleventy', 'eleventy'], ['vite', 'vite'],
  ];
  for (const [dep, name] of order) if (deps[dep]) return name;
  return null;
}

// Extra arguments that make each framework's server listen on our port and host.
export function portArgs(fw, port) {
  switch (fw) {
    case 'vite': case 'astro': case 'sveltekit': case 'remix': return ['--port', String(port), '--strictPort', '--host', '127.0.0.1'];
    case 'next': return ['-p', String(port), '-H', '127.0.0.1'];
    case 'gatsby': return ['-p', String(port), '-H', '127.0.0.1'];
    case 'angular': return ['--port', String(port), '--host', '127.0.0.1'];
    case 'nuxt': return ['--port', String(port), '--host', '127.0.0.1'];
    case 'eleventy': return ['--port', String(port)];
    case 'vue-cli': return ['--port', String(port), '--host', '127.0.0.1'];
    default: return [];
  }
}

function staticFolder(dir) {
  for (const d of STATIC_DIRS) {
    const full = path.join(dir, d);
    if (has(full, 'index.html') || has(full, 'index.htm')) return full;
  }
  return null;
}

export function detect(dir) {
  const pkgPath = path.join(dir, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? readJson(pkgPath) : null;
  const scripts = pkg?.scripts || {};

  if (has(dir, 'wp-config.php') || has(dir, 'wp-content') || (has(dir, 'index.php') && !pkg)) {
    const out = staticFolder(dir);
    if (out) return { kind: 'static', stack: 'php-with-static', dir: out, spa: false };
    return { kind: 'unsupported', stack: 'php', reason: 'This is a PHP site, which cannot be run here. Give its address with --url.' };
  }

  if (pkg && (scripts.build || scripts.preview || scripts.start || scripts.dev || scripts.serve)) {
    const pm = packageManager(dir, pkg);
    const fw = framework(pkg);
    // Production-like first: built output served by its own preview/start server.
    let build = null;
    let start = null;
    if (scripts.build && (scripts.preview || scripts.start || scripts.serve)) {
      build = 'build';
      start = scripts.preview ? 'preview' : scripts.start ? 'start' : 'serve';
    } else if (scripts.dev) start = 'dev';
    else if (scripts.start) start = 'start';
    else if (scripts.serve) start = 'serve';
    else if (scripts.preview) start = 'preview';
    if (start) {
      return { kind: 'node', stack: fw || 'node', dir, pm, framework: fw, install: installCommand(dir, pm, pkg), build, start };
    }
    // A build script without a server: build, then serve the output folder ourselves.
    if (scripts.build) return { kind: 'node-static', stack: fw || 'node', dir, pm, framework: fw, install: installCommand(dir, pm, pkg), build: 'build', start: null };
  }

  if (has(dir, 'hugo.toml') || has(dir, 'config.toml') || has(dir, '_config.yml')) {
    const out = ['public', '_site'].map((d) => path.join(dir, d)).find((d) => has(d, 'index.html'));
    if (out) return { kind: 'static', stack: has(dir, '_config.yml') ? 'jekyll-output' : 'hugo-output', dir: out, spa: false };
  }

  const folder = staticFolder(dir);
  if (folder) return { kind: 'static', stack: 'static', dir: folder, spa: !fs.readdirSync(folder).some((f) => /\.html?$/.test(f) && !/^index\.html?$/.test(f)) };
  return { kind: 'unsupported', stack: 'unknown', reason: 'No index.html and no package.json scripts to build or start the site were found.' };
}

// Where a framework puts its build output when we have to serve it ourselves.
export function outputFolder(dir) {
  for (const d of ['dist', 'build', 'out', '_site', 'public', '.output/public']) {
    if (has(path.join(dir, d), 'index.html')) return path.join(dir, d);
  }
  return null;
}
