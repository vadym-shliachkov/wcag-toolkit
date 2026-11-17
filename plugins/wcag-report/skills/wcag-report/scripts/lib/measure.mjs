// Measurements on every reviewed page that settle what the automated rules leave undecided:
// - 1.4.3 text whose background axe could not determine (a photo, a gradient, a pseudo-element): the text is hidden,
//   the pixels behind it are read, and its colour is compared with the worst part of that background;
// - 1.4.1 links inside running text that differ from it only by colour;
// - 2.5.3 controls whose accessible name does not contain their visible words;
// - 1.4.3 text in the states a visitor puts it in, the pointer over it or keyboard focus on it (state-contrast.mjs).
// Each page writes deep/<template>/measure-<page>.json in the deep-check record shape, so candidates picks it up.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { log } from './log.mjs';
import { openPage, signal, passSignal, DESKTOP, isNetworkError, isRefusal, skipRefused, noteRefused, REFUSED_REASON } from './deep/common.mjs';
import { stateContrast, STEPS as STATE_STEPS } from './state-contrast.mjs';

// Transitions are switched off on the whole page while measuring: a link that fades its colour over 0.3 s would show
// half its letters when its background is read, and, shown again, would still be fading in when the next element
// inside it is measured.
export const HIDE = '*,*::before,*::after{transition:none!important}[data-wr-hide],[data-wr-hide] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;text-decoration-color:transparent!important}';
const STEPS = {
  background: ['Load the page in a desktop window (1280 × 900).', 'Check whether the page sets a background colour on the page itself.', 'If not, look for text whose colour the page sets with no background colour set behind it by any of its containers.'],
  contrast: ['Load the page in a desktop window (1280 × 900).', 'For text whose background the automated check could not work out, hide the text and read the colours of the pixels behind it.', 'Compare the text colour with the lightest (for light text) or darkest (for dark text) part of that background.'],
  links: ['For links inside paragraphs, check whether they are underlined or otherwise marked.', 'If only their colour differs, measure that colour against the surrounding text and check what changes on focus.'],
  names: ['For every link and button with visible words, compare those words with the name assistive technology reads out.'],
};

