// Plumbing shared by the deep checks: opening a page the way a visitor sees it, the in-page helpers, consent
// banners, blocking side effects, and building Signal records in the contract shape.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newContext } from '../browser.mjs';
import { readJson, writeJson } from '../io.mjs';
import { REFS_DIR } from '../paths.mjs';
import { log } from '../log.mjs';

const HELPERS = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'inpage', 'helpers.js'), 'utf8');

export const DESKTOP = { width: 1280, height: 900 };
export const NARROW = { width: 320, height: 640 };

export async function injectHelpers(page) {
  await page.evaluate(HELPERS);
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|0\.0\.0\.0)$/i;

export function isLocal(url) {
  try { return LOCAL_HOST.test(new URL(url).hostname); } catch { return false; }
}

// Interactions must never change anything on a live site: every request that is not a GET is aborted, and so is any
// navigation of the main frame away from the page under test (a submitted search form, a clicked link).
export async function guardSideEffects(page, url, { allowNavigation = false } = {}) {
  const remote = !isLocal(url);
  let armed = false;
  // Every aborted write is logged with its body: a form counts as sent only when a request carries its own fields,
  // never because a captcha, chat or analytics script posted something in the background.
  const blocked = { writes: 0, navigations: 0, log: [] };
  await page.route('**/*', (route) => {
    const req = route.request();
    if (remote && req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS') {
      blocked.writes += 1;
      let body = '';
      try { body = req.postData() ?? ''; } catch { /* binary body */ }
      blocked.log.push({ url: req.url(), body: body.slice(0, 20000) });
      return route.abort();
    }
    if (armed && !allowNavigation && req.isNavigationRequest() && req.frame() === page.mainFrame()) { blocked.navigations += 1; blocked.lastNavigation = req.url(); return route.abort(); }
    return route.continue();
  });
  return { arm: () => { armed = true; }, blocked };
}

// The writes since mark that carry at least one of the form's field names (URL-encoded, multipart or JSON).
export function formWrites(blocked, mark, names) {
  const keys = names.filter(Boolean).flatMap((n) => [n, encodeURIComponent(n), JSON.stringify(n)]);
  return blocked.log.slice(mark).filter((w) => keys.some((k) => w.body.includes(k))).length;
}

