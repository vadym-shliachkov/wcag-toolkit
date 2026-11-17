// Breadth-first crawl of one site. Every page result is written to disk as soon as it exists, and the queue lives in
// crawl-state.json, so a crawl that runs out of its time budget continues exactly where it stopped on the next call.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readJson, writeJson } from './io.mjs';
import { getBrowser, newContext, authHeader } from './browser.mjs';
import { log } from './log.mjs';
import { normalize, pageKey, sameSite, urlKind, isLogout, isLocalHost, pathShape, variantKey, makePathFilter, sectionPrefixes, pickFair, markServed } from './urls.mjs';
import { parseRobots, robotsAllows, UA_TOKEN } from './robots.mjs';
import { collectSitemapUrls, bodyText } from './sitemap.mjs';
import { openPage, guardRequests, findConsent, dismissConsent, detectBlock } from './page-prep.mjs';
import { runAxe } from './axe-run.mjs';
import { collectPage, redactString } from './collect.mjs';

const MAX_DEPTH = 8;
const SHAPE_CAP = 25;
const RECYCLE_EVERY = 50;
const BLOCK_PAUSE = 3;

const pid = (n) => `p${String(n).padStart(3, '0')}`;

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': `Mozilla/5.0 (compatible; ${UA_TOKEN})`, ...authHeader(url) }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return bodyText(await res.arrayBuffer(), res.headers.get('content-type') || '', url);
  } catch { return null; }
}

// What identifies a "not found" page: its title and main heading. Banners and other chrome are left out on purpose.
function notFoundSignature(page) {
  return page.evaluate(() => {
    const h = document.querySelector('main h1, h1, [role=heading][aria-level="1"]');
    return `${document.title}|${h ? h.textContent : ''}`;
  }).catch(() => '');
}

function textHash(s) {
  return createHash('sha1').update(String(s).replace(/\s+/g, ' ').trim().slice(0, 1500)).digest('hex').slice(0, 16);
}

function newState(run) {
  const base = normalize(run.target.baseUrl || run.target.url);
  return {
    base,
    startedAt: new Date().toISOString(),
    robots: null,
    robotsRespected: false,
    sitemaps: [],
    hashRoutes: false,
    queue: [],
    seen: [],
    variants: [],
    shapes: {},
    nextId: 1,
    consecutiveBlocks: 0,
    soft404: null,
    consent: 'none',
    consentChecked: false,
    paused: null,
    seeded: false,
  };
}

function loadPages(p, base) {
  return readJson(p.pages, { base, pages: [], skipped: [], documents: [], stats: { discovered: 0, scanned: 0, capReached: false } });
}

class Crawl {
  constructor(ctx, { budgetSec = 480 } = {}) {
    this.ctx = ctx;
    this.p = ctx.p;
    this.run = ctx.run;
    this.opt = ctx.run.options;
    this.deadline = Date.now() + budgetSec * 1000;
    this.state = readJson(this.p.crawlState, null) || newState(ctx.run);
    this.out = loadPages(this.p, this.state.base);
    this.seen = new Set(this.state.seen);
    this.variants = new Set(this.state.variants);
    this.filter = makePathFilter(this.opt.include, this.opt.exclude);
    this.local = isLocalHost(new URL(this.state.base).hostname);
    this.robots = this.state.robots ? parseRobots(this.state.robots) : null;
    this.storageFile = path.join(ctx.dir, 'crawl-storage.json');
    this.personal = Boolean(this.opt.auth);
    this.inFlight = 0;
  }

  save() {
    this.state.seen = [...this.seen];
    this.state.variants = [...this.variants];
    writeJson(this.p.crawlState, this.state);
    const scanned = this.out.pages.filter((x) => !x.error && !x.blocked).length;
    this.out.stats = {
      ...this.out.stats,
      discovered: this.seen.size,
      scanned,
      capReached: Boolean(this.out.stats.capReached),
      robotsRespected: this.state.robotsRespected,
      fromSitemap: this.state.sitemapUrls ?? null,
      consent: this.state.consent,
    };
    writeJson(this.p.pages, this.out);
  }

