// Screenshots for the judges and the report. Captures stay clean (no highlight burned in): the renderer draws the
// highlight from `boxes`, recorded here in the saved image's own pixel space. JPEG only — the PDF embeds it as is.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { log } from './log.mjs';
import { openPage, DESKTOP, NARROW, isRefusal, noteRefused } from './deep/common.mjs';
import { focusByKeyboard } from './deep/focus-visible.mjs';
import { samplePages } from './judge.mjs';
import { ONE_CARD_CHECKS } from './merge.mjs';
import { rowThumbKey } from './findings.mjs';

export const IMAGE_BUDGET = 12 * 1024 * 1024;
const SEVERITY_RANK = { minor: 0, moderate: 1, serious: 2, critical: 3 };

export function maskSelectors(options = {}) {
  const sels = ['input[type=password]', '[autocomplete^="cc-"]', '[data-wr-mask]', ...(options.mask ?? [])];
  if (options.auth) sels.push('input:not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio])', 'textarea', 'select');
  return sels;
}

const masks = (page, options) => maskSelectors(options).map((s) => page.locator(s));

function rel(ctx, file) {
  return path.relative(ctx.dir, file).replace(/\\/g, '/');
}

function save(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

// ---- Template shots (before the judges) ----

async function fullShot(env, viewport, dsf, maxHeight, maxWidth, quality) {
  const { context, page } = await openPage(env, { viewport, deviceScaleFactor: dsf, guard: true });
  try {
    const h = await page.evaluate((cap) => Math.min(cap, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)), maxHeight);
    const png = await page.screenshot({ type: 'png', fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height: Math.max(1, h) }, mask: masks(page, env.options), maskColor: '#555555' });
    return env.img.toJpeg(png, { maxWidth, quality });
  } finally {
    await context.close();
  }
}