const lum = ([r, g, b]) => {
  const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const rgb = (s) => (String(s).match(/[\d.]+/g) ?? []).map(Number);

export async function measureContrast(page, img, rawTarget) {
  // A selector can carry an attribute whose value changes on every load (WP Rocket's
  // data-rocket-lazy-bg-<uuid>="…"): when it finds nothing, the same path without data-* attribute filters is used.
  const target = await page.evaluate((sel) => {
    const one = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
    if (one(sel)) return sel;
    const bare = sel.replace(/\[data-[^\]]*\]/g, '');
    return bare !== sel && one(bare) ? bare : sel;
  }, rawTarget).catch(() => rawTarget);
  // Text that fades in when it is scrolled into view (opacity 0 until then) is brought into view and given time to
  // appear, as a visitor scrolling to it would see it.
  const faded = await page.evaluate((sel) => {
    let el = null;
    try { el = document.querySelector(sel); } catch { return false; }
    if (!el) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (Number(getComputedStyle(n).opacity) === 0) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; }
    return false;
  }, target).catch(() => false);
  if (faded) await page.waitForTimeout(900);
  const info = await page.evaluate((sel) => {
    let el = null;
    try { el = document.querySelector(sel); } catch { return null; }
    // Contrast is about what is on screen: text hidden from assistive technology (aria-hidden) is still seen.
    const shown = (x) => { const r = x.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; for (let n = x; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility !== 'visible' || Number(c.opacity) === 0) return false; } return true; };
    if (!el || !shown(el)) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rects = [];
    // Text kept for screen readers only (clipped to a 1 px box) is not seen, and its line boxes lie anywhere.
    const unseen = (e) => {
      for (let p = e; p && p !== el.parentElement; p = p.parentElement) {
        const s = getComputedStyle(p);
        const b = p.getBoundingClientRect();
        if (/rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(s.clip) || /inset\(50%\)/.test(s.clipPath) || (b.width <= 1 && b.height <= 1)) return true;
      }
      return false;
    };
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || unseen(n.parentElement)) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (b.width > 1 && b.height > 1) rects.push(b);
    }
    if (!rects.length) {
      // A form control draws its own text (a drop-down's chosen option, a field's value) on its own background: with
      // a solid background colour that pair is the contrast, whatever image draws the arrow beside it.
      if (!el.matches('select,input,textarea')) return null;
      const cs = getComputedStyle(el);
      if (!/^rgb\(|^rgba\([^)]*,\s*1\)$/.test(cs.backgroundColor)) return null;
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      return { ...window.__wr.describe(el), control: true, controlBg: cs.backgroundColor, text: (el.value || el.selectedOptions?.[0]?.textContent || el.placeholder || '').trim().slice(0, 60), color: cs.color, px, bold, large: px >= 24 || (bold && px >= 18.66), decorative: false };
    }
    const box = { x: Math.min(...rects.map((r) => r.left)), y: Math.min(...rects.map((r) => r.top)), r: Math.max(...rects.map((r) => r.right)), b: Math.max(...rects.map((r) => r.bottom)) };
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    return {
      ...window.__wr.describe(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60), color: cs.color, shadow: cs.textShadow, px, bold,
      // A symbol hidden from assistive technology next to words that say the same (an arrow after "View case study")
      // is pure decoration, which 1.4.3 exempts.
      decorative: Boolean(el.closest('[aria-hidden=true]')) && /^[^\p{L}\p{N}]+$/u.test((el.textContent || '').trim()),
      large: px >= 24 || (bold && px >= 18.66),
      clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(2, Math.min(innerWidth, box.r) - Math.max(0, box.x)), height: Math.max(2, Math.min(innerHeight, box.b) - Math.max(0, box.y)) },
      // Each line's own box. A link that wraps from the end of one line to the start of the next has a bounding box
      // over the whole paragraph, whose other words (not hidden) would be read as "background".
      lines: rects.slice(0, 12).map((r) => ({ x: Math.round(r.left - Math.max(0, box.x)), y: Math.round(r.top - Math.max(0, box.y)), w: Math.round(r.width), h: Math.round(r.height) })),
    };
  }, target);
  if (info?.control) {
    const [r, g, b, a = 1] = rgb(info.color);
    const bgRgb = rgb(info.controlBg).slice(0, 3);
    const fgL = lum(a >= 1 ? [r, g, b] : [r, g, b].map((c, k) => a * c + (1 - a) * bgRgb[k]));
    const value = ratio(fgL, lum(bgRgb));
    return { ...info, worst: value, typical: value, needed: info.large ? 3 : 4.5, halo: 0, bg: null, bbox: info.bbox };
  }
  if (!info || info.clip.width < 2 || info.clip.height < 2) return null;
  // Overlays fixed to the window (a captcha badge, a chat button, a sticky bar) are not the text's background: they
  // sit over whatever scrolls under them, and covering content is a matter for 2.4.11, not for contrast.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    for (const x of document.querySelectorAll('body *')) {
      const pos = getComputedStyle(x).position;
      if ((pos === 'fixed' || pos === 'sticky') && el && !x.contains(el)) { x.setAttribute('data-wr-overlay', x.style.visibility); x.style.setProperty('visibility', 'hidden', 'important'); }
    }
  }, target);
  await page.waitForTimeout(30);
  // The same area with the text and without it: where they differ is where the letters are.
  const withText = await page.screenshot({ type: 'png', clip: info.clip }).catch(() => null);
  await page.evaluate((sel) => document.querySelector(sel)?.setAttribute('data-wr-hide', ''), target);
  await page.waitForTimeout(30);
  const png = await page.screenshot({ type: 'png', clip: info.clip }).catch(() => null);
  await page.evaluate((sel) => {
    document.querySelector(sel)?.removeAttribute('data-wr-hide');
    for (const x of document.querySelectorAll('[data-wr-overlay]')) { x.style.visibility = x.getAttribute('data-wr-overlay'); x.removeAttribute('data-wr-overlay'); }
  }, target);
  if (!png) return null;
  // Under the letters themselves when they can be told apart from the background; else each line's own box.
  const glyphs = withText ? await img.glyphLuminance(withText, png).catch(() => ({ n: 0 })) : { n: 0 };
  const parts = [];
  if (glyphs.n < 20) for (const region of info.lines.filter((r) => r.w >= 2 && r.h >= 2)) parts.push(await img.luminance(png, { region }));
  const pick = (q, f) => f(...parts.map((x) => x[q]));
  const bg = glyphs.n >= 20 ? glyphs : parts.length
    ? { p05: pick('p05', Math.min), p50: parts.map((x) => x.p50).sort((a, b) => a - b)[Math.floor(parts.length / 2)], p95: pick('p95', Math.max) }
    : await img.luminance(png);
  const [r, g, b, a = 1] = rgb(info.color);
  // A see-through text colour is blended with the typical background before it is compared.
  // Browsers blend in sRGB, not in luminance: rgba(0,0,0,0.55) over a light mint is a mid grey of about 4.7:1, where a
  // blend of luminances would give 2.1:1. The background is taken as the grey of its typical luminance.
  const grey = (L) => 255 * (L <= 0.0031308 ? L * 12.92 : 1.055 * L ** (1 / 2.4) - 0.055);
  const fgL = a >= 1 ? lum([r, g, b]) : lum([r, g, b].map((c) => a * c + (1 - a) * grey(bg.p50)));
  // Light text is hardest to read where the background is lightest, dark text where it is darkest.
  const light = fgL > bg.p50;
  const worstBg = light ? bg.p95 : bg.p05;
  const worst = ratio(fgL, worstBg);
  const typical = ratio(fgL, bg.p50);
  const needed = info.large ? 3 : 4.5;
  // A halo or outline around the letters (text-shadow) is part of the text's own background.
  const shadow = info.shadow && info.shadow !== 'none' ? rgb(info.shadow) : null;
  const halo = shadow && shadow.length >= 3 ? ratio(fgL, lum(shadow.slice(0, 3))) : 0;
  return { ...info, worst, typical, needed, halo, bg };
}