// consent.json keeps button selectors under "reject"/"accept" and button words under "rejectTexts"/"acceptTexts".
// Reading the selector lists as words (an earlier layout) meant no banner was ever closed by its button text.
export function consentFromFile(cfg) {
  const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
  const looksLikeSelector = (s) => /^[#.[]|^\w+\[/.test(s);
  const words = (v) => strings(v).filter((s) => !looksLikeSelector(s)).map((s) => s.toLowerCase());
  return {
    containers: strings(cfg?.containers),
    // Reject buttons first: rejecting leaves the least state behind.
    selectors: [...strings(cfg?.selectors ?? cfg?.dismissSelectors), ...strings(cfg?.reject).filter(looksLikeSelector), ...strings(cfg?.accept).filter(looksLikeSelector)],
    reject: words(cfg?.rejectTexts ?? cfg?.texts?.reject ?? cfg?.reject),
    accept: words(cfg?.acceptTexts ?? cfg?.texts?.accept ?? cfg?.accept),
  };
}

let consentCfg;
function consentConfig() {
  if (consentCfg !== undefined) return consentCfg;
  const cfg = readJson(path.join(REFS_DIR, 'consent.json'), null);
  consentCfg = consentFromFile(cfg);
  if (!consentCfg.reject.length) consentCfg.reject = ['reject all', 'reject', 'decline', 'only necessary', 'necessary only', 'deny', 'отклонить', 'відхилити', 'ablehnen', 'refuser'];
  if (!consentCfg.accept.length) consentCfg.accept = ['accept all', 'accept', 'agree', 'allow all', 'got it', 'ok', 'i agree', 'принять', 'согласен', 'прийняти', 'akzeptieren', 'accepter'];
  return consentCfg;
}

// Close a cookie or consent banner so it does not cover what a check measures. "Reject" is preferred: it leaves the
// least state behind. Returns what happened, for the notes.
// Banners loaded by a script (many consent tools) appear a moment after the page settles; dismissing before that
// clicks nothing, or the wrong thing, and the banner then covers every measurement. Wait for one to show up, but
// only until a page of this run has shown that the site has no banner at all.
let bannerWait = 'unknown'; // 'unknown' | 'seen' | 'none'
async function waitForBanner(page, containers) {
  if (bannerWait === 'none' || !containers.length) return;
  const found = await page.waitForFunction((sels) => sels.some((s) => {
    try {
      const e = document.querySelector(s);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 20 && getComputedStyle(e).visibility !== 'hidden' && /cookie|consent|privacy|datenschutz/i.test(e.textContent || '');
    } catch { return false; }
  }), containers, { timeout: bannerWait === 'seen' ? 6000 : 4000 }).then(() => true).catch(() => false);
  if (found) bannerWait = 'seen';
  else if (bannerWait === 'unknown') bannerWait = 'none';
}

export async function dismissConsent(page) {
  const cfg = consentConfig();
  await waitForBanner(page, cfg.containers);
  for (const s of cfg.selectors) {
    try {
      const loc = page.locator(s).first();
      if (await loc.isVisible({ timeout: 200 })) { await loc.click({ timeout: 1500 }); await page.waitForTimeout(300); return 'dismissed'; }
    } catch { /* try the next one */ }
  }
  const clicked = await page.evaluate(({ reject, accept }) => {
    const roots = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],[aria-label*=cookie i],[role=dialog],[role=alertdialog]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; });
    for (const words of [reject, accept]) {
      for (const root of roots) {
        // Plain boxes with a click handler count too: a banner built from them is common, and is itself a finding.
        const btns = [...root.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit],[onclick],[tabindex],div,span')]
          .filter((b) => b.children.length === 0 || b.matches('button,a,[role=button]'));
        const hit = btns.find((b) => {
          const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
          return t && words.some((w) => t === w || (t.length < 40 && t.includes(w)));
        });
        if (hit) { hit.click(); return true; }
      }
    }
    return false;
  }, { reject: cfg.reject, accept: cfg.accept }).catch(() => false);
  if (clicked) { await page.waitForTimeout(400); return 'dismissed'; }
  return 'none';
}

// Wait until no consent container is on screen any more (banners fade out over a second or so).
async function waitBannerGone(page, containers) {
  await page.waitForFunction((sels) => !sels.some((s) => {
    try {
      const e = document.querySelector(s);
      if (!e) return false;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 40 && r.height > 20 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && /cookie|consent|privacy|datenschutz/i.test(e.textContent || '');
    } catch { return false; }
  }), containers, { timeout: 2500 }).catch(() => {});
}

// Marketing pop-ups that open on their own (newsletter, offers) sit over the page and often keep keyboard focus
// inside them, so every check would measure the pop-up instead of the page. A visitor closes one once; the checks
// do the same. The pop-up itself is page content, reviewed on the pages where it was open during the crawl.
export async function dismissPopups(page) {
  const closed = await page.evaluate(() => {
    const out = [];
    const vw = innerWidth;
    const vh = innerHeight;
    const shown = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05; };
    const big = (e) => { const r = e.getBoundingClientRect(); return (Math.min(r.right, vw) - Math.max(r.left, 0)) * (Math.min(r.bottom, vh) - Math.max(r.top, 0)) > vw * vh * 0.15; };
    const fixedish = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed') return true; } return false; };
    const candidates = [...document.querySelectorAll('[role=dialog],[aria-modal=true],[class*=modal i],[class*=popup i],[id*=popup i],[id*=modal i],[class*=overlay i],[id*=overlay i],[class*=lightbox i]')]
      .filter((e) => shown(e) && big(e) && fixedish(e) && !/cookie|consent|gdpr/i.test(`${e.id} ${e.className}`));
    const CLOSE = /^(close|dismiss|no thanks|no, thanks|not now|maybe later|skip|×|✕|✖|x)$/i;
    for (const root of candidates) {
      const btn = [...root.querySelectorAll('button,a,[role=button],[aria-label],[title]')].find((b) => {
        if (!shown(b)) return false;
        const label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || '').trim();
        return CLOSE.test(label) || /\bclose\b/i.test(b.getAttribute('aria-label') || '') || /(^|[-_ ])close([-_ ]|$)/i.test(String(b.className));
      });
      if (btn) { btn.click(); out.push(root.id ? `#${root.id}` : root.tagName.toLowerCase()); }
    }
    return out;
  }).catch(() => []);
  if (!closed.length) {
    // A dialog without a close control we could name: Escape is the standard way out.
    const open = await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[aria-modal=true]')].some((e) => e.getBoundingClientRect().height > 0)).catch(() => false);
    if (open) await page.keyboard.press('Escape').catch(() => {});
  }
  if (closed.length) await page.waitForTimeout(600);
  return closed;
}