// A close-up of every image on a page, with what a judge needs beside it: its alt text, file name and the words
// around it. Deciding whether an alt text says what an image shows needs the image itself.
async function imageCloseUps(ctx, env, pageId) {
  const { context, page } = await openPage(env, { viewport: DESKTOP, deviceScaleFactor: 1, guard: true });
  const out = [];
  try {
    // Lazy images load only near the viewport: load them all now, so a close-up is never an empty box.
    await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; })).catch(() => {});
    const list = await page.evaluate(() => [...document.querySelectorAll('img, [role=img], input[type=image], svg[aria-label], svg[role=img]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width >= 24 && r.height >= 24 && getComputedStyle(el).visibility !== 'hidden'; })
      .slice(0, 15)
      .map((el, i) => {
        el.setAttribute('data-wr-img', String(i));
        const fig = el.closest('figure');
        const link = el.closest('a[href],button');
        const caption = fig?.querySelector('figcaption')?.innerText || '';
        const near = caption || el.parentElement?.innerText || '';
        // The heading of the section the image is in: what the image is for often reads from it.
        const heads = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter((h) => h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
        const heading = (heads.at(-1)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return {
          i, selector: window.__wr.sel(el), tag: el.localName, alt: el.hasAttribute('alt') ? el.getAttribute('alt') : null,
          ariaLabel: el.getAttribute('aria-label'), ariaHidden: el.closest('[aria-hidden=true]') ? true : false, role: el.getAttribute('role'),
          src: (el.currentSrc || el.getAttribute('src') || '').split('/').pop().split('?')[0].slice(0, 80),
          caption: caption.replace(/\s+/g, ' ').trim().slice(0, 200), heading,
          near: near.replace(/\s+/g, ' ').trim().slice(0, 160), inLink: link ? (link.innerText || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(no text)' : null,
        };
      }));
    for (const im of list) {
      const r = await page.evaluate((i) => {
        const el = document.querySelector(`[data-wr-img="${i}"]`);
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const b = el.getBoundingClientRect();
        return { x: Math.max(0, b.left), y: Math.max(0, b.top), w: Math.min(innerWidth, b.right) - Math.max(0, b.left), h: Math.min(innerHeight, b.bottom) - Math.max(0, b.top) };
      }, im.i);
      if (r.w < 8 || r.h < 8) continue;
      await page.evaluate(async (i) => { const el = document.querySelector(`[data-wr-img="${i}"]`); if (el?.decode) await el.decode().catch(() => {}); }, im.i).catch(() => {});
      await page.waitForTimeout(150);
      const shoot = () => page.screenshot({ type: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h } }).catch(() => null);
      let png = await shoot();
      if (!png) continue;
      // A uniform crop is an image that has not painted yet: wait once more before keeping it.
      const lum = await env.img.luminance(png).catch(() => null);
      if (lum && lum.p98 - lum.p02 < 0.02) { await page.waitForTimeout(1200); png = (await shoot()) ?? png; }
      const jpg = await env.img.toJpeg(png, { maxWidth: 520, quality: 0.72 });
      const file = path.join(ctx.p.shotsDir, 'images', `${pageId}-${String(im.i + 1).padStart(2, '0')}.jpg`);
      save(file, jpg.buffer);
      const { i, ...rest } = im;
      out.push({ file: rel(ctx, file), ...rest });
    }
  } finally {
    await context.close();
  }
  return out;
}

export async function templateShots(ctx, { browser, img, templates, pages }) {
  const index = readJson(ctx.p.shotsIndex, { templates: {}, issues: {} });
  const done = [];
  for (const t of templates) {
    const page = pages.find((p) => p.id === t.representative);
    if (!page) continue;
    const env = { browser, img, url: page.finalUrl || page.url, options: ctx.run.options };
    try {
      const desk = await fullShot(env, DESKTOP, 1, 2700, 1000, 0.72);
      const narrow = await fullShot(env, NARROW, 2, 1920, 640, 0.72);
      const deskFile = path.join(ctx.p.shotsDir, 'templates', `${t.id}-desktop.jpg`);
      const narrowFile = path.join(ctx.p.shotsDir, 'templates', `${t.id}-w320.jpg`);
      save(deskFile, desk.buffer);
      save(narrowFile, narrow.buffer);
      index.templates[t.id] = { desktop: rel(ctx, deskFile), w320: rel(ctx, narrowFile), pageId: page.id, scale: { desktop: desk.width / DESKTOP.width, w320: narrow.width / NARROW.width } };
      index.images = index.images ?? {};
      for (const sp of samplePages(t, pages)) {
        if (index.images[sp.id]) continue;
        index.images[sp.id] = await imageCloseUps(ctx, { browser, img, url: sp.finalUrl || sp.url, options: ctx.run.options }, sp.id).catch(() => []);
      }
      done.push(t.id);
    } catch (e) {
      const msg = String(e.message).split('\n')[0];
      log('shots', t.id, 'failed:', msg);
      // The site turned the tester away: the report says which page types have no picture and why.
      if (isRefusal(msg)) noteRefused(ctx.dir, { templateId: t.id, pageId: t.representative, url: (/^Could not load (\S+?):/.exec(msg) || [])[1] ?? null, step: 'shots' });
    }
  }
  writeJson(ctx.p.shotsIndex, index);
  return { templates: done };
}

// ---- Issue crops (after merge) ----

const NARROW_SC = new Set(['1.4.10']);
function viewportFor(issue, inst) {
  if (Array.isArray(inst.viewport) && inst.viewport.length === 2) return { width: inst.viewport[0], height: inst.viewport[1] };
  if (/^w320/.test(inst.state || '') || NARROW_SC.has(primaryId(issue))) return NARROW;
  return DESKTOP;
}

// issues.json keeps the criterion as its number; report.json as { id, name }.
const primaryId = (issue) => issue.criteria?.primary?.id ?? issue.criteria?.primary;

function isFocusIssue(issue) {
  return primaryId(issue) === '2.4.7' || issue.check === 'focus-visible';
}

// Focus hidden behind a sticky bar shows only while the page is scrolled to the focused element by the keyboard: a
// fresh crop shows the element uncovered, so the deep check's own picture is the evidence.
// The check's own picture: what a later crop cannot show (an element partly covered, words cut at the 320 px edge).
const OWN_PICTURE_SC = new Set(['2.4.11', '2.4.12', '1.4.10']);
// States a close-up can show again by loading the page (at its width, with keyboard focus, with the banner open).
const REPRODUCIBLE_STATES = ['default', 'w320', 'focus', 'consent-open'];

// Up to `max` instances, preferring different pages so the report shows the problem is not a one-off.
export function pickInstances(issue, max = 2) {
  // A site-wide problem looks the same on every page: a second picture of the shared header adds nothing.
  if (issue.scope === 'site_wide') max = 1;
  const all = (issue.instances ?? []).filter((i) => i.selector || i.bbox);
  // The page as people normally see it first; a state such as "cookie banner open" only when it is all there is.
  const usable = all.some((i) => (i.state ?? 'default') === 'default') ? all.filter((i) => (i.state ?? 'default') === 'default' || i.state === 'w320' || i.state === 'focus') : all;
  const out = [];
  for (const i of usable) if (out.length < max && !out.some((o) => o.pageId === i.pageId)) out.push(i);
  for (const i of usable) if (out.length < max && !out.includes(i)) out.push(i);
  return out;
}

// The crop around an element, in viewport CSS px: at least 560 × 200 (so a small icon shows where it sits), at most
// 0.55 × as tall as wide on desktop; a tall element is cropped around its top, a wide one from its left edge.
export function cropRect(r, vw, vh, { pad = 32, minW = 560, minH = 200, maxW = 900 } = {}) {
  const narrow = vw <= 400;
  const cw = Math.min(vw, maxW, Math.max(narrow ? vw : minW, r.w + pad * 2));
  const maxH = Math.min(vh, Math.round(cw * (narrow ? 1.6 : 0.55)));
  const ch = Math.min(maxH, Math.max(Math.min(minH, maxH), r.h + pad * 2));
  const tall = r.h + pad * 2 > ch;
  // An element wider than the crop is shown from its left edge, where its lines of text start; centring it cut the
  // first letters off every line.
  const wide = r.w + pad * 2 > cw;
  let x = wide ? r.x - pad : r.x + r.w / 2 - cw / 2;
  let y = tall ? r.y - pad : r.y + r.h / 2 - ch / 2;
  x = Math.max(0, Math.min(vw - cw, x));
  y = Math.max(0, Math.min(vh - ch, y));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(cw), height: Math.round(ch), continues: tall };
}

// Scrolls the element into the middle of the viewport and measures it once the layout is still (images loading above
// it move it). Null when it is not on screen after the scroll, so a crop never shows the wrong part of the page.
async function locate(page, inst) {
  if (!inst.selector) return null;
  return page.evaluate(async (sel) => {
    let el = null;
    try { el = document.querySelector(sel); } catch { return null; }
    if (!el || !window.__wr.visible(el)) return null;
    const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    let r = null;
    for (let i = 0; i < 4; i += 1) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await frame();
      await new Promise((res) => setTimeout(res, 120));
      const n = el.getBoundingClientRect();
      const still = r && Math.abs(n.top - r.top) < 1 && Math.abs(n.left - r.left) < 1;
      r = n;
      if (still) break;
    }
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= document.documentElement.clientWidth) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: innerHeight };
  }, inst.selector).catch(() => null);
}

