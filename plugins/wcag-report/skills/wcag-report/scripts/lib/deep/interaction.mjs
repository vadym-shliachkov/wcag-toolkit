// Interaction checks that settle a criterion on the representative page instead of leaving it to a person:
// 2.4.1 Bypass Blocks (a working skip link, or a main landmark), 3.2.1 On Focus (moving focus never changes the
// context), 2.1.4 Character Key Shortcuts (single keys do nothing), 2.5.2 Pointer Cancellation (nothing runs on
// press), and 2.1.1 / 4.1.2 for disclosure widgets (menus open with Enter and report their state).
// Gestures, device motion and dragging (2.5.1, 2.5.4, 2.5.7; F105, F106, F108): the listeners the page registers say
// whether these criteria apply. With none, the criterion does not apply; with some, the list goes to the content judge
// (input-listeners.json), which decides from the page whether a single tap or click does the same.
import { openPage, signal, passSignal, environment, writeArtifact, DESKTOP } from './common.mjs';

export const check = 'interaction';

const STEPS = {
  bypass: ['Load the page in a desktop window (1280 × 900).', 'Press Tab once from the top and see whether the first stop is a link that skips to the main content; activate it.', 'Otherwise check for a main landmark that assistive technology can jump to.'],
  focus: ['Load the page in a desktop window.', 'Press Tab through up to 60 elements.', 'After each step, check that the address, the window and the page did not change.'],
  keys: ['Load the page in a desktop window with nothing focused.', 'List the key listeners on the page.', 'Press single letter, number and punctuation keys one at a time and watch for any reaction.'],
  pointer: ['Load the page in a desktop window.', 'List controls that react to the mouse button being pressed down.', 'Press the button on each, move away and release, and see whether anything ran.'],
  gestures: ['Load the page in a desktop window.', 'List the event listeners for device motion, touch gestures and dragging on the window, the document and the elements that could use them (sliders, carousels, maps, sortable lists).'],
  toggles: ['Load the page in a desktop window.', 'Move to each menu or disclosure button with the keyboard and press Enter.', 'Check that it opens, and that its open or closed state changes for assistive technology.', 'Press Tab once and check that focus moves into what was opened.'],
};

async function listenerTypes(cdp, expression) {
  const { result } = await cdp.send('Runtime.evaluate', { expression }).catch(() => ({ result: {} }));
  if (!result?.objectId) return [];
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 }).catch(() => ({ listeners: [] }));
  return [...new Set(listeners.map((l) => l.type))];
}

// A cheap fingerprint of what a visitor would notice: address, scroll, focus, open dialogs and visible text length.
const snapshot = (page) => page.evaluate(() => ({
  url: location.href,
  y: Math.round(scrollY),
  focus: document.activeElement ? window.__wr.sel(document.activeElement) : null,
  dialogs: [...document.querySelectorAll('dialog[open],[role=dialog],[aria-modal=true]')].filter((d) => window.__wr.visible(d)).length,
  text: document.body.innerText.length,
  expanded: [...document.querySelectorAll('[aria-expanded=true],details[open]')].length,
}));

const changed = (a, b) => a.url !== b.url || Math.abs(a.y - b.y) > 40 || a.dialogs !== b.dialogs || a.expanded !== b.expanded || Math.abs(a.text - b.text) > 40;