// The browser lost the network (this machine went offline, Wi-Fi changed, DNS failed): nothing about the page was
// learned, so the result must not be saved as "the page did not load" — the step is left to run again.
export const REFUSED_REASON = 'Not tested: the website refused the review\'s browser (HTTP 403, bot protection or rate limit) when this check ran.';
export const isRefusal = (message) => /HTTP (403|429|503): the site refused the request/.test(String(message));
export const skipRefused = () => process.env.WR_SKIP_REFUSED === '1';
// refused.json in the run folder: every page the site turned away, so the report can say what was not covered.
export function noteRefused(runDir, entry) {
  if (!runDir) return;
  const file = path.join(runDir, 'refused.json');
  const list = readJson(file, []);
  if (!list.some((x) => x.pageId === entry.pageId && x.step === entry.step)) list.push({ ...entry, at: new Date().toISOString() });
  writeJson(file, list);
}

export function isNetworkError(message) {
  if (/HTTP (403|429|503): the site refused the request/.test(String(message))) return true;
  return /net::ERR_(INTERNET_DISCONNECTED|NETWORK_CHANGED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|NETWORK_ACCESS_DENIED|PROXY_CONNECTION_FAILED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|TIMED_OUT)/.test(String(message));
}

// Load a page, wait until it stops changing, close the consent banner and install the helpers.
export async function openPage(env, { viewport = DESKTOP, deviceScaleFactor = 1, reducedMotion, guard = true, consent = true } = {}) {
  const context = await newContext(env.browser, {
    viewport,
    deviceScaleFactor,
    reducedMotion,
    storageState: env.options?.auth || undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const guardCtl = guard ? await guardSideEffects(page, env.url) : { arm() {}, blocked: { writes: 0, navigations: 0 } };
  try {
    // WR_PACE_MS: a pause before each page load, for sites whose firewall turns away a fast sequence of visits.
    const pace = Number(process.env.WR_PACE_MS || 0);
    if (pace > 0) await new Promise((r) => setTimeout(r, pace));
    const res = await page.goto(env.url, { waitUntil: 'load', timeout: 45000 });
    // The crawl saw this page load. A refusal now (a firewall rate-limiting the review, a challenge page) is the site
    // turning the tester away, not the page: measuring the "Forbidden" page would fill the report with nonsense.
    const status = res ? res.status() : 0;
    if (status === 403 || status === 429 || status === 503) throw new Error(`HTTP ${status}: the site refused the request (rate limit or bot protection)`);
  } catch (e) {
    await context.close();
    throw new Error(`Could not load ${env.url}: ${String(e.message).split('\n')[0]}`);
  }
  await settle(page);
  const consentResult = consent ? await dismissConsent(page) : 'kept';
  if (consent) {
    await waitBannerGone(page, consentConfig().containers);
    await dismissPopups(page);
  }
  // A site with `scroll-behavior: smooth` animates every scrollIntoView, so a box measured right after it is where the
  // element was before the scroll. Scrolling is made instant; no check measures the scroll animation itself.
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'html,body{scroll-behavior:auto!important}'; document.head.append(s); }).catch(() => {});
  await injectHelpers(page);
  guardCtl.arm();
  return { context, page, consent: consentResult, blocked: guardCtl.blocked };
}