// Where an element's own words are on screen (the union of its text lines), for an element with text and no picture
// whose box is wider than its words. Null otherwise, and the element's box is used.
async function textExtent(page, selector) {
  return page.evaluate((sel) => {
    let el = null;
    try { el = document.querySelector(sel); } catch { return null; }
    if (!el || el.matches('img,svg,video,canvas,input,select,textarea') || el.querySelector('img,svg,video,canvas')) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
    if (!rects.length) return null;
    const x0 = Math.min(...rects.map((q) => q.left));
    const y0 = Math.min(...rects.map((q) => q.top));
    const x1 = Math.max(...rects.map((q) => q.right));
    const y1 = Math.max(...rects.map((q) => q.bottom));
    const box = el.getBoundingClientRect();
    if (x1 - x0 > box.width - 8) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, vw: document.documentElement.clientWidth, vh: innerHeight };
  }, selector).catch(() => null);
}

async function visibleText(page, clip) {
  return page.evaluate((c) => {
    const seen = new Set();
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && out.join(' ').length < 500; n = walker.nextNode()) {
      const t = n.textContent.replace(/\s+/g, ' ').trim();
      if (!t || seen.has(t) || !n.parentElement || !window.__wr.visible(n.parentElement)) continue;
      const r = n.parentElement.getBoundingClientRect();
      if (r.right < c.x || r.left > c.x + c.width || r.bottom < c.y || r.top > c.y + c.height) continue;
      seen.add(t);
      out.push(t);
    }
    return out.join(' | ').slice(0, 500);
  }, clip).catch(() => '');
}

