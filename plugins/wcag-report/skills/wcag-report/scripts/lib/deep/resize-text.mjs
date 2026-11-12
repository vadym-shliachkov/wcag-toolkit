// 1.4.4 Resize Text: text can be enlarged to 200 %, by the browser's page zoom or its text-only zoom, without losing
// content. Either way is enough (G142, G178), so text fails only when neither works:
// - F94: text sized in viewport units (vw, vh, clamp() capped by them) does not grow with either zoom;
// - F69: text that text-only zoom cuts off fails only when page zoom (a 640 px wide layout at twice the pixel size,
//   which is 200 % on a 1280 px screen) cuts it off too.
import { openPage, signal, passSignal, environment, writeArtifact, DESKTOP } from './common.mjs';
import { markClipCandidates, newlyClipped, clearMarks, elementShot } from './layout.mjs';

export const check = 'resize-text';

const ZOOMED = { width: 640, height: 450 };
// 200 % with a little room for rounding and for layouts that switch font sizes at a breakpoint.
const ENOUGH = 1.8;
// Body text at 200 %: text that still ends up at least this large is readable, only less large than asked for, so the
// shortfall is a minor barrier; text that stays smaller than doubled body text is a major one.
const BODY_PX = 16;

// Font sizes of text elements, in CSS px. Marks the elements the first time so later calls measure the same ones.
async function fontSizes(page) {
  return page.evaluate(() => {
    if (!document.querySelector('[data-wr-fs]')) {
      let n = 0;
      for (const el of document.querySelectorAll('body *')) {
        if (n >= 600) break;
        if (el.matches('script,style,noscript,svg,svg *,option') || !window.__wr.visible(el)) continue;
        const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length >= 2);
        if (own) el.setAttribute('data-wr-fs', String(n++));
      }
    }
    const out = {};
    for (const el of document.querySelectorAll('[data-wr-fs]')) out[el.getAttribute('data-wr-fs')] = parseFloat(getComputedStyle(el).fontSize);
    return out;
  });
}

