// 2.5.8 Target Size (Minimum): pointer targets are at least 24 × 24 CSS px, unless a 24 px circle centred on each
// undersized target does not touch another target or another such circle (the spacing exception). Links inside a
// sentence and unstyled browser controls are exempt and skipped. With the AAA profile, 2.5.5 (44 px) is checked too.
import { openPage, signal, passSignal, environment, writeArtifact, capByKind, DESKTOP } from './common.mjs';

export const check = 'target-size';

export async function measureTargets(page, min = 24) {
  return page.evaluate((min) => {
    const sel = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[onclick]';
    const all = [...document.querySelectorAll(sel)].filter((el) => {
      if (!window.__wr.visible(el) || getComputedStyle(el).pointerEvents === 'none') return false;
      // Count the outermost target only: an icon inside a button is the same target.
      const outer = el.parentElement?.closest(sel);
      return !(outer && window.__wr.visible(outer));
    });
    const boxes = all.map((el) => { const r = el.getBoundingClientRect(); return { el, r, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
    const isInline = (el) => {
      if (getComputedStyle(el).display !== 'inline') return false;
      const block = el.parentElement;
      if (!block) return false;
      const own = [...block.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      return own.length > 15;
    };
    const uaDefault = (el) => el.matches('input[type=checkbox],input[type=radio]') && getComputedStyle(el).appearance !== 'none' && !el.style.width && !el.style.height;
    const distRect = (x, y, r) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
    const small = boxes.filter((b) => b.r.width < min || b.r.height < min);
    const out = [];
    for (const b of small) {
      if (isInline(b.el) || uaDefault(b.el)) continue;
      const clash = boxes.find((o) => {
        if (o === b) return false;
        const oSmall = o.r.width < min || o.r.height < min;
        return oSmall ? Math.hypot(o.cx - b.cx, o.cy - b.cy) < min : distRect(b.cx, b.cy, o.r) < min / 2;
      });
      if (!clash) continue;
      out.push({ ...window.__wr.describe(b.el), width: Math.round(b.r.width * 10) / 10, height: Math.round(b.r.height * 10) / 10, near: window.__wr.name(clash.el) || clash.el.tagName.toLowerCase() });
    }
    return { total: boxes.length, small: small.length, failing: out };
  }, min);
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900).',
    'Measure every link, button and form control that can be clicked or tapped.',
    'For each one smaller than 24 × 24 pixels, test whether it has enough space around it (a 24 pixel circle centred on it touches no other target).',
  ];
  const expected = 'Click and tap targets are at least 24 × 24 pixels, or have enough space around them.';
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  const signals = [];
  const artifacts = [];
  try {
    for (const [sc, min] of [['2.5.8', 24], ...(env.level === 'AAA' ? [['2.5.5', 44]] : [])]) {
      const m = await measureTargets(page, min);
      const failing = capByKind(m.failing, 2, 12);
      for (const f of failing) {
        signals.push(signal(base, {
          check, sc: [sc], status: 'fail', selector: f.selector, html: f.html, bbox: f.bbox,
          description: `${f.name ? `"${f.name.slice(0, 50)}"` : `The ${f.tag} control`} is ${f.width} × ${f.height} pixels and sits too close to "${String(f.near).slice(0, 40)}" for the space around it to make up the difference.`,
          measured: { width: f.width, height: f.height, minimum: min, nearest: f.near },
          barrier: 'minor', trust: 'confirmed', expected: sc === '2.5.8' ? expected : 'Click and tap targets are at least 44 × 44 pixels.', steps,
        }));
      }
      if (!failing.length) {
        signals.push(passSignal(base, { check, sc, description: `${m.total} click and tap targets measured; ${m.small} are smaller than ${min} pixels but have enough space around them or are exempt.`, expected, steps }));
      }
    }
    if (signals.some((s) => s.status === 'fail')) {
      artifacts.push(writeArtifact(env, 'target-size.jpg', await page.screenshot({ type: 'jpeg', quality: 70 })));
      for (const s of signals) if (s.status === 'fail') s.evidence = artifacts.slice();
    }
  } finally {
    await context.close();
  }
  return { ran: true, environment: environment(null, DESKTOP, { input: 'mouse' }), steps, signals, artifacts };
}
