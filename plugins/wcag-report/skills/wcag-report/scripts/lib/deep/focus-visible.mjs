// 2.4.7 Focus Visible: for a sample of keyboard stops, compare the element without focus and with keyboard focus,
// pixel by pixel around it and by computed style. Transitions, animations and the text caret are switched off so
// only the focus styling can change.
import { openPage, signal, passSignal, environment, writeArtifact, capByKind, DESKTOP } from './common.mjs';
import { traverse } from './keyboard.mjs';

export const check = 'focus-visible';

const FREEZE = '*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
const PAD = 8;

export async function focusByKeyboard(page, selector) {
  // Focus the element, step away with Shift+Tab and come back with Tab, so the browser treats it as keyboard focus.
  return page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  }, selector).then(async (ok) => {
    if (!ok) return false;
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    let same = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
    if (!same) {
      await page.evaluate((sel) => document.querySelector(sel)?.focus({ preventScroll: true }), selector);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      same = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
    }
    return same;
  });
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900) and turn off animations.',
    'For each sampled element, take a close-up without focus, then move to it with the keyboard and take the same close-up.',
    'Compare the two pictures and the element\'s styling.',
  ];
  const expected = 'Anyone using a keyboard can see which element has focus.';
  const trace = env.shared.trace ?? await traverse(env);
  // An iframe passes focus into its own document, which draws (or not) the highlight: it is that document's element
  // that has focus, and a third-party frame (a captcha badge) cannot be judged from outside.
  const sample = capByKind(trace.forward.filter((s) => s.bbox && s.bbox.w > 0 && s.bbox.h > 0 && !String(s.selector).includes('>>>') && s.tag !== 'iframe' && !/^iframe\b/.test(String(s.selector).split(' > ').at(-1).trim())), 3, env.maxFocusSamples ?? 40);
  if (!sample.length) return { ran: false, reason: 'No element on the page receives keyboard focus.', steps, signals: [], artifacts: [] };

  const { context, page } = await openPage(env, { viewport: DESKTOP });
  const signals = [];
  const artifacts = [];
  let tested = 0;
  const indicators = [];
  try {
    await page.addStyleTag({ content: FREEZE }).catch(() => page.evaluate((css) => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }, FREEZE));
    await page.mouse.move(0, 0);
    for (const [i, stop] of sample.entries()) {
      const prep = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el || !window.__wr.visible(el)) return null;
        document.activeElement?.blur?.();
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = el.getBoundingClientRect();
        const textEntry = el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]),textarea,[contenteditable]');
        return { r: { x: r.left, y: r.top, w: r.width, h: r.height }, style: window.__wr.focusStyle(el), vw: innerWidth, vh: innerHeight, textEntry };
      }, stop.selector);
      if (!prep) continue;
      const clip = {
        x: Math.max(0, Math.floor(prep.r.x - PAD)), y: Math.max(0, Math.floor(prep.r.y - PAD)),
      };
      clip.width = Math.min(prep.vw - clip.x, Math.ceil(prep.r.w + PAD * 2));
      clip.height = Math.min(prep.vh - clip.y, Math.ceil(prep.r.h + PAD * 2));
      if (clip.width < 4 || clip.height < 4 || prep.r.w > 900 || prep.r.h > 600) continue;
      await page.waitForTimeout(60);
      const before = await page.screenshot({ clip, type: 'png' });
      const before2 = await page.screenshot({ clip, type: 'png' });
      const noise = await env.img.diff(before, before2);
      if (noise.ratio > 0.01) continue; // the area changes by itself (video, carousel): no fair comparison
      if (!(await focusByKeyboard(page, stop.selector))) continue;
      await page.waitForTimeout(60);
      const moved = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top }; }, stop.selector);
      if (Math.abs(moved.x - prep.r.x) > 1 || Math.abs(moved.y - prep.r.y) > 1) continue; // focusing scrolled the page
      const after = await page.screenshot({ clip, type: 'png' });
      const styleAfter = await page.evaluate((sel) => window.__wr.focusStyle(document.querySelector(sel)), stop.selector);
      tested += 1;
      const d = await env.img.diff(before, after);
      const perimeter = 2 * (prep.r.w + prep.r.h);
      const threshold = Math.max(12, Math.round(0.25 * perimeter));
      const changedProps = Object.keys(styleAfter).filter((k) => styleAfter[k] !== prep.style[k]);
      if (d.changed >= threshold) {
        // 1.4.11: the indicator itself must stand out (3:1) from what was there before it was drawn.
        const cc = await env.img.changeContrast(before, after);
        indicators.push({ stop, contrast: cc, files: null, before, after });
        continue;
      }
      const files = [
        writeArtifact(env, `focus-${String(i + 1).padStart(2, '0')}-before.jpg`, (await env.img.toJpeg(before, { quality: 0.8 })).buffer),
        writeArtifact(env, `focus-${String(i + 1).padStart(2, '0')}-after.jpg`, (await env.img.toJpeg(after, { quality: 0.8 })).buffer),
      ];
      artifacts.push(...files);
      const label = stop.name ? `"${stop.name}"` : `the ${stop.tag} element`;
      const measured = { changedPixels: d.changed, threshold, changedStyles: changedProps };
      // A style that changes while not one pixel does (an outline in the colour of what is behind it, a box shadow of
      // width 0) shows nothing: that is decided, not a question. A text field keeps its caret as the only cue.
      if ((changedProps.length && d.changed > 0) || prep.textEntry) {
        signals.push(signal(base, {
          check, sc: ['2.4.7'], status: 'needs_review', state: 'focus', selector: stop.selector, html: stop.html, bbox: stop.bbox,
          description: `When ${label} receives keyboard focus it looks almost the same as without focus${prep.textEntry ? ' (only the text cursor may show where you are)' : ''}.`,
          question: 'Compare the two close-ups: can a sighted keyboard user tell that this element has focus?',
          measured, barrier: 'major', trust: 'review', evidence: files, expected, steps,
        }));
      } else {
        signals.push(signal(base, {
          check, sc: ['2.4.7'], status: 'fail', state: 'focus', selector: stop.selector, html: stop.html, bbox: stop.bbox,
          description: `When ${label} receives keyboard focus nothing about it changes on screen.`,
          measured, barrier: 'major', trust: 'confirmed', evidence: files, expected, steps,
        }));
      }
    }
  } finally {
    await context.close();
  }
  if (!tested) return { ran: false, reason: 'No sampled element could be compared with and without focus.', steps, signals: [], artifacts };
  // A focus style drawn mostly in colours under 3:1 against what it covers is hard to see (median of changed pixels).
  const weak = indicators.filter((x) => x.contrast.changed > 0 && x.contrast.p75 < 3);
  for (const [k, w] of weak.slice(0, 3).entries()) {
    const files = [
      writeArtifact(env, `focus-contrast-${k + 1}-before.jpg`, (await env.img.toJpeg(w.before, { quality: 0.8 })).buffer),
      writeArtifact(env, `focus-contrast-${k + 1}-after.jpg`, (await env.img.toJpeg(w.after, { quality: 0.8 })).buffer),
    ];
    artifacts.push(...files);
    const label = w.stop.name ? `"${w.stop.name}"` : `the ${w.stop.tag} element`;
    signals.push(signal(base, {
      check: 'focus-contrast', sc: ['1.4.11'], status: 'fail', state: 'focus', selector: w.stop.selector, html: w.stop.html, bbox: w.stop.bbox,
      description: `The keyboard highlight on ${label} is drawn in colours only ${w.contrast.median.toFixed(1)}:1 against what it covers, below the 3:1 needed to see it.`,
      measured: { medianContrast: Number(w.contrast.median.toFixed(2)), p75Contrast: Number(w.contrast.p75.toFixed(2)), changedPixels: w.contrast.changed },
      barrier: 'major', trust: 'confirmed', evidence: files, expected: 'The keyboard highlight has at least 3:1 contrast against the colours next to it.', steps,
    }));
  }
  if (indicators.length && !weak.length) {
    const min = Math.min(...indicators.map((x) => x.contrast.p75));
    signals.push(passSignal(base, { check: 'focus-contrast', sc: '1.4.11', state: 'focus', description: `The keyboard highlight of ${indicators.length} sampled elements has at least ${min.toFixed(1)}:1 contrast against what it covers.`, expected: 'The keyboard highlight has at least 3:1 contrast against the colours next to it.', steps }));
  }
  if (!signals.some((s) => s.status === 'fail')) {
    signals.push(passSignal(base, { check, sc: '2.4.7', state: 'focus', description: `${tested - signals.length} of ${tested} sampled elements show a visible change when they receive keyboard focus.`, expected, steps }));
  }
  return { ran: true, environment: environment(null, DESKTOP), steps, signals, artifacts, notes: `${tested} elements compared` };
}