async function linksInText(page) {
  return page.evaluate(() => {
    const out = [];
    const contrast = (a, b) => {
      const L = (c) => { const [r, g, b2] = (c.match(/[\d.]+/g) ?? []).map(Number); const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b2); };
      const x = L(a); const y = L(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    for (const a of document.querySelectorAll('p a[href], li a[href], td a[href], dd a[href]')) {
      if (out.length >= 30 || !window.__wr.visible(a)) continue;
      const block = a.closest('p,li,td,dd');
      const own = window.__wr.text(a, 200);
      const all = window.__wr.text(block, 2000);
      // Only links that sit among other words: a list of links, or a link that is the whole item, is not "in text".
      if (!own || all.replace(own, '').replace(/[\s.,;:!?()-]/g, '').length < 20) continue;
      const cs = getComputedStyle(a);
      const ps = getComputedStyle(block);
      const marked = /underline/.test(cs.textDecorationLine) || parseFloat(cs.borderBottomWidth) > 0 || cs.fontWeight !== ps.fontWeight || cs.fontStyle !== ps.fontStyle || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== ps.backgroundColor);
      out.push({ ...window.__wr.describe(a), text: own.slice(0, 60), marked, contrast: contrast(cs.color, ps.color) });
    }
    return out;
  });
}

async function focusCue(page, selector) {
  return page.evaluate((sel) => {
    const a = document.querySelector(sel);
    if (!a) return false;
    const before = getComputedStyle(a);
    const snap = [before.textDecorationLine, before.outlineStyle, before.borderBottomWidth, before.backgroundColor].join('|');
    a.focus();
    const after = getComputedStyle(a);
    const cue = [after.textDecorationLine, after.outlineStyle, after.borderBottomWidth, after.backgroundColor].join('|') !== snap;
    a.blur();
    return cue;
  }, selector).catch(() => false);
}

