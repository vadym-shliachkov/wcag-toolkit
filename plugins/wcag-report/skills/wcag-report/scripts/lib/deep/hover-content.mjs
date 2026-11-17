// 1.4.13 Content on Hover or Focus: content that appears on hover must be dismissible (Escape, without moving the
// pointer), hoverable (the pointer can move onto it) and persistent. Browser "title" tooltips are controlled by the
// browser and exempt.
// 2.1.1 Keyboard (F54): what pointing reveals (a submenu, a tooltip) must also be revealed with the keyboard.
import { openPage, signal, passSignal, environment, writeArtifact, DESKTOP } from './common.mjs';

export const check = 'hover-content';

// Slideshows change by themselves while a trigger is pointed at (the same list as the motion check's).
const CAROUSEL = '[aria-roledescription*=carousel i],[aria-roledescription*=slide i],[class*=carousel i],[class*=slider i],[class*=swiper i],[class*=slick i],[class*=marquee i],[class*=ticker i],marquee';

// Triggers: elements pointing at a described or popup element, tooltip conventions, and selectors from same-origin
// style sheets that reveal something on :hover.
async function findTriggers(page) {
  return page.evaluate(() => {
    const set = new Set();
    // Submenus first: a list item of the navigation that holds a hidden list or panel (menus opened by script on
    // mouseenter have no :hover rule to find).
    for (const li of document.querySelectorAll('nav li, header li, [role=menubar] > *')) {
      const sub = li.querySelector(':scope > ul, :scope > div, :scope > [role=menu]');
      if (sub && !window.__wr.visible(sub) && sub.querySelector('a[href], button')) set.add(li);
    }
    for (const el of document.querySelectorAll('[aria-describedby],[data-tooltip],[data-tip],[data-toggle=tooltip],[data-bs-toggle=tooltip],[class*=tooltip i]:not([role=tooltip])')) set.add(el);
    for (const sheet of [...document.styleSheets]) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of [...(rules || [])]) {
        const text = rule.selectorText || '';
        for (const part of text.split(',')) {
          const m = /^(.*?):hover\s*([>+~ ]\s*\S.*)$/.exec(part.trim());
          if (!m || !/display|visibility|opacity/.test(rule.style?.cssText || '')) continue;
          try { document.querySelectorAll(m[1] || '*').forEach((el) => set.add(el)); } catch { /* unsupported selector */ }
        }
      }
    }
    return [...set].filter((el) => window.__wr.visible(el)).slice(0, 12).map((el, i) => {
      el.setAttribute('data-wr-hover', String(i));
      return { i, ...window.__wr.describe(el), focusable: window.__wr.focusable(el) };
    });
  });
}

// Mark everything currently visible so newly shown content can be found after hovering.
async function snapshot(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) if (window.__wr.visible(el)) el.setAttribute('data-wr-seen', ''); else el.removeAttribute('data-wr-seen');
  });
}

// What pointing at the trigger showed. Other things change on their own meanwhile (a slideshow moves on): the new
// content must belong to the trigger — named by it (aria-describedby, aria-controls), inside it or its list item, or
// the nearest new layer close to it — and a slide that changed by itself elsewhere is never taken for it.
async function revealed(page, i) {
  return page.evaluate(({ i, carouselSel }) => {
    const fresh = [...document.querySelectorAll('body *:not([data-wr-seen])')].filter((el) => window.__wr.visible(el) && window.__wr.text(el, 20).length > 0);
    const top = fresh.filter((el) => !fresh.some((p) => p !== el && p.contains(el)));
    if (!top.length) return null;
    const trigger = document.querySelector(`[data-wr-hover="${i}"]`);
    const named = new Set(['aria-describedby', 'aria-controls', 'aria-owns', 'aria-details'].flatMap((a) => (trigger?.getAttribute(a) || '').split(/\s+/)).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean));
    const parent = trigger?.parentElement;
    const scope = trigger?.closest('li') || (parent && !parent.matches('body,main,[role=main],header,footer,nav,section,article') ? parent : null);
    const tr = trigger?.getBoundingClientRect();
    const gap = (el) => {
      if (!tr) return Infinity;
      const r = el.getBoundingClientRect();
      return Math.hypot(Math.max(0, r.left - tr.right, tr.left - r.right), Math.max(0, r.top - tr.bottom, tr.top - r.bottom));
    };
    const ownSlideshow = (el) => { const c = el.closest(carouselSel); return !c || (trigger && c.contains(trigger)); };
    const linked = top.find((el) => [...named].some((n) => n === el || n.contains(el) || el.contains(n)));
    const inside = top.filter(ownSlideshow).find((el) => trigger?.contains(el) || (scope && scope.contains(el)));
    const near = top.filter(ownSlideshow).filter((el) => gap(el) <= 200).sort((a, b) => gap(a) - gap(b))[0];
    const el = linked || inside || near;
    if (!el) return null;
    el.setAttribute('data-wr-popup', '');
    const r = el.getBoundingClientRect();
    return { ...window.__wr.describe(el), text: window.__wr.text(el, 100), rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
  }, { i, carouselSel: CAROUSEL });
}