async function cropAt(env, page, r, quality, maxWidth, rect = {}) {
  const clip = cropRect(r, r.vw, r.vh, rect);
  const png = await page.screenshot({ type: 'png', clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height }, mask: masks(page, env.options), maskColor: '#555555' });
  const jpg = await env.img.toJpeg(png, { maxWidth, quality });
  const k = jpg.width / clip.width; // CSS px → saved image px (device scale and downscale together)
  // An element larger than the crop (a too-wide column at 320 px) is outlined where it is visible.
  const x0 = Math.max(0, Math.round((r.x - clip.x) * k));
  const y0 = Math.max(0, Math.round((r.y - clip.y) * k));
  const x1 = Math.min(jpg.width, Math.round((r.x + r.w - clip.x) * k));
  const y1 = Math.min(jpg.height, Math.round((r.y + r.h - clip.y) * k));
  const box = { x: Math.min(x0, jpg.width - 2), y: Math.min(y0, jpg.height - 2), w: Math.max(2, x1 - x0), h: Math.max(2, y1 - y0), n: 1, clipped: x0 !== Math.round((r.x - clip.x) * k) || x1 < Math.round((r.x + r.w - clip.x) * k) };
  return { jpg, clip, box };
}

// A banner that could not be closed (its buttons are themselves the barrier) must not cover the elements in a crop.
// It is hidden only when none of the crops on this page is of the banner itself.
async function hideBanner(page, selector, items) {
  if (!selector || items.some(({ inst }) => inst.state === 'consent-open' || String(inst.selector ?? '').includes(selector))) return;
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el && el.getBoundingClientRect().height > 0 && !el.querySelector(':focus')) el.style.setProperty('display', 'none', 'important');
  }, selector).catch(() => {});
}