async function labelInName(page) {
  return page.evaluate(() => {
    const norm = (s) => String(s || '').toLowerCase().replace(/[←-⇿✀-➿→←↗›»«‹•|]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const hiddenBox = (e) => {
      const st = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0'
        || /rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(st.clip) || /inset\(50%\)/.test(st.clipPath)
        || (r.width <= 1 && r.height <= 1);
    };
    const shownText = (root) => {
      let text = '';
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 3) text += c.textContent;
          else if (c.nodeType === 1 && !hiddenBox(c)) {
            walk(c);
            if (/^(block|flex|grid|list-item|table)/.test(getComputedStyle(c).display)) text += ' ';
          }
        }
      };
      walk(root);
      return text.replace(/\s+/g, ' ').trim();
    };
    const out = { checked: 0, bad: [] };
    for (const el of document.querySelectorAll('a[href],button,[role=button],[role=link],input[type=submit],input[type=button]')) {
      if (!window.__wr.visible(el)) continue;
      const lb = el.getAttribute('aria-labelledby');
      const al = el.getAttribute('aria-label');
      if (!lb && !(al && al.trim())) continue; // the name comes from the visible content itself
      // The words a sighted user sees. innerText also returns text kept for screen readers only (an "sr-only" span
      // "(Opens in a new tab)" clipped to 1 px), which is no label anyone can see and say.
      const shown = el.localName === 'input' ? (el.value || '') : shownText(el);
      const visible = norm(shown);
      if (visible.length < 2) continue;
      const nameText = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : al;
      out.checked += 1;
      if (!norm(nameText).includes(visible)) out.bad.push({ ...window.__wr.describe(el), visible: shown.slice(0, 60), accName: nameText.trim().slice(0, 80) });
    }
    return out;
  });
}

