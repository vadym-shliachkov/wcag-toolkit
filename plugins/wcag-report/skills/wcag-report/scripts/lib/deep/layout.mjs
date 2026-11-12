// Detecting text that a change of size or spacing cuts off. The same DOM is measured before and after the change, so
// only clipping the change caused is reported (carousels and "read more" boxes clip by design at the start).

export async function markClipCandidates(page) {
  return page.evaluate(() => {
    let n = 0;
    const out = {};
    for (const el of document.querySelectorAll('body *')) {
      if (el.matches('input,select,textarea,option,script,style,svg *,iframe,video,canvas,img')) continue;
      const s = getComputedStyle(el);
      const clipsY = /hidden|clip/.test(s.overflowY);
      const clipsX = /hidden|clip/.test(s.overflowX);
      if (!clipsY && !clipsX) continue;
      if (!window.__wr.visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Visually hidden text for screen readers is clipped on purpose.
      if (r.width <= 2 || r.height <= 2 || s.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\(50%\)/.test(s.clipPath)) continue;
      const text = window.__wr.text(el, 200);
      if (text.length < 3) continue;
      const id = String(n++);
      el.setAttribute('data-wr-clip', id);
      out[id] = { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth, clipsX, clipsY, ellipsis: s.textOverflow === 'ellipsis' };
    }
    return out;
  });
}

// Elements that clip more text than they did at the start, after the caller changed the page.
export async function newlyClipped(page, baseline, { minPx = 3 } = {}) {
  return page.evaluate(({ baseline, minPx }) => {
    const out = [];
    for (const el of document.querySelectorAll('[data-wr-clip]')) {
      const b = baseline[el.getAttribute('data-wr-clip')];
      if (!b || b.ellipsis || !window.__wr.visible(el)) continue;
      // Wider spacing or bigger text makes content grow inside its box; it never makes the box shrink. A box much
      // smaller than at the start was closed by a script (an accordion folding up while it was measured).
      if (el.clientHeight < b.ch * 0.5 || el.clientHeight <= 4) continue;
      const lostY = b.clipsY ? (el.scrollHeight - el.clientHeight) - Math.max(0, b.sh - b.ch) : 0;
      // A slider shows part of its strip and brings the rest into view with its Previous / Next controls: what sticks
      // out sideways is reachable, not lost.
      const slider = /\b(swiper|slick|carousel|slider|glide|splide|owl-)/i.test(`${el.className} ${el.parentElement?.className ?? ''}`)
        || [...el.querySelectorAll('button,[role=button],a')].some((c) => /\b(prev(ious)?|next)\b|[‹›←→]/i.test(`${c.getAttribute('aria-label') ?? ''} ${c.textContent ?? ''} ${c.className}`));
      const lostX = b.clipsX && !slider ? (el.scrollWidth - el.clientWidth) - Math.max(0, b.sw - b.cw) : 0;
      if (lostY < minPx && lostX < minPx) continue;
      // A clipping ancestor already reported covers its descendants.
      if (out.some((o) => o.el.contains(el))) continue;
      out.push({ el, lostX: Math.max(0, lostX), lostY: Math.max(0, lostY) });
    }
    return out.slice(0, 20).map((o) => ({ ...window.__wr.describe(o.el), text: window.__wr.text(o.el, 120), lostX: o.lostX, lostY: o.lostY }));
  }, { baseline, minPx });
}

export async function clearMarks(page) {
  await page.evaluate(() => document.querySelectorAll('[data-wr-clip]').forEach((e) => e.removeAttribute('data-wr-clip'))).catch(() => {});
}

// A JPEG close-up of an element in the current viewport, for evidence.
export async function elementShot(page, img, selector, { pad = 16, maxWidth = 900 } = {}) {
  const clip = await page.evaluate(({ sel, pad }) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.left - pad);
    const y = Math.max(0, r.top - pad);
    return { x, y, width: Math.max(8, Math.min(innerWidth - x, r.width + pad * 2)), height: Math.max(8, Math.min(innerHeight - y, r.height + pad * 2)) };
  }, { sel: selector, pad });
  if (!clip) return null;
  const png = await page.screenshot({ clip, type: 'png' });
  return (await img.toJpeg(png, { maxWidth, quality: 0.78 })).buffer;
}