async function bypass(page, base) {
  await page.evaluate(() => { document.activeElement?.blur?.(); scrollTo(0, 0); });
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement;
    const href = el?.getAttribute?.('href') || '';
    const id = href.startsWith('#') ? decodeURIComponent(href.slice(1)) : null;
    const target = id ? (document.getElementById(id) || document.getElementsByName(id)[0]) : null;
    return { tag: el?.localName, text: window.__wr.text(el, 60), href, hasTarget: Boolean(target), main: Boolean(document.querySelector('main,[role=main]')), ...window.__wr.describe(el) };
  });
  if (first.hasTarget) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // The target is found the way the first check found it: by id, or by name (<a name>), as the browser does.
    const after = await page.evaluate((href) => {
      const id = decodeURIComponent(href.slice(1));
      const t = document.getElementById(id) || document.getElementsByName(id)[0];
      const r = t?.getBoundingClientRect();
      return { inTarget: Boolean(t && (t === document.activeElement || t.contains(document.activeElement))), visible: Boolean(r && r.top < innerHeight && r.bottom > 0), hash: location.hash };
    }, first.href);
    // Tab once more: the next stop must be inside or after the target, not back in the header.
    await page.keyboard.press('Tab');
    const next = await page.evaluate((href) => {
      const id = decodeURIComponent(href.slice(1));
      const t = document.getElementById(id) || document.getElementsByName(id)[0];
      const a = document.activeElement;
      return Boolean(t && a && (t.contains(a) || (t.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)));
    }, first.href);
    if (after.visible && (after.inTarget || next)) {
      return passSignal(base, { check: 'bypass', sc: '2.4.1', description: `The first keyboard stop, "${first.text}", skips to the main content: after it, focus continues inside the content.`, expected: 'Visitors can skip blocks repeated on every page.', steps: STEPS.bypass });
    }
    if (!first.main) {
      return signal(base, { check: 'bypass', sc: ['2.4.1'], status: 'fail', selector: first.selector, html: first.html, bbox: first.bbox, description: `The skip link "${first.text}" does not move keyboard focus past the header, and the page has no main landmark to jump to.`, barrier: 'major', trust: 'confirmed', expected: 'Visitors can skip blocks repeated on every page.', steps: STEPS.bypass });
    }
  }
  if (first.main) {
    return passSignal(base, { check: 'bypass', sc: '2.4.1', description: 'The page marks its main content as a main landmark, which screen readers and browser extensions can jump to directly.', expected: 'Visitors can skip blocks repeated on every page.', steps: STEPS.bypass });
  }
  // W3C's sufficient techniques for 2.4.1 also include grouping the repeated blocks so they can be skipped: a heading
  // at the start of the content after them (H69), or the header and menu marked as landmarks (ARIA11). A page with
  // neither a skip link nor a main landmark still passes when its content starts with a heading after the header.
  const grouped = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('header, nav, [role=banner], [role=navigation]')].filter((el) => window.__wr.visible(el));
    const last = blocks.at(-1);
    const heading = [...document.querySelectorAll('h1, h2, [role=heading]')].find((h) => window.__wr.visible(h) && !blocks.some((b) => b.contains(h)) && (!last || (last.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING)));
    return { heading: heading ? { level: heading.localName, text: window.__wr.text(heading, 80) } : null, landmarks: blocks.length };
  }).catch(() => ({ heading: null, landmarks: 0 }));
  if (grouped.heading) {
    return passSignal(base, { check: 'bypass', sc: '2.4.1', description: `There is no skip link or main landmark, but the content after the ${grouped.landmarks ? 'header and menu landmarks' : 'header'} starts with the heading "${grouped.heading.text}" (${grouped.heading.level}), which screen reader users jump to with the heading keys (W3C technique H69${grouped.landmarks ? ', with ARIA11 for the landmarks' : ''}).`, expected: 'Visitors can skip blocks repeated on every page.', steps: STEPS.bypass });
  }
  return signal(base, { check: 'bypass', sc: ['2.4.1'], status: 'fail', description: 'There is no skip link and no main landmark: keyboard and screen reader users must pass the whole header on every page.', barrier: 'major', trust: 'confirmed', expected: 'Visitors can skip blocks repeated on every page.', steps: STEPS.bypass });
}

