import fs from 'node:fs';
import path from 'node:path';
import { requireDep } from './deps.mjs';
import { log } from './log.mjs';

export function systemBrowserCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((r) => [
      path.win32.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.win32.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.win32.join(r, 'Chromium', 'Application', 'chrome.exe'),
    ]);
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}

// The first option that launches wins: an explicit path, Playwright's own Chromium (exact revision match), installed
// Chrome, installed Edge, any system Chromium.
function launchPlans(explicit) {
  const plans = [];
  const exe = explicit || process.env.WR_BROWSER || process.env.CHROME_PATH;
  if (exe) plans.push({ label: exe, opts: { executablePath: exe } });
  plans.push({ label: 'playwright-chromium', opts: {} });
  plans.push({ label: 'chrome', opts: { channel: 'chrome' } });
  plans.push({ label: 'msedge', opts: { channel: 'msedge' } });
  for (const p of systemBrowserCandidates()) if (fs.existsSync(p)) plans.push({ label: p, opts: { executablePath: p } });
  return plans;
}

let cached = null;

export async function launchBrowser({ explicit, headless = true } = {}) {
  const { chromium } = requireDep('playwright-core');
  const errors = [];
  for (const plan of launchPlans(explicit)) {
    for (const extra of [{}, ...(process.platform === 'linux' ? [{ chromiumSandbox: false }] : [])]) {
      try {
        const browser = await chromium.launch({ headless, ...plan.opts, ...extra });
        return { browser, label: plan.label, version: browser.version() };
      } catch (e) {
        errors.push(`${plan.label}: ${String(e.message).split('\n')[0]}`);
      }
    }
  }
  throw new Error(`No browser could be launched. Install Chrome or Edge, or set WR_BROWSER. Tried: ${errors.join(' | ')}`);
}

// One browser per process; commands are short-lived, so it is closed by closeBrowser() at the end of a command.
export async function getBrowser(opts) {
  if (!cached) {
    cached = await launchBrowser(opts);
    log('browser', cached.label, cached.version);
  }
  return cached;
}

export async function closeBrowser() {
  if (cached) {
    try { await cached.browser.close(); } catch { /* already gone */ }
    cached = null;
  }
}

// HTTP Basic credentials for a password-protected site (staging behind .htaccess), read from the file given to
// `init --http-auth`. Only the file's path is stored in run.json; the password never enters run data or the report.
// They are sent to the audited site's origin only, never to frames or requests from other domains.
let httpAuth = null;

export function readHttpAuth(file, siteUrl) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw?.username || typeof raw.password !== 'string') throw new Error(`--http-auth file needs "username" and "password": ${file}`);
  const origin = raw.origin || (siteUrl ? new URL(siteUrl).origin : null);
  if (!origin) throw new Error('--http-auth needs the site address (--url) or an "origin" in the file.');
  return { username: String(raw.username), password: raw.password, origin: new URL(origin).origin };
}

export function setHttpAuth(creds) { httpAuth = creds; }

// The Authorization header for plain requests (robots.txt, sitemaps) to the audited origin; nothing for other origins.
export function authHeader(url) {
  try {
    if (!httpAuth || new URL(url).origin !== httpAuth.origin) return {};
  } catch { return {}; }
  return { authorization: `Basic ${Buffer.from(`${httpAuth.username}:${httpAuth.password}`).toString('base64')}` };
}

// A context that looks like the user's Chrome rather than "HeadlessChrome", which naive bot filters block.
export async function newContext(browser, { viewport = { width: 1280, height: 900 }, deviceScaleFactor = 1, storageState, reducedMotion, locale, extra = {} } = {}) {
  const probe = await browser.newContext();
  const page = await probe.newPage();
  const ua = (await page.evaluate(() => navigator.userAgent)).replace('HeadlessChrome', 'Chrome');
  await probe.close();
  return browser.newContext({
    viewport,
    deviceScaleFactor,
    userAgent: ua,
    ignoreHTTPSErrors: true,
    ...(storageState ? { storageState } : {}),
    ...(httpAuth ? { httpCredentials: { ...httpAuth, send: 'unauthorized' } } : {}),
    ...(reducedMotion ? { reducedMotion } : {}),
    ...(locale ? { locale } : {}),
    ...extra,
  });
}