  skip(url, reason, detail) {
    if (this.out.skipped.length < 5000) this.out.skipped.push({ url: redactString(url), reason, ...(detail ? { detail } : {}) });
  }

  scannedCount() {
    return this.out.pages.length;
  }

  // Decides whether a discovered URL joins the queue; every refusal is recorded so the report can state its scope.
  enqueue(raw, depth, source, text = '') {
    const url = normalize(raw, { base: this.state.base, hashRoutes: this.state.hashRoutes });
    if (!url || this.seen.has(pageKey(url))) return;
    if (!sameSite(url, this.state.base)) return; // external links are not part of the site; not worth listing
    this.seen.add(pageKey(url));
    const kind = urlKind(url);
    if (kind === 'asset') return;
    if (kind === 'document') { if (this.out.documents.length < 500) this.out.documents.push({ url: redactString(url), foundOn: source }); return; }
    if (isLogout(url, text)) return this.skip(url, 'logout');
    if (depth > MAX_DEPTH) return this.skip(url, 'depth');
    const excluded = this.filter(url);
    if (excluded && depth > 0) return this.skip(url, 'excluded');
    if (this.robots && !robotsAllows(this.robots, url)) return this.skip(url, 'robots');
    const vk = variantKey(url);
    if (new URL(url).search && this.variants.has(vk)) return this.skip(url, 'query-variant');
    this.variants.add(vk);
    const shape = pathShape(url);
    this.state.shapes[shape] = (this.state.shapes[shape] || 0) + 1;
    if (this.state.shapes[shape] > SHAPE_CAP) return this.skip(url, 'shape-cap', shape);
    this.state.queue.push({ url, depth, source });
  }