// What other scanners report on a page that is not a WCAG failure, so the report says why instead of staying silent
// (tool notes):
// - label_split_lines: a control whose label is shown on two lines ("Meet our" / "team"). Its text content runs the
//   words together ("Meet ourteam"), so scanners that read text content find the label missing from the name. The
//   words a person sees are in the name, which is what 2.5.3 asks.
// - redundant_role: a role that repeats what the element already is (role="list" on ul or ol, role="button" on a
//   button). Harmless; on lists styled without bullets it is a deliberate workaround for a browser and screen reader that otherwise drop the list.
export async function pageNotes(page) {
  return page.evaluate(() => {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const squash = (s) => norm(s).replace(/ /g, '');
    const one = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const notes = [];
    for (const el of document.querySelectorAll('a[href],button,[role=button],[role=link]')) {
      if (!window.__wr.visible(el)) continue;
      const lb = el.getAttribute('aria-labelledby');
      const al = el.getAttribute('aria-label');
      if (!lb && !(al && al.trim())) continue;
      const nameText = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : al;
      const shown = norm(el.innerText);
      const raw = norm(el.textContent);
      if (shown.length < 2 || raw === shown) continue;
      // The words seen are in the name; the run-together text content is not, though it is the same letters.
      if (norm(nameText).includes(shown) && !norm(nameText).includes(raw) && squash(raw) === squash(shown)) {
        const d = window.__wr.describe(el);
        notes.push({ code: 'label_split_lines', selector: d.selector, html: d.html, detail: `shown "${one(el.innerText)}", text content "${one(el.textContent)}", name "${one(nameText)}"` });
      }
    }
    const SAME = { UL: 'list', OL: 'list', NAV: 'navigation', MAIN: 'main', BUTTON: 'button', ASIDE: 'complementary', TABLE: 'table', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading' };
    for (const el of document.querySelectorAll('[role]')) {
      const role = el.getAttribute('role').trim().toLowerCase();
      if (SAME[el.tagName] !== role && !(el.tagName === 'A' && el.hasAttribute('href') && role === 'link')) continue;
      const d = window.__wr.describe(el);
      const bare = (el.tagName === 'UL' || el.tagName === 'OL') && getComputedStyle(el).listStyleType === 'none';
      notes.push({ code: 'redundant_role', selector: d.selector, html: d.html, detail: `role="${role}" on <${el.tagName.toLowerCase()}>${bare ? ', a list shown without bullets' : ''}` });
    }
    return notes.slice(0, 60);
  });
}

// - toggle_state_in_name: a pause, play or mute button that tells its state only by changing its name ("Pause
//   background video" becomes "Play background video"). The state is available, so 4.1.2 is met, but most screen
//   readers say nothing when the name of the focused button changes: after pressing it a user hears no confirmation.
//   aria-pressed with a fixed name is announced every time. Each such button is pressed, read, and pressed again so
//   the page is left as it was.
const MEDIA_WORD = /\b(pause|play|stop|resume|mute|unmute|lire|arr[eê]ter|reprendre|pausa|reproducir|anhalten|abspielen)\b/i;
export async function toggleNotes(page) {
  const name = (h) => h.evaluate((el) => {
    const lb = el.getAttribute('aria-labelledby');
    // Text hidden from assistive technology (an aria-hidden icon) is not part of the name.
    const text = (n) => { const c = n.cloneNode(true); c.querySelectorAll('[aria-hidden=true]').forEach((x) => x.remove()); return c.textContent; };
    const s = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : (el.getAttribute('aria-label') || text(el));
    return String(s || '').replace(/\s+/g, ' ').trim();
  });
  const notes = [];
  const handles = await page.$$('button:not([aria-pressed]):not([aria-expanded]):not([aria-checked]), [role=button]:not([aria-pressed]):not([aria-expanded]):not([aria-checked])');
  for (const h of handles.slice(0, 20)) {
    try {
      if (!(await h.evaluate((el) => window.__wr.visible(el) && !el.disabled && !el.closest('form')))) continue;
      const before = await name(h);
      if (!MEDIA_WORD.test(before)) continue;
      await h.evaluate((el) => el.click());
      await page.waitForTimeout(300);
      const after = await name(h);
      await h.evaluate((el) => el.click());
      await page.waitForTimeout(200);
      if (after && after !== before) {
        const d = await h.evaluate((el) => window.__wr.describe(el));
        notes.push({ code: 'toggle_state_in_name', selector: d.selector, html: d.html, detail: `name "${before}" becomes "${after}" when pressed; no aria-pressed` });
      }
    } catch { /* detached or covered: not a note */ }
  }
  return notes;
}

// 1.4.3 (F24): text whose colour the site sets while the background behind it is left to the browser. A visitor who
// sets their own default colours (dark background, light text) then gets the site's dark text on their dark background.
async function colourWithoutBackground(page) {
  return page.evaluate(() => {
    const clear = (cs) => /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && cs.backgroundImage === 'none';
    if (!clear(getComputedStyle(document.documentElement)) || !clear(getComputedStyle(document.body))) return { applies: false, found: [] };
    const found = [];
    const cache = new Map();
    const painted = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (cache.has(n)) return cache.get(n);
        const cs = getComputedStyle(n);
        if (!clear(cs)) { cache.set(n, true); return true; }
      }
      return false;
    };
    for (const el of document.querySelectorAll('body *')) {
      if (found.length >= 5) break;
      if (el.matches('script,style,noscript,svg,svg *') || !window.__wr.visible(el)) continue;
      if (![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length >= 3)) continue;
      const color = getComputedStyle(el).color;
      // The browser's own colours are not set by the page: black text, and a link's default blue, purple or red,
      // which follow the visitor's colour settings like the white behind them.
      const browserLink = el.closest('a[href]') && ['rgb(0, 0, 238)', 'rgb(85, 26, 139)', 'rgb(255, 0, 0)'].includes(color);
      if (color === 'rgb(0, 0, 0)' || browserLink || el.closest(':disabled') || /, 0\)$/.test(color) || el.closest('[data-wr-hide]') || painted(el)) continue;
      found.push({ ...window.__wr.describe(el), color, text: window.__wr.text(el, 60) });
    }
    return { applies: true, found };
  });
}