export async function issueShots(ctx, { browser, img, quality = 0.76, maxWidth = 1200 }) {
  const raw = readJson(ctx.p.issues);
  const issues = Array.isArray(raw) ? raw : raw.issues ?? [];
  const pages = readJson(ctx.p.pages, { pages: [] }).pages;
  const urlOf = (pid, fallback) => { const p = pages.find((x) => x.id === pid); return p?.finalUrl || p?.url || fallback; };
  const bannerSelector = pages.find((x) => x.consent?.banner)?.consent.banner ?? null;
  const index = readJson(ctx.p.shotsIndex, { templates: {}, issues: {} });
  index.issues = {};

  // Group the work by page and viewport so each page loads once.
  const jobs = new Map();
  // Remember what each issue showed, so text written for older pictures is marked for rewriting.
  const sig = (i) => JSON.stringify((i.shots ?? []).map((s) => s.hash ?? s.file));
  const before = new Map(issues.map((i) => [i.key, sig(i)]));
  for (const issue of issues) {
    if (!['fail', 'needs_review'].includes(issue.status)) continue;
    issue.shots = [];
    issue.rowThumbs = [];
    // A picture of enlarged text cannot show that it grew too little; the card's rows give each size and how far it grows.
    if (issue.check === 'text-zoom') continue;
    for (const [n, inst] of pickInstances(issue).entries()) {
      // A state a plain page load cannot show (wider text spacing, 200 % text, hover): use the deep check's own picture.
      const ownPicture = OWN_PICTURE_SC.has(primaryId(issue)) || issue.check === 'focus-obscured';
      if ((ownPicture || !REPRODUCIBLE_STATES.includes(inst.state ?? 'default')) && inst.evidenceImages?.length) {
        const fileRel = inst.evidenceImages[0];
        const abs = path.join(ctx.dir, fileRel);
        if (fs.existsSync(abs)) {
          const dims = await img.size(fs.readFileSync(abs));
          issue.shots.push({ file: fileRel, width: dims.width, height: dims.height, kind: 'crop', boxes: [], pageId: inst.pageId, url: urlOf(inst.pageId, inst.url), state: inst.state, pair: null, visibleText: '', viewport: inst.viewport ?? [1280, 900] });
          continue;
        }
      }
      const vp = viewportFor(issue, inst);
      const url = urlOf(inst.pageId, inst.url);
      if (!/^https?:\/\//.test(url ?? '')) continue;
      const k = `${url}|${vp.width}x${vp.height}`;
      if (!jobs.has(k)) jobs.set(k, { url, vp, items: [] });
      jobs.get(k).items.push({ issue, inst, n: n + 1 });
    }
    // A card that gathers one check's failures has a row per element, each with a close-up of that element.
    // Pictures too: a row whose picture the page close-ups did not cover still shows its own.
    if ((ONE_CARD_CHECKS.has(issue.check) || issue.check === 'judge-1.1.1') && issue.status === 'fail') {
      const seen = new Set();
      for (const inst of issue.instances ?? []) {
        const key = rowThumbKey(issue, inst);
        if (!inst.selector || seen.has(key) || seen.size >= 12) continue;
        // A state a page load cannot show (the pointer over a card): a close-up of the page at rest would show the
        // text passing. The check's own picture of that state is the row's picture.
        const own = !REPRODUCIBLE_STATES.includes(inst.state ?? 'default') && inst.evidenceImages?.find((f) => fs.existsSync(path.join(ctx.dir, f)));
        if (own) {
          seen.add(key);
          const dims = await img.size(fs.readFileSync(path.join(ctx.dir, own)));
          issue.rowThumbs.push({ key, file: own, width: dims.width, height: dims.height });
          continue;
        }
        const url = urlOf(inst.pageId, inst.url);
        if (!/^https?:\/\//.test(url ?? '')) continue;
        seen.add(key);
        const vp = viewportFor(issue, inst);
        const k = `${url}|${vp.width}x${vp.height}`;
        if (!jobs.has(k)) jobs.set(k, { url, vp, items: [] });
        jobs.get(k).items.push({ issue, inst, n: `row${seen.size}`, thumb: key });
      }
    }
  }

  let captured = 0;
  for (const job of jobs.values()) {
    const env = { browser, img, url: job.url, options: ctx.run.options };
    let opened;
    try { opened = await openPage(env, { viewport: job.vp, deviceScaleFactor: 2 }); } catch (e) { log('shots', job.url, String(e.message).split('\n')[0]); continue; }
    const { context, page } = opened;
    try {
      await hideBanner(page, bannerSelector, job.items);
      for (const { issue, inst, n, thumb } of job.items) {
        const name = `${issue.key}-${n}`;
        const file = path.join(ctx.p.shotsDir, 'issues', `${name}.jpg`);
        let r = await locate(page, inst);
        if (!r) continue;
        if (thumb) {
          // A lazy-loaded picture is still a blank placeholder until it is near the window: bring it there and wait
          // for it to load before taking its close-up.
          const loaded = await page.evaluate(async (sel) => {
            let el = null;
            try { el = document.querySelector(sel); } catch { return false; }
            const img = el?.localName === 'img' ? el : el?.querySelector?.('img');
            if (!img) return true;
            img.loading = 'eager';
            img.scrollIntoView({ block: 'center', behavior: 'instant' });
            for (let i = 0; i < 30 && !(img.complete && img.naturalWidth > 0); i += 1) await new Promise((res) => setTimeout(res, 100));
            await img.decode?.().catch(() => {});
            return img.complete && img.naturalWidth > 0;
          }, inst.selector).catch(() => false);
          if (loaded) r = (await locate(page, inst)) ?? r;
          // A row about text (its contrast, its label) shows the words themselves, outlined: a paragraph's box runs the
          // full width of the page, and shrunk into the table's picture column its words could not be read.
          const words = issue.check === 'judge-1.1.1' ? null : await textExtent(page, inst.selector);
          const t = words
            ? await cropAt(env, page, words, quality, 520, { pad: 10, minW: 140, minH: 48, maxW: 240 })
            : await cropAt(env, page, r, quality, 520, { pad: 16, minW: 280, minH: 90, maxW: 640 });
          save(file, t.jpg.buffer);
          issue.rowThumbs.push({ key: thumb, file: rel(ctx, file), width: t.jpg.width, height: t.jpg.height, ...(issue.check === 'judge-1.1.1' ? {} : { boxes: [t.box] }) });
          continue;
        }
        if (isFocusIssue(issue)) {
          await page.evaluate(() => document.activeElement?.blur?.());
          const before = await cropAt(env, page, r, quality, maxWidth);
          if (await focusByKeyboard(page, inst.selector)) {
            r = (await locate(page, inst)) ?? r;
            const after = await cropAt(env, page, r, quality, maxWidth);
            const beforeFile = path.join(ctx.p.shotsDir, 'issues', `${name}-nofocus.jpg`);
            save(file, after.jpg.buffer);
            save(beforeFile, before.jpg.buffer);
            issue.shots.push({ file: rel(ctx, file), width: after.jpg.width, height: after.jpg.height, kind: 'pair', boxes: [after.box], pageId: inst.pageId, url: job.url, state: 'focus', pair: { file: rel(ctx, beforeFile), label: 'Without keyboard focus', width: before.jpg.width, height: before.jpg.height, boxes: [before.box] }, visibleText: await visibleText(page, after.clip), viewport: [job.vp.width, job.vp.height] });
            captured += 1;
            continue;
          }
        }
        const shot = await cropAt(env, page, r, quality, maxWidth);
        save(file, shot.jpg.buffer);
        issue.shots.push({ file: rel(ctx, file), width: shot.jpg.width, height: shot.jpg.height, kind: 'crop', boxes: [shot.box], pageId: inst.pageId, url: job.url, state: inst.state || 'default', pair: null, visibleText: await visibleText(page, shot.clip), continues: shot.clip.continues, viewport: [job.vp.width, job.vp.height] });
        captured += 1;
      }
    } finally {
      await context.close();
    }
  }

  // Fallback: the template's full-page shot, with the element's box scaled onto it.
  const templates = readJson(ctx.p.templates, { templates: [] }).templates;
  for (const issue of issues) {
    if (!['fail', 'needs_review'].includes(issue.status) || issue.shots?.length) continue;
    // The page at normal size cannot show text that grows too little, so the zoom card has no fallback picture either.
    if (issue.check === 'text-zoom') continue;
    const inst = (issue.instances ?? []).find((i) => i.bbox);
    if (!inst) continue;
    const tid = pages.find((p) => p.id === inst.pageId)?.templateId ?? templates.find((t) => t.pageIds?.includes(inst.pageId))?.id;
    const t = index.templates?.[tid];
    if (!t || t.pageId !== inst.pageId || inst.bbox.y + inst.bbox.h > 2700) continue;
    const k = t.scale?.desktop ?? 1000 / 1280;
    const dims = await img.size(fs.readFileSync(path.join(ctx.dir, t.desktop)));
    issue.shots = [{ file: t.desktop, width: dims.width, height: dims.height, kind: 'page', boxes: [{ x: Math.round(inst.bbox.x * k), y: Math.round(inst.bbox.y * k), w: Math.max(2, Math.round(inst.bbox.w * k)), h: Math.max(2, Math.round(inst.bbox.h * k)), n: 1 }], pageId: inst.pageId, url: urlOf(inst.pageId, inst.url), state: 'default', pair: null, visibleText: '', viewport: [1280, 900] }];
  }

  const budget = await enforceBudget(ctx, issues, img);
  for (const issue of issues) if (issue.shots?.length) index.issues[issue.key] = issue.shots;
  writeJson(ctx.p.shotsIndex, index);
  for (const i of issues) {
    for (const s of i.shots ?? []) {
      const abs = path.join(ctx.dir, s.file);
      if (fs.existsSync(abs)) s.hash = createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
    }
    const was = before.get(i.key);
    if (was && was !== '[]' && was !== sig(i)) i.textStale = true;
  }
  writeJson(ctx.p.issues, Array.isArray(raw) ? issues : { ...raw, issues });
  return { captured, issuesWithShots: issues.filter((i) => i.shots?.length).length, issues: issues.filter((i) => ['fail', 'needs_review'].includes(i.status)).length, ...budget };
}

// ---- Size budget ----

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size;
  return n;
}

function usedBytes(ctx, issues) {
  const files = new Set();
  for (const i of issues) for (const s of i.shots ?? []) { files.add(s.file); if (s.pair) files.add(s.pair.file); }
  let n = dirSize(path.join(ctx.p.shotsDir, 'templates'));
  for (const f of files) if (!f.startsWith('shots/templates/')) { try { n += fs.statSync(path.join(ctx.dir, f)).size; } catch { /* removed */ } }
  return n;
}

async function reencode(ctx, img, shot, { quality, maxWidth }) {
  const recode = async (s) => {
    const file = path.join(ctx.dir, s.file);
    const out = await img.toJpeg(fs.readFileSync(file), { quality, maxWidth });
    const k = out.width / s.width;
    fs.writeFileSync(file, out.buffer);
    s.width = out.width;
    s.height = out.height;
    s.boxes = s.boxes.map((b) => ({ ...b, x: Math.round(b.x * k), y: Math.round(b.y * k), w: Math.max(2, Math.round(b.w * k)), h: Math.max(2, Math.round(b.h * k)) }));
  };
  if (shot.file.startsWith('shots/issues/')) await recode(shot);
  if (shot.pair) await recode(shot.pair);
}

// The visual plan's order: drop second examples, then shots of minor issues, then lower quality, then smaller width.
export async function enforceBudget(ctx, issues, img, budget = IMAGE_BUDGET) {
  const steps = [];
  const byLowest = [...issues].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 0) - (SEVERITY_RANK[b.severity] ?? 0));
  if (usedBytes(ctx, issues) > budget) {
    for (const i of byLowest) { if (usedBytes(ctx, issues) <= budget) break; if (i.shots?.length > 1) i.shots = i.shots.slice(0, 1); }
    steps.push('dropped extra examples');
  }
  if (usedBytes(ctx, issues) > budget) {
    for (const i of byLowest) { if (usedBytes(ctx, issues) <= budget) break; if (i.severity === 'minor') i.shots = []; }
    steps.push('dropped screenshots of minor issues');
  }
  for (const [quality, maxWidth, label] of [[0.66, 1200, 'quality 66'], [0.66, 1100, 'width 1100']]) {
    if (usedBytes(ctx, issues) <= budget) break;
    for (const i of issues) for (const s of i.shots ?? []) await reencode(ctx, img, s, { quality, maxWidth });
    steps.push(label);
  }
  return { imageBytes: usedBytes(ctx, issues), budgetSteps: steps };
}
