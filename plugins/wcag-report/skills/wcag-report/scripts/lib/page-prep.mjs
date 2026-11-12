// Getting a page into a stable, fully rendered state before it is measured.
import path from 'node:path';
import { readJson } from './io.mjs';
import { REFS_DIR } from './paths.mjs';
import { isLocalHost } from './urls.mjs';

let consentCfg = null;
function consent() {
  if (!consentCfg) consentCfg = readJson(path.join(REFS_DIR, 'consent.json'));
  return consentCfg;
}

// Live sites must not receive form submissions or other writes from the audit; local sites are the user's own.
export async function guardRequests(context, baseUrl, allowWrites = false) {
  if (allowWrites || isLocalHost(new URL(baseUrl).hostname)) return;
  await context.route('**/*', (route) => {
    const m = route.request().method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue();
    return route.abort('blockedbyclient');
  });
}

// Load, wait for the network and the DOM to go quiet, scroll to trigger lazy content, return to the top.
export async function openPage(page, url, { timeoutMs = 45000 } = {}) {
  const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
  await settle(page);
  await lazyScroll(page);
  await settle(page, 2500);
  return response;
}

export async function settle(page, capMs = 5000) {
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(capMs, 4000) }); } catch { /* long-polling sites never go idle */ }
  try {
    await page.evaluate((cap) => new Promise((resolve) => {
      let timer = setTimeout(done, 500);
      const hard = setTimeout(done, cap);
      const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, 500); });
      function done() { obs.disconnect(); clearTimeout(timer); clearTimeout(hard); resolve(); }
      obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    }), capMs);
  } catch { /* navigation during the wait */ }
}

export async function lazyScroll(page, maxPx = 15000) {
  try {
    await page.evaluate(async (max) => {
      const step = Math.max(400, Math.floor(innerHeight * 0.9));
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let y = 0; y < Math.min(document.documentElement.scrollHeight, max); y += step) {
        scrollTo(0, y);
        await sleep(120);
      }
      scrollTo(0, 0);
      await sleep(300);
    }, maxPx);
  } catch { /* page navigated away */ }
}

// Finds an open consent banner. Returns a short description, or null.
export async function findConsent(page) {
  const cfg = consent();
  return page.evaluate((containers) => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 40 && r.height > 20 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
    };
    for (const sel of containers) {
      let el;
      try { el = document.querySelector(sel); } catch { continue; }
      if (el && shown(el) && /cookie|consent|privacy|datenschutz|куки|cookies|файлы|файли/i.test(el.innerText || el.textContent || '')) return sel;
    }
    // Shadow-DOM banners (some consent tools) only expose their host.
    const host = document.querySelector('#usercentrics-root, #cmpwrapper, [id*=consent i]');
    return host && host.shadowRoot && shown(host) ? 'shadow-host' : null;
  }, cfg.containers).catch(() => null);
}

// Dismiss with "reject" when offered, otherwise "accept". Returns 'rejected' | 'accepted' | null.
export async function dismissConsent(page) {
  const cfg = consent();
  const tryClick = async (selectors, texts) => {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.isVisible({ timeout: 200 })) { await loc.click({ timeout: 2000 }); return true; }
      } catch { /* next */ }
    }
    for (const t of texts) {
      const exact = new RegExp(`^\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
      for (const role of ['button', 'link']) {
        const loc = page.getByRole(role, { name: exact }).first();
        try {
          if (await loc.isVisible({ timeout: 150 })) { await loc.click({ timeout: 2000 }); return true; }
        } catch { /* next */ }
      }
    }
    return false;
  };
  if (await tryClick(cfg.reject, cfg.rejectTexts)) { await settle(page, 2000); return 'rejected'; }
  if (await tryClick(cfg.accept, cfg.acceptTexts)) { await settle(page, 2000); return 'accepted'; }
  return null;
}

// Bot challenges and rate limits: the page is an obstacle, not the site.
export async function detectBlock(page, status) {
  const info = await page.evaluate(() => ({
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, 2000),
  })).catch(() => ({ title: '', text: '' }));
  const marker = /just a moment|attention required|checking your browser|verify you are (a )?human|are you a robot|captcha|access denied|request blocked|cf-chl|ddos protection|bot detection|unusual traffic/i;
  if ([403, 429, 503].includes(status) && marker.test(`${info.title} ${info.text}`)) return `challenge (${status})`;
  if (status === 429) return 'rate limited (429)';
  if (marker.test(info.title)) return 'challenge page';
  return null;
}