export async function measurePage(env, page, axe, stateFails = []) {
  const base = { pageId: env.pageId, url: env.url };
  const signals = [];
  await page.addStyleTag({ content: HIDE }).catch(() => {});

  // 1.4.3 — the nodes axe could not decide.
  // Up to 150 per page: a long article has dozens of bold phrases over a gradient, and each one left unmeasured stays
  // an open question.
  const undecided = (axe?.incomplete ?? []).filter((v) => v.id === 'color-contrast').flatMap((v) => v.nodes ?? []).slice(0, 150);
  let measured = 0;
  let worstPass = Infinity;
  const targets = [];
  let decorative = 0;
  for (const n of undecided) {
    const target = Array.isArray(n.target) ? n.target.flat().join(' ') : n.target;
    const m = await measureContrast(page, env.img, target).catch(() => null);
    if (!m) continue;
    measured += 1;
    targets.push(target);
    if (m.decorative) { decorative += 1; continue; }
    const ok = m.worst >= m.needed || m.halo >= m.needed;
    const values = { worstContrast: Number(m.worst.toFixed(2)), typicalContrast: Number(m.typical.toFixed(2)), required: m.needed, fontPx: Math.round(m.px), bold: m.bold, textColor: m.color, haloContrast: m.halo ? Number(m.halo.toFixed(2)) : null };
    if (ok) { worstPass = Math.min(worstPass, m.halo >= m.needed ? m.halo : m.worst); continue; }
    signals.push(signal(base, {
      check: 'contrast-measured', sc: ['1.4.3'], status: 'fail', selector: target, html: n.html, bbox: m.bbox,
      description: `"${m.text}" is ${m.color.replace(/\s/g, '')} text over a background that is not a single colour; at its ${m.worst < m.typical ? 'weakest' : 'typical'} point the contrast is ${m.worst.toFixed(1)}:1, below the ${m.needed}:1 required for text of this size.`,
      measured: values, barrier: m.worst < 2 ? 'major' : 'minor', trust: 'confirmed', expected: `Text has at least ${m.needed}:1 contrast against everything behind it.`, steps: STEPS.contrast,
    }));
  }
  // The rule's own failures are measured on screen as well. It works out the background from the CSS of the elements
  // under the text, and can pick a colour that is not what shows there (a section painted over a dark footer); the
  // pixels behind the text are what people see. A failure is withdrawn only when every part of that background
  // reaches the required contrast.
  // The same rule's failures in other window states (320 px wide) are measured here too: the colours are the same.
  const failed = [...(axe?.violations ?? []).filter((v) => v.id === 'color-contrast').flatMap((v) => v.nodes ?? []), ...stateFails.map((t) => ({ target: t }))]
    .filter((n, k, all) => all.findIndex((m) => String(m.target) === String(n.target)) === k).slice(0, 40);
  const overturned = [];
  for (const n of failed) {
    const target = Array.isArray(n.target) ? n.target.flat().join(' ') : n.target;
    const m = await measureContrast(page, env.img, target).catch(() => null);
    if (m && !m.decorative && m.worst >= m.needed) overturned.push({ target, worst: Number(m.worst.toFixed(2)), needed: m.needed });
  }
  // The targets measured, so merge can drop the automated "could not decide" items they settle, and the failures the
  // pixels overturn.
  const settled = { check: 'contrast-measured', targets, overturned: overturned.map((x) => x.target), linkCheck: true, nameCheck: true };
  if (overturned.length) {
    signals.push(passSignal(base, { check: 'contrast-measured', sc: '1.4.3', description: `${overturned.length} text element(s) the automated rule reported were measured against the pixels behind them on screen and reach the required contrast (lowest ${Math.min(...overturned.map((x) => x.worst)).toFixed(1)}:1); the rule had taken a background colour that is not the one shown.`, expected: 'Text has enough contrast against its background.', steps: STEPS.contrast }));
  }
  if (!signals.some((s) => s.sc.includes('1.4.3'))) {
    signals.push(passSignal(base, { check: 'contrast-measured', sc: '1.4.3', description: measured ? `${measured - decorative} text element(s) over images, gradients or layered backgrounds were measured against the pixels behind them; all reach the required contrast${Number.isFinite(worstPass) ? ` (lowest ${worstPass.toFixed(1)}:1)` : ''}.${decorative ? ` ${decorative} decorative symbol(s) hidden from assistive technology (such as an arrow after a link's words) are exempt as pure decoration.` : ''}` : 'The automated contrast check could work out the colours of all text on this page.', expected: 'Text has enough contrast against its background.', steps: STEPS.contrast }));
  }

  // 1.4.3 — text in hover and keyboard-focus states, which the automated pass (the page at rest) never sees.
  const states = await stateContrast(env, page).catch((e) => { log('measure', env.pageId, 'state contrast failed:', String(e.message).split('\n')[0]); return null; });
  if (states) signals.push(...states.signals);

  // 1.4.3 — text colour set without a background colour behind it (F24).
  const bare = await colourWithoutBackground(page).catch(() => ({ applies: false, found: [] }));
  if (bare.found.length) {
    const f = bare.found[0];
    signals.push(signal(base, {
      check: 'colour-without-background', sc: ['1.4.3'], status: 'fail', selector: f.selector, html: f.html, bbox: f.bbox,
      description: `The page sets its text colour (for example ${f.color.replace(/\s/g, '')} for "${f.text.slice(0, 40)}") but no background colour, so it relies on the browser's default white; visitors who choose their own colours, such as a dark background, get text they cannot read.`,
      measured: { textColour: f.color, examples: bare.found.map((x) => x.selector) }, barrier: 'minor', trust: 'confirmed',
      expected: 'When a page sets the text colour, it also sets the background colour behind it (and the reverse).', steps: STEPS.background,
    }));
  } else {
    signals.push(passSignal(base, { check: 'colour-without-background', sc: '1.4.3', description: bare.applies ? 'Text without a background of its own keeps the browser\'s default colours, so it follows the visitor\'s colour settings.' : 'The page sets its own background colour along with its text colours.', expected: 'When a page sets the text colour, it also sets the background colour behind it.', steps: STEPS.background }));
  }

  // 1.4.1 — links inside running text.
  const links = await linksInText(page).catch(() => []);
  let colourOnly = 0;
  for (const l of links.filter((x) => !x.marked)) {
    const cue = l.contrast >= 3 ? await focusCue(page, l.selector) : false;
    if (l.contrast >= 3 && cue) continue;
    colourOnly += 1;
    if (colourOnly > 3) continue;
    signals.push(signal(base, {
      check: 'link-in-text', sc: ['1.4.1'], status: 'fail', selector: l.selector, html: l.html, bbox: l.bbox,
      description: `The link "${l.text}" sits in running text and differs from it only by colour (${l.contrast.toFixed(1)}:1 against the text${l.contrast >= 3 ? ', with no extra cue on focus' : ''}); people who cannot see the colour difference cannot find it.`,
      measured: { contrastWithText: Number(l.contrast.toFixed(2)) }, barrier: 'minor', trust: 'confirmed', expected: 'Links in text are marked by more than colour: an underline, or 3:1 against the text plus a cue on focus and hover.', steps: STEPS.links,
    }));
  }
  if (links.length && !colourOnly) signals.push(passSignal(base, { check: 'link-in-text', sc: '1.4.1', description: `The ${links.length} link(s) inside running text are underlined or otherwise marked, not by colour alone.`, expected: 'Links in text are marked by more than colour.', steps: STEPS.links }));

  // 2.5.3 — visible words are part of the accessible name.
  const names = await labelInName(page).catch(() => ({ checked: 0, bad: [] }));
  for (const b of names.bad.slice(0, 3)) {
    signals.push(signal(base, {
      check: 'label-in-name', sc: ['2.5.3'], status: 'fail', selector: b.selector, html: b.html, bbox: b.bbox,
      description: `The control shows "${b.visible}" but is named "${b.accName}" for assistive technology; a voice-control user who says what they see cannot activate it.`,
      measured: { visible: b.visible, accessibleName: b.accName }, barrier: 'minor', trust: 'confirmed', expected: 'The name read by assistive technology contains the words shown on the control.', steps: STEPS.names,
    }));
  }
  if (!names.bad.length) signals.push(passSignal(base, { check: 'label-in-name', sc: '2.5.3', description: names.checked ? `The ${names.checked} control(s) with their own accessible name include the words they show.` : 'Every link and button is named by the words it shows.', expected: 'The name read by assistive technology contains the words shown on the control.', steps: STEPS.names }));
  for (const s of signals) s.measured = { ...(s.measured ?? {}), settled };
  return signals;
}

export async function measurePages(ctx, { browser, img, deadline }) {
  const pages = readJson(ctx.p.pages).pages.filter((p) => p.status >= 200 && p.status < 300 && !p.blocked && !p.soft404 && !p.error && p.templateId);
  let done = 0;
  for (const pg of pages) {
    const file = path.join(ctx.p.deepDir(pg.templateId), `measure-${pg.id}.json`);
    const env = { browser, img, url: pg.finalUrl || pg.url, pageId: pg.id, templateId: pg.templateId, options: ctx.run.options, outDir: ctx.p.deepDir(pg.templateId), relDir: `deep/${pg.templateId}` };
    if (fs.existsSync(file)) {
      const old = readJson(file, null);
      // Measured before tool notes existed: the page is looked at once more, for its notes only.
      if (old?.ran && !old.notes) {
        if (Date.now() > deadline) return { done: false, measured: done, pages: pages.length };
        try {
          const { context, page } = await openPage(env, { viewport: DESKTOP });
          try { old.notes = await pageNotes(page); } finally { await context.close(); }
          writeJson(file, old);
        } catch (e) { log('measure', pg.id, 'notes failed:', String(e.message).split('\n')[0]); }
      }
      done += 1;
      continue;
    }
    if (Date.now() > deadline) return { done: false, measured: done, pages: pages.length };
    const started = Date.now();
    let signals = [];
    let notes = [];
    let reason = null;
    try {
      const { context, page } = await openPage(env, { viewport: DESKTOP });
      try {
        notes = await pageNotes(page).catch(() => []);
        const states = readJson(path.join(ctx.p.deepDir(pg.templateId), 'states.json'), null);
        const stateFails = (states?.signals ?? []).filter((x) => x.pageId === pg.id && x.check === 'color-contrast' && x.status === 'fail' && x.selector).map((x) => x.selector);
        signals = await measurePage(env, page, readJson(ctx.p.axe(pg.id), null), stateFails);
        // Last, because it presses buttons (and presses them back).
        notes.push(...await toggleNotes(page).catch(() => []));
      } finally { await context.close(); }
    } catch (e) { reason = String(e.message).split('\n')[0]; }
    if (reason && isRefusal(reason) && skipRefused()) {
      noteRefused(ctx.dir, { templateId: pg.templateId, pageId: pg.id, url: env.url, step: 'measure' });
      reason = REFUSED_REASON;
    } else if (reason && isNetworkError(reason)) {
      log('measure', pg.id, 'network lost:', reason);
      return { done: false, offline: true, measured: done, pages: pages.length };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, { check: 'measure', templateId: pg.templateId, pageId: pg.id, url: env.url, ran: !reason, reason, environment: { viewport: [1280, 900], zoom: 100, input: 'mouse' }, steps: [...Object.values(STEPS).flat(), ...STATE_STEPS], signals, notes, artifacts: signals.flatMap((s) => s.evidence ?? []), ms: Date.now() - started });
    log('measure', pg.id, reason ? `failed: ${reason}` : `${signals.filter((s) => s.status === 'fail').length} fail`, `${Date.now() - started} ms`);
    done += 1;
  }
  return { done: true, measured: done, pages: pages.length };
}