// From a state where the content is hidden, try what a keyboard user would: focus the trigger, focus the first
// control inside it, press the down arrow, and Tab to the first control of the hidden content.
async function keyboardReveals(page, i) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(350);
  if (await popupVisible(page)) return { tested: false };
  const interactive = await page.evaluate(() => Boolean(document.querySelector('[data-wr-popup]')?.querySelector('a[href], button, input, select, textarea, [tabindex]')));
  const tries = [
    ['focusing the trigger', (i) => document.querySelector(`[data-wr-hover="${i}"]`)?.focus()],
    ['focusing the link in the trigger', (i) => {
      const t = document.querySelector(`[data-wr-hover="${i}"]`);
      const f = t && [...t.querySelectorAll('*')].find((d) => window.__wr.focusable(d) && d.tabIndex >= 0 && window.__wr.visible(d) && !d.closest('[data-wr-popup]'));
      f?.focus();
    }],
    ['pressing the down arrow', null],
    ['tabbing to its first control', () => {
      const p = document.querySelector('[data-wr-popup]');
      const f = p && [...p.querySelectorAll('*')].find((d) => window.__wr.focusable(d) && d.tabIndex >= 0);
      f?.focus();
    }],
    // The accessible menu pattern: a separate button next to the link (aria-controls / aria-expanded) that opens
    // the menu with Enter. Keyboard users have their way in, even though focusing the link alone does nothing.
    ['pressing the button that opens it', (i) => {
      const p = document.querySelector('[data-wr-popup]');
      const t = document.querySelector(`[data-wr-hover="${i}"]`);
      if (!p || !t) return false;
      const controls = (b) => (b.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
      const opensPopup = (b) => controls(b).some((c) => c === p || c.contains(p) || p.contains(c));
      const scope = t.closest('li') || t.parentElement;
      const near = scope ? [...scope.querySelectorAll('button,[role=button]')].filter((b) => !b.closest('[data-wr-popup]') && b.hasAttribute('aria-expanded')) : [];
      const btn = [...document.querySelectorAll('[aria-controls]')].find((b) => !b.closest('[data-wr-popup]') && opensPopup(b)) || near[0];
      if (!btn || btn.tabIndex < 0) return false;
      btn.focus();
      return true;
    }, 'Enter'],
  ];
  // A key press first, so the browser treats the following focus as keyboard focus (:focus-visible).
  await page.keyboard.press('Shift');
  for (const [how, fn, key] of tries) {
    if (fn) {
      const ok = await page.evaluate(fn, i).catch(() => false);
      if (key && ok) await page.keyboard.press(key);
    } else await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    if (await popupVisible(page)) {
      // Opened by a toggle button: press it again so the next trigger starts from a closed page.
      if (key) { await page.keyboard.press(key).catch(() => {}); await page.waitForTimeout(200); }
      await blur(page);
      return { tested: true, shown: true, how, interactive };
    }
  }
  await blur(page);
  return { tested: true, shown: false, interactive };
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});