  async seed() {
    const base = this.state.base;
    const origin = new URL(base).origin;
    if (!this.local && !this.opt.ignoreRobots) {
      this.state.robots = await fetchText(`${origin}/robots.txt`);
      this.robots = this.state.robots ? parseRobots(this.state.robots) : null;
      this.state.robotsRespected = true;
    }
    this.enqueue(base, 0, 'start');
    const starts = [...new Set([...(this.robots?.sitemaps || []), `${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])];
    const sm = await collectSitemapUrls(starts, fetchText);
    this.state.sitemaps = sm.sitemaps;
    // How many addresses the sitemaps gave: the report says how pages were found, and none means links only.
    this.state.sitemapUrls = sm.urls.length;
    for (const u of sm.urls) {
      // Sitemaps may list the production host while we crawl a local server: map them onto the base origin.
      let mapped = u;
      try {
        const x = new URL(u);
        if (this.local && !sameSite(u, base)) mapped = new URL(x.pathname + x.search, origin).href;
      } catch { continue; }
      this.enqueue(mapped, 1, 'sitemap');
    }
    this.state.seeded = true;
    this.save();
  }

  async makeContext(browser) {
    const storageState = fs.existsSync(this.storageFile) ? this.storageFile : this.opt.auth || undefined;
    const context = await newContext(browser, { storageState });
    await guardRequests(context, this.state.base);
    return context;
  }

  // A random URL tells us what this site's "not found" looks like, so soft 404s (status 200) can be excluded.
  async probeSoft404(context) {
    const page = await context.newPage();
    try {
      const url = new URL(`/wr-404-${randomBytes(4).toString('hex')}`, this.state.base).href;
      const res = await openPage(page, url, { timeoutMs: 30000 });
      const sig = await notFoundSignature(page);
      this.state.soft404 = { status: res ? res.status() : 0, hash: textHash(sig.replace(/wr-404-[0-9a-f]+/g, '')) };
    } catch {
      this.state.soft404 = { status: 0, hash: null };
    } finally {
      await page.close().catch(() => {});
    }
  }

  async processOne(context, item) {
    const id = pid(this.state.nextId++);
    const entry = {
      id, url: item.url, finalUrl: item.url, status: 0, title: '', lang: null, depth: item.depth, source: item.source,
      shape: pathShape(item.url), templateId: null, state: 'default', blocked: false, soft404: false, error: null, scannedAt: new Date().toISOString(),
    };
    const page = await context.newPage();
    try {
      const res = await openPage(page, item.url);
      entry.status = res ? res.status() : 0;
      const ct = res ? (res.headers()['content-type'] || '') : '';
      entry.finalUrl = normalize(page.url(), { hashRoutes: this.state.hashRoutes }) || page.url();
      if (!sameSite(entry.finalUrl, this.state.base)) {
        this.skip(item.url, 'external', `redirects to ${entry.finalUrl}`);
        return null;
      }
      const key = pageKey(entry.finalUrl);
      if (this.out.pages.some((x) => pageKey(x.finalUrl) === key)) {
        this.skip(item.url, 'duplicate', `same page as ${entry.finalUrl}`);
        return null;
      }
      this.seen.add(key);
      if (ct && !/html|xml/i.test(ct)) {
        if (this.out.documents.length < 500) this.out.documents.push({ url: item.url, foundOn: item.source });
        return null;
      }
      const blocked = await detectBlock(page, entry.status);
      if (blocked) {
        entry.blocked = true;
        entry.error = blocked;
        this.state.consecutiveBlocks++;
        if (this.state.consecutiveBlocks >= BLOCK_PAUSE) this.state.paused = 'blocked';
        this.skip(item.url, 'blocked', blocked);
        return entry;
      }
      this.state.consecutiveBlocks = 0;

      if (!this.state.hashRoutes) {
        const hashLinks = await page.evaluate(() => [...document.querySelectorAll('a[href^="#/"], a[href^="#!/"]')].length).catch(() => 0);
        if (hashLinks >= 3) this.state.hashRoutes = true;
      }
      const sig = await notFoundSignature(page);
      if (entry.status >= 200 && entry.status < 300 && this.state.soft404?.hash && textHash(sig) === this.state.soft404.hash) {
        entry.soft404 = true;
        this.skip(item.url, 'soft404');
        return entry;
      }
      if (entry.status >= 400) {
        entry.error = `HTTP ${entry.status}`;
        this.skip(item.url, 'error', entry.error);
        return entry;
      }

      if (!this.state.consentChecked) {
        this.state.consentChecked = true;
        const banner = await findConsent(page);
        if (banner) {
          const open = await runAxe(page, { level: this.opt.level, pageId: id, state: 'consent-open' });
          writeJson(path.join(this.p.axeDir, `${id}@consent-open.json`), open);
          const how = await dismissConsent(page);
          this.state.consent = how ? 'dismissed' : 'not-dismissable';
          entry.consent = { banner, dismissed: how };
          if (how) await context.storageState({ path: this.storageFile });
          log('consent banner', banner, how || 'could not dismiss');
        }
      }

      const axe = await runAxe(page, { level: this.opt.level, pageId: id });
      writeJson(this.p.axe(id), axe);
      const collected = await collectPage(page, { pageId: id, mask: this.opt.mask, personal: this.personal });
      writeJson(this.p.collect(id), collected);
      entry.title = collected.title;
      entry.lang = collected.lang;

      const links = await page.evaluate(() => [...document.querySelectorAll('a[href], area[href]')].map((a) => [a.href, (a.textContent || '').trim().slice(0, 60)])).catch(() => []);
      for (const [href, text] of links) this.enqueue(href, item.depth + 1, id, text);
      return entry;
    } catch (e) {
      // A URL without a file extension that answers with a file (Content-Disposition: attachment) is a linked
      // document, not a broken page.
      if (/Download is starting/i.test(String(e.message || e))) {
        if (this.out.documents.length < 500) this.out.documents.push({ url: redactString(item.url), foundOn: item.source });
        return null;
      }
      entry.error = String(e.message || e).split('\n')[0].slice(0, 200);
      this.skip(item.url, 'error', entry.error);
      return entry;
    } finally {
      await page.close().catch(() => {});
    }
  }

  timeLeft() {
    return this.deadline - Date.now();
  }

  async start() {
    const { browser } = await getBrowser({ explicit: this.opt.browser });
    if (!this.state.seeded) await this.seed();
    let context = await this.makeContext(browser);
    let sinceRecycle = 0;
    const workers = Math.max(1, this.opt.concurrency || 3);

    const take = () => {
      if (this.state.paused || this.timeLeft() < 20000) return null;
      if (this.scannedCount() + this.inFlight >= this.opt.maxPages) return null;
      if (!this.state.queue.length) return null;
      // Fair across sections, not first-in-first-out: sitemaps often list one huge section (thousands of product
      // or colour pages) before the rest of the site.
      const served = (this.state.served ||= {});
      const pre = (this.pre ||= new WeakMap());
      const i = pickFair(this.state.queue, served, (q) => {
        if (!pre.has(q)) pre.set(q, sectionPrefixes(q.url));
        return pre.get(q);
      });
      const [item] = this.state.queue.splice(i, 1);
      markServed(served, item.url);
      return item;
    };

    // The first page runs alone: it decides consent and hash routing for everything after it.
    if (!this.state.consentChecked && this.state.queue.length) {
      const item = take();
      const entry = item && (await this.processOne(context, item));
      if (entry) this.out.pages.push(entry);
      this.save();
      if (fs.existsSync(this.storageFile)) { await context.close(); context = await this.makeContext(browser); }
    }
    // After the first page, so the probe sees the site the way every later page is seen (consent already given).
    if (!this.state.soft404) { await this.probeSoft404(context); this.save(); }

    const worker = async () => {
      for (;;) {
        const item = take();
        if (!item) {
          // Another worker may still add links from the page it is loading.
          const waiting = this.inFlight > 0 && this.state.queue.length === 0 && !this.state.paused && this.timeLeft() > 20000;
          if (!waiting) return;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        this.inFlight++;
        const entry = await this.processOne(context, item);
        this.inFlight--;
        if (entry) {
          this.out.pages.push(entry);
          if (this.out.pages.length % 5 === 0) log('crawl', `${this.out.pages.length} pages, ${this.state.queue.length} queued`);
        }
        this.save();
        if (++sinceRecycle >= RECYCLE_EVERY && this.inFlight === 0) {
          sinceRecycle = 0;
          await context.close().catch(() => {});
          context = await this.makeContext(browser);
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, worker));
    await context.close().catch(() => {});

    const capReached = this.scannedCount() >= this.opt.maxPages && this.state.queue.length > 0;
    if (capReached) {
      for (const q of this.state.queue) this.skip(q.url, 'cap');
      this.state.queue = [];
      this.out.stats.capReached = true;
    }
    // Pages are numbered in discovery order; keep the file in that order whatever order workers finished in.
    this.out.pages.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    this.save();
    const done = this.state.queue.length === 0 || Boolean(this.state.paused);
    return this.summary(done);
  }

  summary(done) {
    const skipped = {};
    for (const s of this.out.skipped) skipped[s.reason] = (skipped[s.reason] || 0) + 1;
    const reviewed = this.out.pages.filter((x) => !x.error && !x.blocked && !x.soft404 && x.status >= 200 && x.status < 300).length;
    return {
      ok: true,
      done,
      scanned: this.out.pages.length,
      reviewed,
      queued: this.state.queue.length,
      capReached: Boolean(this.out.stats.capReached),
      paused: this.state.paused,
      consent: this.state.consent,
      documents: this.out.documents.length,
      skipped,
      ...(this.state.paused === 'blocked' ? { message: 'The site blocked the crawler on 3 pages in a row (bot protection or rate limit). Audit a staging copy or the repository, or pass --auth with a storage state from a real browser session.' } : {}),
    };
  }
}

export async function crawl(ctx, opts) {
  const c = new Crawl(ctx, opts);
  return c.start();
}