async function onFocus(page, context, base, blocked) {
  await page.evaluate(() => { document.activeElement?.blur?.(); scrollTo(0, 0); });
  let windows = context.pages().length;
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs += 1; d.dismiss().catch(() => {}); });
  const start = { url: page.url(), nav: blocked.navigations };
  let n = 0;
  for (; n < 60; n++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);
    const now = { url: page.url(), nav: blocked.navigations, windows: context.pages().length };
    if (now.url !== start.url || now.nav > start.nav || now.windows > windows || dialogs) {
      const el = await page.evaluate(() => ({ ...window.__wr.describe(document.activeElement), text: window.__wr.text(document.activeElement, 60) })).catch(() => ({}));
      return signal(base, { check: 'on-focus', sc: ['3.2.1'], status: 'fail', selector: el.selector, html: el.html, bbox: el.bbox, description: `Moving keyboard focus to "${el.text || el.tag || 'an element'}" ${now.windows > windows ? 'opened a new window' : dialogs ? 'opened a dialog' : 'started loading another page'} without the visitor activating anything.`, barrier: 'major', trust: 'confirmed', expected: 'Receiving focus never changes the page or opens something new by itself.', steps: STEPS.focus });
    }
    windows = now.windows;
  }
  return passSignal(base, { check: 'on-focus', sc: '3.2.1', description: `Moving keyboard focus through ${n} elements never changed the page, opened a window or started a navigation.`, expected: 'Receiving focus never changes the page or opens something new by itself.', steps: STEPS.focus });
}

async function shortcuts(page, cdp, base) {
  const types = [...await listenerTypes(cdp, 'window'), ...await listenerTypes(cdp, 'document'), ...await listenerTypes(cdp, 'document.body')];
  const keyTypes = types.filter((t) => /^key(down|up|press)$/.test(t));
  if (!keyTypes.length) {
    return passSignal(base, { check: 'shortcuts', sc: '2.1.4', description: 'The page has no key listeners on the window, the document or the body, so no single key triggers anything.', expected: 'Single-key shortcuts can be turned off, remapped, or work only when their control has focus.', steps: STEPS.keys });
  }
  const keys = [...'asdfjklgnpqwertyuiozxcvbm0123456789/?.,'];
  const reacted = [];
  for (const k of keys) {
    await page.evaluate(() => { document.activeElement?.blur?.(); });
    const before = await snapshot(page);
    await page.keyboard.press(k);
    await page.waitForTimeout(150);
    const after = await snapshot(page);
    if (changed(before, after)) reacted.push(k);
    if (after.url !== before.url) await page.goBack().catch(() => {});
    if (reacted.length >= 3) break;
  }
  if (reacted.length) {
    return signal(base, { check: 'shortcuts', sc: ['2.1.4'], status: 'fail', description: `Pressing the single key${reacted.length > 1 ? 's' : ''} ${reacted.map((k) => `"${k}"`).join(', ')} with nothing focused changes the page. Speech-input users can trigger this by accident.`, measured: { keys: reacted, listeners: keyTypes }, barrier: 'minor', trust: 'confirmed', expected: 'Single-key shortcuts can be turned off, remapped, or work only when their control has focus.', steps: STEPS.keys });
  }
  return passSignal(base, { check: 'shortcuts', sc: '2.1.4', description: `The page listens for keys (${keyTypes.join(', ')}), but none of ${keys.length} single letter, number and punctuation keys pressed with nothing focused did anything.`, expected: 'Single-key shortcuts can be turned off, remapped, or work only when their control has focus.', steps: STEPS.keys });
}