const popupVisible = (page) => page.evaluate(() => { const el = document.querySelector('[data-wr-popup]'); return Boolean(el && window.__wr.visible(el)); });

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900).',
    'Point at each element that shows extra content on hover, such as a tooltip or a menu.',
    'Press Escape without moving the pointer; then move the pointer onto the new content; then wait.',
  ];
  const expected = 'Content that appears on hover or focus can be closed with Escape, can be pointed at without disappearing, and stays until the visitor moves away.';
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  const signals = [];
  const artifacts = [];
  let tested = 0;
  const keyboardOk = [];
  try {
    const triggers = await findTriggers(page);
    for (const t of triggers) {
      await page.mouse.move(1, 1);
      await page.waitForTimeout(200);
      await snapshot(page);
      const loc = page.locator(`[data-wr-hover="${t.i}"]`);
      try { await loc.hover({ timeout: 1500 }); } catch { continue; }
      await page.waitForTimeout(450);
      const pop = await revealed(page, t.i);
      if (!pop) continue;
      tested += 1;
      const shot = writeArtifact(env, `hover-${tested}.jpg`, await page.screenshot({ type: 'jpeg', quality: 72 }));
      artifacts.push(shot);
      const label = t.name ? `"${t.name.slice(0, 50)}"` : `the ${t.tag} element`;
      const problems = [];
      // Each property is tested from a fresh hover: pointer away, back on the trigger, content showing again.
      const rehover = async () => {
        await page.mouse.move(1, 1);
        await page.waitForTimeout(250);
        await loc.hover({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(450);
        return popupVisible(page);
      };
      // Dismissible: Escape without moving the pointer.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      const afterEsc = await popupVisible(page);
      // Hoverable: move from the trigger onto the new content in small steps.
      let hoverable = true;
      if (await rehover()) {
        // The shortest way a visitor would move: from the trigger straight to the nearest point of the new content.
        const tb = await loc.boundingBox();
        const cx = tb ? tb.x + tb.width / 2 : pop.rect.left;
        const cy = tb ? tb.y + tb.height / 2 : pop.rect.top;
        const tx = Math.min(pop.rect.right - 4, Math.max(pop.rect.left + 4, cx));
        const ty = Math.min(pop.rect.bottom - 4, Math.max(pop.rect.top + 4, cy));
        await page.mouse.move(tx, ty, { steps: 8 });
        await page.waitForTimeout(400);
        hoverable = await popupVisible(page);
      }
      // Persistent: stays while the pointer rests on the trigger.
      let persistent = true;
      if (await rehover()) {
        await page.waitForTimeout(1800);
        persistent = await popupVisible(page);
      }
      const kb = await keyboardReveals(page, t.i);
      if (kb.tested && kb.shown) keyboardOk.push(label);
      if (kb.tested && !kb.shown) {
        signals.push(signal(base, {
          check: 'hover-keyboard', sc: ['2.1.1'], status: 'fail', state: 'hover', selector: t.selector, html: t.html, bbox: t.bbox,
          description: `Pointing at ${label} shows "${pop.text.slice(0, 60)}", but the keyboard cannot show it: focusing it, the down arrow and Tab leave it hidden${kb.interactive ? ', so keyboard users cannot reach the links in it' : ''}.`,
          measured: { popup: pop.selector, interactive: kb.interactive },
          barrier: kb.interactive ? 'major' : 'minor', trust: 'confirmed', evidence: [shot],
          expected: 'What appears when pointing at an element also appears when it receives keyboard focus.', steps: [...steps, 'Move the pointer away; focus the element with the keyboard, press the down arrow and Tab; check whether the content appears.'],
        }));
      }
      if (afterEsc) problems.push('it cannot be closed with Escape');
      if (!hoverable) problems.push('it disappears when the pointer moves onto it');
      if (!persistent) problems.push('it disappears by itself after a moment');
      await page.evaluate(() => document.querySelectorAll('[data-wr-popup]').forEach((e) => e.removeAttribute('data-wr-popup')));
      if (!problems.length) continue;
      signals.push(signal(base, {
        check, sc: ['1.4.13'], status: !hoverable || !persistent ? 'fail' : 'needs_review', state: 'hover', selector: t.selector, html: t.html, bbox: t.bbox,
        description: `Pointing at ${label} shows "${pop.text.slice(0, 60)}", but ${problems.join(' and ')}.`,
        question: afterEsc && hoverable && persistent ? 'Does the content that appears cover other text or controls? If it does, visitors need a way to close it without moving the pointer.' : undefined,
        measured: { dismissible: !afterEsc, hoverable, persistent, popup: pop.selector },
        barrier: 'major', trust: !hoverable || !persistent ? 'confirmed' : 'review', evidence: [shot], expected, steps,
      }));
    }
  } finally {
    await context.close();
  }
  // Nothing appears on hover or focus: the requirement does not apply to this page, which is a result, not a gap.
  if (!tested) {
    return { ran: true, environment: environment(null, DESKTOP, { input: 'mouse' }), steps, artifacts, signals: [signal(base, { check, sc: ['1.4.13'], status: 'not_applicable', state: 'hover', description: 'Pointing at and focusing the elements of this page shows no extra content (no tooltips or pop-ups).', expected, steps })] };
  }
  if (keyboardOk.length && !signals.some((s) => s.check === 'hover-keyboard')) {
    signals.push(passSignal(base, { check: 'hover-keyboard', sc: '2.1.1', state: 'hover', description: `What ${keyboardOk.length} element(s) show on hover also appears with keyboard focus.`, expected: 'What appears when pointing at an element also appears when it receives keyboard focus.', steps }));
  }
  if (!signals.some((s) => s.status === 'fail' && s.sc.includes('1.4.13'))) {
    signals.push(passSignal(base, { check, sc: '1.4.13', state: 'hover', description: `${tested} element(s) that show content on hover were tested; the content could be pointed at and stayed on screen.`, expected, steps }));
  }
  return { ran: true, environment: environment(null, DESKTOP, { input: 'mouse' }), steps, signals, artifacts };
}