export async function settle(page, quietMs = 400) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  // Wait until the DOM has been quiet for a moment (skeleton screens, late widgets), at most 4 s.
  await page.evaluate((quiet) => new Promise((resolve) => {
    let t = setTimeout(done, quiet);
    const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(done, quiet); });
    const cap = setTimeout(done, 4000);
    function done() { mo.disconnect(); clearTimeout(cap); resolve(); }
    mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  }), quietMs).catch(() => {});
}

export function environment(page, viewport, extra = {}) {
  return { viewport: [viewport.width, viewport.height], zoom: 100, input: 'keyboard', userAgent: null, ...extra };
}

// A Signal in the contract shape. `base` carries the page context, `f` the finding.
export function signal(base, f) {
  return {
    source: 'deep',
    check: f.check,
    sc: f.sc,
    status: f.status,
    pageId: base.pageId,
    url: base.url,
    state: f.state ?? 'default',
    viewport: f.viewport ?? [DESKTOP.width, DESKTOP.height],
    selector: f.selector ?? null,
    html: f.html ?? null,
    bbox: f.bbox ?? null,
    description: f.description,
    measured: f.measured ?? {},
    ...(f.status === 'needs_review' ? { question: f.question ?? 'A person needs to confirm this.' } : {}),
    barrier: f.barrier ?? 'minor',
    trust: f.trust ?? (f.status === 'fail' ? 'confirmed' : 'review'),
    evidence: f.evidence ?? [],
    expected: f.expected ?? '',
    steps: f.steps ?? [],
  };
}

// The "this branch was exercised and nothing was found" record analysis needs before it may call a criterion passed.
export function passSignal(base, { check, sc, description, expected, steps, state, viewport, evidence }) {
  return signal(base, { check, sc: [sc], status: 'pass', description, expected, steps, state, viewport, evidence, barrier: 'minor', trust: 'confirmed' });
}

export function writeArtifact(env, name, data) {
  const file = path.join(env.outDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : `${JSON.stringify(data, null, 2)}\n`);
  return `${env.relDir}/${name}`.replace(/\\/g, '/');
}

export function skeleton(selector) {
  return String(selector || '').replace(/:nth-of-type\(\d+\)/g, '').replace(/#[\w-]+/g, '#id');
}

// Keep at most `perKind` signals per selector skeleton so one repeated component does not flood the results.
export function capByKind(items, perKind = 3, total = 30) {
  const seen = new Map();
  const out = [];
  for (const it of items) {
    const k = skeleton(it.selector);
    const n = seen.get(k) ?? 0;
    if (n >= perKind) continue;
    seen.set(k, n + 1);
    out.push(it);
    if (out.length >= total) break;
  }
  return out;
}

export function warn(...parts) {
  log('deep:', ...parts);
}

// axe tags such as "wcag1410" → "1.4.10". 4.1.1 is never reported (removed from WCAG 2.2).
export function scFromTags(tags = []) {
  const out = [];
  for (const t of tags) {
    const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t);
    if (m) {
      const sc = `${m[1]}.${m[2]}.${m[3]}`;
      if (sc !== '4.1.1' && !out.includes(sc)) out.push(sc);
    }
  }
  return out;
}

export function axeTags(level) {
  const tags = ['wcag2a', 'wcag21a', 'wcag22a'];
  if (level === 'AA' || level === 'AAA') tags.push('wcag2aa', 'wcag21aa', 'wcag22aa');
  if (level === 'AAA') tags.push('wcag2aaa', 'wcag21aaa');
  return tags;
}

export const IMPACT_BARRIER = { critical: 'blocker', serious: 'major', moderate: 'minor', minor: 'minor' };