async function pointer(page, cdp, base, blocked) {
  const n = await page.evaluate(() => {
    // Pressing on a link or picture and moving away starts the browser's own drag and drop, and the automation then
    // waits for a drop that never comes. The test is about what the press itself does, so dragging is switched off.
    window.addEventListener('dragstart', (e) => e.preventDefault(), true);
    const els = [...document.querySelectorAll('a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],summary,[onclick],[tabindex]')].filter((el) => window.__wr.visible(el)).slice(0, 150);
    els.forEach((el, i) => el.setAttribute('data-wr-ptr', String(i)));
    return els.length;
  });
  const down = [];
  for (let i = 0; i < n; i++) {
    const types = await listenerTypes(cdp, `document.querySelector('[data-wr-ptr="${i}"]')`);
    if (types.some((t) => /^(mousedown|pointerdown|touchstart)$/.test(t))) down.push(i);
  }
  if (!down.length) {
    await page.evaluate(() => document.querySelectorAll('[data-wr-ptr]').forEach((e) => e.removeAttribute('data-wr-ptr')));
    return passSignal(base, { check: 'pointer', sc: '2.5.2', description: `None of the ${n} links and buttons reacts to the pointer being pressed down; their actions run on release, so a press can be cancelled by moving away.`, expected: 'Pressing a control does not run its action until the pointer is released over it.', steps: STEPS.pointer });
  }
  for (const i of down.slice(0, 8)) {
    const info = await page.evaluate((idx) => { const el = document.querySelector(`[data-wr-ptr="${idx}"]`); el.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = el.getBoundingClientRect(); return { ...window.__wr.describe(el), text: window.__wr.text(el, 60), cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, i);
    const before = await snapshot(page);
    // Only a navigation counts: a site's analytics often send a request on press, which changes nothing for the user.
    const sent = blocked.navigations;
    await page.mouse.move(info.cx, info.cy);
    await page.mouse.down();
    await page.waitForTimeout(250);
    const mid = await snapshot(page);
    const sentOnDown = blocked.navigations > sent;
    await page.mouse.move(5, 5);
    await page.mouse.up();
    await page.waitForTimeout(250);
    // Opening a menu on press is allowed: it can be closed again (abort or undo) or closes on release elsewhere (up
    // reversal). What cannot be taken back is a navigation or a submission started by the press itself (F101).
    if (mid.url !== before.url || sentOnDown) {
      await page.evaluate(() => document.querySelectorAll('[data-wr-ptr]').forEach((e) => e.removeAttribute('data-wr-ptr')));
      return signal(base, { check: 'pointer', sc: ['2.5.2'], status: 'fail', selector: info.selector, html: info.html, bbox: info.bbox, description: `"${info.text || info.tag}" starts loading another page as soon as the mouse button is pressed, so moving away before releasing cannot cancel it.`, barrier: 'minor', trust: 'confirmed', expected: 'Pressing a control does not run its action until the pointer is released over it.', steps: STEPS.pointer });
    }
    // The press changed nothing irreversible, but the release may have (a hash or history change): back to the page
    // as it was, so the next control is tested there.
    if (page.url() !== before.url) await page.goBack().catch(() => {});
  }
  await page.evaluate(() => document.querySelectorAll('[data-wr-ptr]').forEach((e) => e.removeAttribute('data-wr-ptr')));
  return passSignal(base, { check: 'pointer', sc: '2.5.2', description: `${down.length} control(s) react to the pointer being pressed, but none goes to another page or sends anything on press; what opens on press (a menu) can be closed again.`, expected: 'Pressing a control does not run its action until the pointer is released over it.', steps: STEPS.pointer });
}

async function toggles(page, base) {
  const list = await page.evaluate(() => [...document.querySelectorAll('[aria-expanded],summary')].filter((el) => window.__wr.visible(el) && window.__wr.focusable(el)).slice(0, 8)
    .map((el) => ({ ...window.__wr.describe(el), text: window.__wr.text(el, 40), native: el.localName === 'summary' })));
  if (!list.length) return [];
  const out = [];
  const opened = [];
  const orderOk = [];
  for (const t of list) {
    const state = () => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const details = el.localName === 'summary' ? el.parentElement : null;
      // The part the control opens, when its markup names it: whether that part is shown says more than the length of
      // the page's text, which a carousel turning elsewhere also changes.
      const ref = el.getAttribute('aria-controls') || el.getAttribute('data-bs-target') || el.getAttribute('data-target') || (/^#[\w-]+$/.test(el.getAttribute('href') || '') ? el.getAttribute('href') : '');
      let target = null;
      try { target = ref ? document.querySelector(ref.startsWith('#') || ref.startsWith('.') ? ref : `#${ref}`) : null; } catch { target = null; }
      const panel = target ? (target.getBoundingClientRect().height > 0 && getComputedStyle(target).visibility !== 'hidden' ? 'shown' : 'hidden') : null;
      return { aria: el.getAttribute('aria-expanded'), open: details ? details.open : null, text: document.body.innerText.length, panel };
    }, t.selector);
    const before = await state();
    if (!before) continue;
    // What can be focused before opening, so what the control reveals can be told apart afterwards.
    await page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (window.__wr.focusable(el) && window.__wr.visible(el)) el.setAttribute('data-wr-vis', ''); }));
    await page.evaluate((sel) => document.querySelector(sel)?.focus(), t.selector);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    let after = await state();
    if (after && !t.native && after.aria === before.aria && Math.abs(after.text - before.text) < 20) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(250);
      after = await state();
    }
    if (!after) continue;
    const toggledNative = t.native && after.open !== before.open;
    const toggledAria = !t.native && after.aria !== before.aria;
    const contentChanged = before.panel != null && after.panel != null ? before.panel !== after.panel : Math.abs(after.text - before.text) >= 20;
    // Already open, still open and saying so (or closed and saying so): pressing it again changed nothing, which is no
    // failure of its state or of the keyboard.
    const consistent = before.panel != null && after.panel === before.panel && (before.aria === 'true') === (before.panel === 'shown');
    if (toggledNative || toggledAria) {
      opened.push(t.text || t.tag);
      // 2.4.3 (F85): the next Tab after opening goes into what was opened, not somewhere else on the page.
      const order = await page.evaluate((sel) => {
        // What it opened: inside the part its markup names, when it names one. A slider arrow elsewhere that became
        // focusable at the same moment is not what the control revealed.
        const el0 = document.querySelector(sel);
        const ref = el0?.getAttribute('aria-controls') || el0?.getAttribute('data-bs-target') || el0?.getAttribute('data-target') || '';
        let panel = null;
        try { panel = ref ? document.querySelector(ref.startsWith('#') || ref.startsWith('.') ? ref : `#${ref}`) : null; } catch { panel = null; }
        const fresh = [...document.querySelectorAll('*')].filter((el) => !el.hasAttribute('data-wr-vis') && window.__wr.focusable(el) && el.tabIndex >= 0 && window.__wr.visible(el) && (!panel || panel.contains(el)));
        fresh.forEach((el) => el.setAttribute('data-wr-fresh', ''));
        const inFresh = () => fresh.some((el) => el === document.activeElement || el.contains(document.activeElement));
        return { fresh: fresh.length, first: fresh[0] ? window.__wr.text(fresh[0], 40) : null, focusInside: inFresh() };
      }, t.selector);
      if (order.fresh && !order.focusInside) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
        const next = await page.evaluate(() => {
          const a = document.activeElement;
          const fresh = Boolean(a && a !== document.body && a.closest('[data-wr-fresh]'));
          return { fresh, text: a && a !== document.body ? window.__wr.text(a, 40) : null };
        });
        if (!next.fresh) {
          out.push(signal(base, { check: 'toggle-focus-order', sc: ['2.4.3'], status: 'fail', selector: t.selector, html: t.html, bbox: t.bbox, description: `After "${t.text || t.tag}" is opened with the keyboard, the next Tab goes to ${next.text ? `"${next.text}"` : 'another part of the page'} instead of the ${order.fresh} item(s) it opened (first: "${order.first}"), so keyboard users have to search the page for them.`, measured: { opened: order.fresh, nextStop: next.text }, barrier: 'major', trust: 'confirmed', expected: 'What a control opens comes right after it in the keyboard order.', steps: STEPS.toggles }));
        } else orderOk.push(t.text || t.tag);
      } else if (order.fresh) orderOk.push(t.text || t.tag);
    } else if (contentChanged && !t.native) {
      // The state is wrong only when it disagrees with what is shown: "false" (or none) while content opened, "true"
      // while it closed. A control already open that stays "true" and keeps its content open says the right thing
      // (pressing it again may switch a panel, not close it).
      const grew = before.panel != null && after.panel != null ? after.panel === 'shown' : after.text > before.text;
      const wrong = before.aria == null || (before.aria === 'false' && grew) || (before.aria === 'true' && !grew);
      if (wrong) {
        const said = before.aria == null ? 'it has no aria-expanded value' : `its aria-expanded value stays "${before.aria}"`;
        out.push(signal(base, { check: 'toggle-state', sc: ['4.1.2'], status: 'fail', selector: t.selector, html: t.html, bbox: t.bbox, description: `"${t.text}" ${grew ? 'opens' : 'closes'} its content with the keyboard, but ${said}, so screen readers announce the wrong state.`, measured: { ariaBefore: before.aria, ariaAfter: after.aria, opened: grew }, barrier: 'major', trust: 'confirmed', expected: 'A control tells assistive technology whether it is open or closed, and the value changes when it changes.', steps: STEPS.toggles }));
      } else opened.push(t.text || t.tag);
    } else if (consistent) {
      opened.push(t.text || t.tag);
    } else {
      out.push(signal(base, { check: 'toggle-keyboard', sc: ['2.1.1'], status: 'fail', selector: t.selector, html: t.html, bbox: t.bbox, description: `"${t.text || t.tag}" does not open with Enter or Space, so keyboard users cannot reach what it reveals.`, barrier: 'major', trust: 'confirmed', expected: 'Everything that works with a mouse also works with a keyboard.', steps: STEPS.toggles }));
    }
    await page.keyboard.press('Escape');
    if (toggledNative || toggledAria) { await page.evaluate((sel) => document.querySelector(sel)?.focus(), t.selector); await page.keyboard.press('Enter'); }
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelectorAll('[data-wr-vis],[data-wr-fresh]').forEach((el) => { el.removeAttribute('data-wr-vis'); el.removeAttribute('data-wr-fresh'); }));
  }
  if (orderOk.length && !out.some((s) => s.sc.includes('2.4.3'))) {
    out.push(passSignal(base, { check: 'toggle-focus-order', sc: '2.4.3', description: `What ${orderOk.length} control(s) open (${orderOk.slice(0, 4).map((x) => `"${x}"`).join(', ')}) comes next in the keyboard order.`, expected: 'What a control opens comes right after it in the keyboard order.', steps: STEPS.toggles }));
  }
  if (opened.length && !out.some((s) => s.sc.includes('2.1.1'))) {
    out.push(passSignal(base, { check: 'toggle-keyboard', sc: '2.1.1', description: `${opened.length} menu or disclosure control(s) (${opened.slice(0, 4).map((x) => `"${x}"`).join(', ')}) open with the keyboard.`, expected: 'Everything that works with a mouse also works with a keyboard.', steps: STEPS.toggles }));
  }
  if (opened.length && !out.some((s) => s.sc.includes('4.1.2'))) {
    out.push(passSignal(base, { check: 'toggle-state', sc: '4.1.2', description: `${opened.length} menu or disclosure control(s) report their open or closed state, and it changes when they are opened.`, expected: 'A control tells assistive technology whether it is open or closed, and the value changes when it changes.', steps: STEPS.toggles }));
  }
  return out;
}