// Text sized in viewport units: a style rule (or inline style) gives it, or an ancestor, a font size in vw, vh, vmin,
// vmax or container units. Rules in style sheets from other sites cannot be read; for those, the size changing
// with the window width on both sides of 1280 px gives it away (a breakpoint changes it on one side only).
async function viewportSized(page, base) {
  const fromCss = await page.evaluate(() => {
    const UNIT = /\d(vw|vh|vmin|vmax|vi|vb|svw|lvw|dvw|cqw|cqi|cqmin|cqmax)\b/;
    const sels = [];
    const walk = (rules) => {
      for (const r of rules || []) {
        if (r.style && UNIT.test(r.style.fontSize || '') && r.selectorText) sels.push(r.selectorText);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch { /* another site's sheet */ } }
    const own = (el) => UNIT.test(el.style.fontSize || '') || sels.some((s) => { try { return el.matches(s); } catch { return false; } });
    const out = {};
    for (const el of document.querySelectorAll('[data-wr-fs]')) {
      let inherited = false;
      for (let n = el.parentElement; n && !inherited; n = n.parentElement) inherited = own(n);
      out[el.getAttribute('data-wr-fs')] = own(el) ? 'own' : inherited ? 'inherited' : null;
    }
    return out;
  });
  await page.setViewportSize({ width: 1230, height: DESKTOP.height });
  await page.waitForTimeout(200);
  const below = await fontSizes(page);
  await page.setViewportSize({ width: 1330, height: DESKTOP.height });
  await page.waitForTimeout(200);
  const above = await fontSizes(page);
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(200);
  const out = new Set();
  for (const id of Object.keys(base)) {
    const moves = below[id] !== base[id] || above[id] !== base[id];
    const bothSides = below[id] !== base[id] && above[id] !== base[id];
    if (fromCss[id] === 'own' || (fromCss[id] === 'inherited' && moves) || bothSides) out.add(id);
  }
  return out;
}

// F94: which text sized in viewport units cannot reach 200 % by page zoom (CSS size at half the width, drawn twice as
// large) or by text-only zoom (the default font size doubled, which is what the browser setting changes).
async function zoomRatios(page) {
  const base = await fontSizes(page);
  const viewport = await viewportSized(page, base);
  await page.evaluate(() => {
    const html = document.documentElement;
    html.style.setProperty('font-size', `${parseFloat(getComputedStyle(html).fontSize) * 2}px`, 'important');
  });
  await page.waitForTimeout(150);
  const text = await fontSizes(page);
  await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
  await page.setViewportSize(ZOOMED);
  await page.waitForTimeout(300);
  const zoom = await fontSizes(page);
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(300);
  const stuck = [];
  for (const [id, px] of Object.entries(base)) {
    if (!px || !text[id] || !zoom[id] || !viewport.has(id)) continue;
    const byText = text[id] / px;
    const byZoom = (zoom[id] * 2) / px;
    if (Math.max(byText, byZoom) < ENOUGH) stuck.push({ id, px, byText, byZoom });
  }
  if (!stuck.length) return { stuck: [], checked: Object.keys(base).length };
  const described = await page.evaluate((ids) => ids.map((id) => {
    const el = document.querySelector(`[data-wr-fs="${id}"]`);
    const parent = el?.parentElement?.closest('[data-wr-fs]');
    return el ? { ...window.__wr.describe(el), text: window.__wr.text(el, 80), skeleton: `${el.localName}.${[...el.classList].slice(0, 2).join('.')}`, parent: parent ? parent.getAttribute('data-wr-fs') : null } : null;
  }), stuck.map((s) => s.id));
  // One report per kind of element: the same heading style on a page is one cause, and a span that only inherits
  // its heading's size is the heading's problem.
  const stuckPx = new Map(stuck.map((s) => [s.id, s.px]));
  const seen = new Set();
  const out = [];
  stuck.forEach((s, i) => {
    const d = described[i];
    if (!d || seen.has(d.skeleton) || (d.parent && stuckPx.get(d.parent) === s.px)) return;
    seen.add(d.skeleton);
    out.push({ ...s, ...d });
  });
  return { stuck: out, checked: Object.keys(base).length };
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900).',
    'Measure every text size; double the default text size (text-only zoom); then show the page at 640 px wide with twice the pixel size (page zoom 200 %).',
    'Find text that grows less than 200 % with both kinds of zoom.',
    'Double the size of all text, as text-only zoom does, and find text that is cut off; check whether page zoom cuts it off too.',
  ];
  const expected = 'Text can be enlarged to 200 % without losing content or function.';
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    const signals = [];
    const artifacts = [];

    // F94 — text that does not grow.
    const ratios = await zoomRatios(page);
    for (const [i, s] of ratios.stuck.slice(0, 4).entries()) {
      const buf = await elementShot(page, env.img, s.selector);
      const evidence = buf ? [writeArtifact(env, `text-zoom-${i + 1}.jpg`, buf)] : [];
      artifacts.push(...evidence);
      const pct = (r) => `${Math.round(r * 100)} %`;
      signals.push(signal(base, {
        check: 'text-zoom', sc: ['1.4.4'], status: 'fail', state: 'text200', selector: s.selector, html: s.html, bbox: s.bbox,
        description: `"${s.text.slice(0, 60)}" takes its size from the width of the window, so zooming cannot make it twice as large: it grows only to ${pct(s.byZoom)} with page zoom at 200 %, and to ${pct(s.byText)} with the text size doubled.`,
        measured: { text: s.text.slice(0, 60), fontPx: Math.round(s.px * 10) / 10, pageZoom200: Math.round(s.byZoom * 100) / 100, textZoom200: Math.round(s.byText * 100) / 100 },
        barrier: s.px * Math.max(s.byText, s.byZoom) < 2 * BODY_PX ? 'major' : 'minor', trust: 'confirmed', evidence, expected: 'Text gets twice as big when the visitor zooms to 200 %; font sizes in vw or vh alone do not.', steps,
      }));
    }
    if (!ratios.stuck.length && ratios.checked) {
      signals.push(passSignal(base, { check: 'text-zoom', sc: '1.4.4', state: 'text200', description: `All ${ratios.checked} text elements measured grow to 200 % with page zoom or with text-only zoom.`, expected, steps }));
    }

    // F69 — text cut off with text-only zoom, and with page zoom too.
    const baseline = await markClipCandidates(page);
    const original = await page.evaluate(() => {
      const els = [...document.querySelectorAll('body, body *')];
      const sizes = els.map((el) => {
        const s = getComputedStyle(el);
        return [parseFloat(s.fontSize), s.lineHeight.endsWith('px') ? parseFloat(s.lineHeight) : null];
      });
      // Every element gets twice its computed font size as an explicit value, so sizes do not compound.
      els.forEach((el, i) => {
        el.style.setProperty('font-size', `${sizes[i][0] * 2}px`, 'important');
        if (sizes[i][1]) el.style.setProperty('line-height', `${sizes[i][1] * 2}px`, 'important');
      });
      return els.length;
    });
    await page.waitForTimeout(250);
    const byText = await newlyClipped(page, baseline, { minPx: 6 });
    let both = [];
    if (byText.length) {
      await page.evaluate(() => document.querySelectorAll('body, body *').forEach((el) => { el.style.removeProperty('font-size'); el.style.removeProperty('line-height'); }));
      await page.setViewportSize(ZOOMED);
      await page.waitForTimeout(350);
      const byZoom = await newlyClipped(page, baseline, { minPx: 6 });
      both = byText.filter((c) => byZoom.some((z) => z.selector === c.selector));
    }
    for (const [i, c] of both.slice(0, 4).entries()) {
      const buf = await elementShot(page, env.img, c.selector);
      const evidence = buf ? [writeArtifact(env, `resize-${i + 1}.jpg`, buf)] : [];
      artifacts.push(...evidence);
      signals.push(signal(base, {
        check, sc: ['1.4.4'], status: 'fail', state: 'text200', selector: c.selector, html: c.html, bbox: c.bbox,
        description: `With text at 200 %, "${c.text.slice(0, 60)}" no longer fits its box and part of it is cut off, with text-only zoom and with page zoom.`,
        measured: { lostPxVertical: c.lostY, lostPxHorizontal: c.lostX }, barrier: 'major', trust: 'confirmed', evidence, expected, steps,
      }));
    }
    if (!both.length) {
      signals.push(passSignal(base, { check, sc: '1.4.4', state: 'text200', description: byText.length ? `Text-only zoom cuts off ${byText.length} box(es), but page zoom at 200 % shows all text in full, which meets the requirement.` : `With text at 200 % no box cut off its text (${original} elements).`, expected, steps }));
    }
    await clearMarks(page);
    return { ran: true, environment: environment(null, DESKTOP, { zoom: 200 }), steps, signals, artifacts };
  } finally {
    await context.close();
  }
}
