// Shared in-page helpers for the deep checks. Evaluated with page.evaluate (not a script tag), so a site's
// Content-Security-Policy cannot block it. Defines window.__wr once per document.
(() => {
  if (window.__wr) return;
  // Sections drawn only once scrolled near (content-visibility: auto, WP Rocket's lazy render) are not rendered while
  // off-screen: their innerText is empty and their boxes are placeholders. A visitor scrolling there sees them, so the
  // checks see them too.
  try {
    const cv = document.createElement('style');
    cv.setAttribute('data-wr', 'content-visibility');
    cv.textContent = '*{content-visibility:visible!important}';
    (document.head || document.documentElement).append(cv);
  } catch { /* no document yet */ }
  const HASHY = /(^|[-_])(css|sc|jsx|emotion)-|_[a-z0-9]{5,}$|[A-Za-z]+__[A-Za-z]+___[A-Za-z0-9]{5}|\d{3,}|[a-f0-9]{8,}/;
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'));

  function stableClasses(el) {
    return [...el.classList].filter((c) => !HASHY.test(c) && c.length < 40).slice(0, 2);
  }

  // A short selector that matches exactly this element: a stable id, else a path of tag.class:nth-of-type steps.
  function sel(el) {
    if (!(el instanceof Element)) return null;
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !HASHY.test(el.id) && document.querySelectorAll(`#${esc(el.id)}`).length === 1) {
      return `#${esc(el.id)}`;
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const cls = stableClasses(node);
      if (cls.length) part += cls.map((c) => `.${esc(c)}`).join('');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch { /* keep climbing */ }
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && !HASHY.test(node.id)) {
        const withId = `#${esc(node.id)} > ${parts.slice(1).join(' > ')}`.replace(/ > $/, '');
        try { if (document.querySelectorAll(withId).length === 1) return withId; } catch { /* ignore */ }
      }
      node = parent;
    }
    return parts.join(' > ');
  }

  // Bounding box in document coordinates (CSS px).
  function box(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
      if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true' && n === el) return false;
    }
    return true;
  }

  const NATIVE_FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,iframe,summary,[contenteditable=""],[contenteditable=true],audio[controls],video[controls]';

  function isDisabled(el) {
    return el.matches(':disabled') || el.closest('fieldset:disabled') !== null && el.matches('input,select,textarea,button');
  }

  function focusable(el) {
    if (!(el instanceof Element) || isDisabled(el) || el.closest('[inert]')) return false;
    if (el.matches(NATIVE_FOCUSABLE)) return true;
    const t = el.getAttribute('tabindex');
    return t !== null && t !== '' && !Number.isNaN(Number(t));
  }

  function tabbables() {
    return [...document.querySelectorAll(`${NATIVE_FOCUSABLE},[tabindex]`)]
      .filter((el) => focusable(el) && el.tabIndex >= 0 && visible(el));
  }

  function text(el, max = 160) {
    // innerText is empty inside a section that is not rendered yet (content-visibility: auto); its words are still
    // the ones a visitor reads there.
    let s = el?.innerText;
    if (el && !String(s ?? '').trim() && String(el.textContent ?? '').trim()) {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).contentVisibility === 'auto') { s = el.textContent; break; }
    }
    return String(s ?? el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // An approximation of the accessible name, enough to describe an element in plain words.
  function name(el, max = 120) {
    if (!el) return '';
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => text(document.getElementById(id), max)).join(' ').trim();
      if (t) return t.slice(0, max);
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, max);
    if (el.labels && el.labels.length) return text(el.labels[0], max);
    if (el.tagName === 'IMG' || el.tagName === 'AREA') return (el.getAttribute('alt') || '').slice(0, max);
    const own = text(el, max);
    if (own) return own;
    const img = el.querySelector('img[alt]');
    if (img) return img.getAttribute('alt').slice(0, max);
    return (el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('value') || '').slice(0, max);
  }

  // The opening tag plus a little text: enough for a developer to recognise the element, never a whole subtree.
  function html(el, max = 400) {
    if (!el) return null;
    const clone = el.cloneNode(false);
    // The review's own markers (data-wr-*) are not the site's markup.
    for (const a of [...clone.attributes]) if (a.name.startsWith('data-wr')) clone.removeAttribute(a.name);
    let open = clone.outerHTML;
    const close = open.lastIndexOf('</');
    if (close > 0) open = open.slice(0, close);
    const t = text(el, 80);
    return `${open}${t ? `${t}…` : ''}`.slice(0, max);
  }

  function landmark(el) {
    const lm = el.closest('header,nav,main,footer,aside,dialog,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=complementary],[role=dialog]');
    if (!lm) return null;
    return lm.getAttribute('role') || { HEADER: 'banner', NAV: 'navigation', MAIN: 'main', FOOTER: 'contentinfo', ASIDE: 'complementary', DIALOG: 'dialog' }[lm.tagName] || null;
  }

  function describe(el) {
    if (!el) return null;
    return { selector: sel(el), html: html(el), bbox: box(el), name: name(el), tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), landmark: landmark(el) };
  }

  // Style properties that make keyboard focus visible; compared before and after focus.
  const FOCUS_PROPS = ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset', 'boxShadow', 'backgroundColor', 'color', 'borderTopColor', 'borderBottomColor', 'borderTopWidth', 'borderBottomWidth', 'textDecorationLine', 'transform', 'opacity'];
  function focusStyle(el) {
    const s = getComputedStyle(el);
    const o = {};
    for (const p of FOCUS_PROPS) o[p] = s[p];
    return o;
  }

  function fixedAncestor(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') return n;
    }
    return null;
  }

  // How much of the element is covered by fixed or sticky layers that are not part of it.
  function obscured(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    const pts = [];
    const n = 4;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = r.left + Math.min(r.width - 1, Math.max(1, (r.width * i) / n));
      const y = r.top + Math.min(r.height - 1, Math.max(1, (r.height * j) / n));
      if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) pts.push([x, y]);
    }
    if (!pts.length) return { inView: false, covered: 0, total: 0, by: null };
    // An element that is itself invisible (inside a closed pop-up kept at opacity 0) is not hidden *behind* anything:
    // that is a focus-visibility problem (2.4.7), which the focus-visible check measures.
    if (chainOpacity(el) < 0.1) {
      // A control that fades in when it gets focus (opacity 0 → 1 over a transition) is read right after Tab, while
      // it is still nearly transparent. Jump any running transition to its end and look again.
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
        for (const a of (n.getAnimations ? n.getAnimations() : [])) { try { a.finish(); } catch (e) { /* infinite or detached */ } }
      }
      if (chainOpacity(el) < 0.1) {
        // The outermost transparent box is the thing to change (a closed pop-up), whichever of its links has focus.
        let box = el;
        for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) if (Number(getComputedStyle(n).opacity) < 0.1) box = n;
        return { inView: false, invisible: true, hiddenIn: describe(box), covered: 0, total: pts.length, by: null };
      }
    }
    let covered = 0;
    let by = null;
    for (const [x, y] of pts) {
      const top = hidingLayerAt(el, x, y);
      if (top) { covered += 1; by = by || top; }
    }
    return { inView: true, covered, total: pts.length, by: by ? describe(by) : null };
  }

  // Effective opacity of an element: its own and every ancestor's.
  function chainOpacity(n) {
    let o = 1;
    for (; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  }
  function alphaOf(color) {
    const m = /rgba?\(([^)]+)\)/.exec(color || '');
    if (!m) return color === 'transparent' ? 0 : 1;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean);
    return parts.length >= 4 ? Number(parts[3]) : 1;
  }
  const REPLACED = /^(img|video|canvas|iframe|embed|object|picture|svg|input|select|textarea|button)$/i;
  // Does this element paint something solid at (x, y)? A transparent full-screen wrapper (a marketing pop-up's
  // positioning box) or a dimming backdrop leaves what is under it visible, so it does not hide it.
  function paintsOpaque(n, x, y) {
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden') return false;
    const op = chainOpacity(n);
    if (op < 0.9) return false;
    if (REPLACED.test(n.tagName)) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (alphaOf(cs.backgroundColor) * op >= 0.9) return true;
    for (const t of n.childNodes) {
      if (t.nodeType !== 3 || !t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const rr of range.getClientRects()) if (x >= rr.left && x <= rr.right && y >= rr.top && y <= rr.bottom) return true;
    }
    return false;
  }
  // The fixed or sticky layer that hides the element at (x, y), or null. Walks down the stack from the top: the first
  // thing that paints solidly decides. Only layers that stay on screen count; ordinary overlapping content does not.
  function hidingLayerAt(el, x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const n of stack) {
      if (n === el || el.contains(n) || n.contains(el)) return null;
      if (!paintsOpaque(n, x, y)) continue;
      const layer = fixedAncestor(n);
      return layer && !layer.contains(el) ? layer : null;
    }
    return null;
  }

  window.__wr = { sel, box, visible, focusable, tabbables, text, name, html, landmark, describe, focusStyle, obscured, fixedAncestor, stableClasses };
})();