const GESTURE_SEL = '[draggable=true],[role=slider],[class*=drag i],[class*=sortable i],[class*=swipe i],[class*=slider i],[class*=carousel i],[class*=swiper i],[class*=slick i],[class*=map i],canvas';
const DRAG = /^(dragstart|drag|drop)$/;
const MOVE = /^(touchmove|pointermove|mousemove)$/;

async function gestures(page, cdp, env, base) {
  const roots = { window: await listenerTypes(cdp, 'window'), document: await listenerTypes(cdp, 'document'), body: await listenerTypes(cdp, 'document.body') };
  const n = await page.evaluate((sel) => {
    let i = 0;
    for (const el of document.querySelectorAll(sel)) {
      if (i >= 15) break;
      if (!window.__wr.visible(el)) continue;
      el.setAttribute('data-wr-gest', String(i++));
    }
    return i;
  }, GESTURE_SEL);
  const elements = [];
  for (let i = 0; i < n; i++) {
    const types = await listenerTypes(cdp, `document.querySelector('[data-wr-gest="${i}"]')`);
    const info = await page.evaluate((idx) => {
      const el = document.querySelector(`[data-wr-gest="${idx}"]`);
      const buttons = [...el.querySelectorAll('button,[role=button],a[href]'), ...(el.parentElement ? el.parentElement.querySelectorAll(':scope > button, :scope > [role=button]') : [])].filter((b) => window.__wr.visible(b)).map((b) => window.__wr.name(b, 40)).slice(0, 8);
      return { ...window.__wr.describe(el), draggable: el.getAttribute('draggable') === 'true', role: el.getAttribute('role'), buttons };
    }, i);
    elements.push({ ...info, listeners: types });
  }
  await page.evaluate(() => document.querySelectorAll('[data-wr-gest]').forEach((e) => e.removeAttribute('data-wr-gest')));
  const all = [...roots.window, ...roots.document, ...roots.body];
  const motion = all.filter((t) => /^device(motion|orientation)/.test(t));
  const dragEls = elements.filter((e) => e.draggable || e.role === 'slider' || e.listeners.some((t) => DRAG.test(t)) || (e.listeners.some((t) => MOVE.test(t)) && e.listeners.some((t) => /down|start/.test(t))));
  const rootMoves = all.some((t) => MOVE.test(t) || DRAG.test(t) || /^touch/.test(t));
  const gestureEls = elements.filter((e) => e.listeners.some((t) => /^touch|^pointer|^gesture/.test(t)));
  writeArtifact(env, 'input-listeners.json', { note: 'Listeners for device motion, gestures and dragging, for the 2.5.1, 2.5.4 and 2.5.7 decisions.', roots, elements, motion, dragging: dragEls.map((e) => e.selector), gestures: gestureEls.map((e) => e.selector) });
  const out = [];
  if (!motion.length) out.push(signal(base, { check: 'input-listeners', sc: ['2.5.4'], status: 'not_applicable', description: 'No script on the page listens to device motion or orientation, so nothing is operated by shaking or tilting.', steps: STEPS.gestures }));
  if (!dragEls.length && !rootMoves) out.push(signal(base, { check: 'input-listeners', sc: ['2.5.7'], status: 'not_applicable', description: 'Nothing on the page listens for dragging (no draggable elements, sliders or drag handlers).', steps: STEPS.gestures }));
  if (!gestureEls.length && !rootMoves && !all.some((t) => /^gesture/.test(t))) out.push(signal(base, { check: 'input-listeners', sc: ['2.5.1'], status: 'not_applicable', description: 'Nothing on the page listens for touch or pointer gestures, so no feature needs a swipe, pinch or path.', steps: STEPS.gestures }));
  return out;
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const signals = [];
  const notes = [];
  const steps = Object.values(STEPS).flat();
  for (const part of ['bypass', 'focus', 'keys', 'pointer', 'toggles', 'gestures']) {
    // Each part gets a fresh page, so one interaction cannot leave state that changes the next result.
    const { context, page, blocked } = await openPage(env, { viewport: DESKTOP });
    try {
      const cdp = await context.newCDPSession(page);
      if (part === 'bypass') signals.push(await bypass(page, base));
      if (part === 'focus') signals.push(await onFocus(page, context, base, blocked));
      if (part === 'keys') signals.push(await shortcuts(page, cdp, base));
      if (part === 'pointer') signals.push(await pointer(page, cdp, base, blocked));
      if (part === 'toggles') signals.push(...await toggles(page, base));
      if (part === 'gestures') signals.push(...await gestures(page, cdp, env, base));
    } catch (e) {
      notes.push(`${part}: ${String(e.message).split('\n')[0]}`);
    } finally {
      await context.close();
    }
  }
  return { ran: signals.length > 0, reason: signals.length ? null : 'No interaction could be tested.', environment: environment(null, DESKTOP), steps, signals: signals.filter(Boolean), artifacts: [], notes: notes.join('; ') || null };
}
