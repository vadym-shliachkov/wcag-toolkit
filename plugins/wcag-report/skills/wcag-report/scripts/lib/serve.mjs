// Runs a repository locally: install (lockfile only), build, then a detached server the later steps can reach.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect, outputFolder, portArgs } from './detect.mjs';
import { log } from './log.mjs';

const STATIC_SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static-server.mjs');
const WIN = process.platform === 'win32';

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Package managers are .cmd files on Windows, which Node only starts through a shell. Every argument we pass is one
// of our own fixed strings or a number, so quoting them for cmd.exe is safe.
function commandLine(cmd, args) {
  return [cmd, ...args].map((a) => (/^[\w@./:=-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`)).join(' ');
}

function runSync(cmd, args, { cwd, env, logFile, timeoutMs }) {
  fs.appendFileSync(logFile, `\n$ ${commandLine(cmd, args)}\n`);
  const r = WIN
    ? spawnSync(commandLine(cmd, args), { cwd, env, shell: true, encoding: 'utf8', timeout: timeoutMs, windowsHide: true })
    : spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs });
  fs.appendFileSync(logFile, `${r.stdout || ''}${r.stderr || ''}\n[exit ${r.status}${r.error ? ` ${r.error.message}` : ''}]\n`);
  return r.status === 0;
}

function startDetached(cmd, args, { cwd, env, logFile }) {
  const fd = fs.openSync(logFile, 'a');
  fs.writeSync(fd, `\n$ ${commandLine(cmd, args)}\n`);
  const child = WIN
    ? spawn(commandLine(cmd, args), { cwd, env, shell: true, detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
    : spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
  child.unref();
  fs.closeSync(fd);
  return child.pid;
}

export async function waitForServer(url, { timeoutMs = 180000, logFile, pid } = {}) {
  const until = Date.now() + timeoutMs;
  let sniffed = null;
  while (Date.now() < until) {
    for (const candidate of [url, sniffed].filter(Boolean)) {
      try {
        const res = await fetch(candidate, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
        if (res.status < 500) return candidate;
      } catch { /* not up yet */ }
    }
    // Some frameworks ignore the port we ask for; they print the one they chose.
    if (logFile && fs.existsSync(logFile)) {
      const m = fs.readFileSync(logFile, 'utf8').match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})[^\s"'`]*/g);
      if (m) sniffed = m[m.length - 1].replace('0.0.0.0', '127.0.0.1').replace(/\x1b\[[0-9;]*m/g, '');
    }
    if (pid && !alive(pid)) return null;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function stopTree(pid) {
  if (!pid) return false;
  try {
    if (WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
    else { try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); } }
    return true;
  } catch { return false; }
}

async function serveStatic(dir, { spa, logFile }) {
  const port = await freePort();
  const args = [STATIC_SERVER, '--dir', dir, '--port', String(port), ...(spa ? ['--spa'] : [])];
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref();
  fs.closeSync(fd);
  const url = await waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: 20000, pid: child.pid });
  return { pid: child.pid, port, baseUrl: url };
}

// state: the previous serve.json (lets an interrupted install/build continue). Returns the new serve.json content.
export async function serveRepo(repo, { logFile, state = {}, budgetMs = 540000 } = {}) {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const plan = state.plan || detect(repo);
  const out = { ...state, plan, stack: plan.stack, repo };
  if (plan.kind === 'unsupported') return { ...out, ok: false, fallback: 'static', reason: plan.reason };

  if (plan.kind === 'static') {
    const s = await serveStatic(plan.dir, { spa: plan.spa, logFile });
    if (!s.baseUrl) return { ...out, ok: false, fallback: 'static', reason: 'The local static server did not start.' };
    return { ...out, ok: true, done: true, ...s, servedDir: plan.dir };
  }

  const env = { ...process.env, BROWSER: 'none', CI: '1', NODE_ENV: undefined, FORCE_COLOR: '0', NO_COLOR: '1' };
  delete env.NODE_ENV;
  if (plan.install && !out.installed) {
    log('serve', 'installing dependencies with', plan.install[0]);
    if (!runSync(plan.install[0], plan.install[1], { cwd: plan.dir, env, logFile, timeoutMs: Math.max(60000, Math.min(600000, left())) })) {
      return { ...out, ok: false, fallback: 'static', reason: `Installing the project's dependencies failed (see serve.log).` };
    }
    out.installed = true;
    if (left() < 60000) return { ...out, ok: true, done: false };
  }
  if (plan.build && !out.built) {
    log('serve', 'building', `${plan.pm} run ${plan.build}`);
    if (!runSync(plan.pm, ['run', plan.build], { cwd: plan.dir, env, logFile, timeoutMs: Math.max(60000, Math.min(600000, left())) })) {
      return { ...out, ok: false, fallback: 'static', reason: `The build script "${plan.build}" failed (see serve.log).` };
    }
    out.built = true;
    if (left() < 30000) return { ...out, ok: true, done: false };
  }
  if (plan.kind === 'node-static') {
    const folder = outputFolder(plan.dir);
    if (!folder) return { ...out, ok: false, fallback: 'static', reason: 'The build finished but no output folder with index.html was found.' };
    const s = await serveStatic(folder, { spa: false, logFile });
    if (!s.baseUrl) return { ...out, ok: false, fallback: 'static', reason: 'The local static server did not start.' };
    return { ...out, ok: true, done: true, ...s, servedDir: folder };
  }

  const port = await freePort();
  const args = ['run', plan.start];
  const extra = portArgs(plan.framework, port);
  if (extra.length) args.push('--', ...extra);
  const pid = startDetached(plan.pm, args, { cwd: plan.dir, env: { ...env, PORT: String(port), HOST: '127.0.0.1' }, logFile });
  const baseUrl = await waitForServer(`http://127.0.0.1:${port}/`, { timeoutMs: Math.min(180000, Math.max(30000, left())), logFile, pid });
  if (!baseUrl) {
    stopTree(pid);
    return { ...out, ok: false, fallback: 'static', reason: `The "${plan.start}" script did not start a server that answers (see serve.log).` };
  }
  return { ...out, ok: true, done: true, pid, port, baseUrl: new URL(baseUrl).href };
}
