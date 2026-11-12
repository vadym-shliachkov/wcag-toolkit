// 2.1.1 Keyboard, 2.1.2 No Keyboard Trap, 2.4.3 Focus Order — and the Tab trace that focus-visible and
// focus-obscured reuse (stored in env.shared.trace and keyboard-trace.json).
import { openPage, signal, passSignal, environment, writeArtifact, capByKind, DESKTOP } from './common.mjs';

export const check = 'keyboard';

const EXIT_NAME = /close|dismiss|cancel|done|back|×|✕|accept|reject|agree|decline|ok\b|got it|закрыть|отмена|закрити|schließen/i;
const PRIMARY = /add to (cart|bag|basket)|buy|checkout|submit|send|search|log ?in|sign ?in|sign ?up|register|menu|next|continue|order|book/i;

async function active(page) {
  return page.evaluate(() => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    if (!a || a === document.body || a === document.documentElement) return { body: true };
    // Focus inside a same-origin frame (an embedded form) is followed into it: every field is its own stop, and the
    // frame element is not mistaken for one control that keeps the focus.
    let prefix = '';
    let outer = null;
    let dx = 0;
    let dy = 0;
    while (a && a.localName === 'iframe') {
      let doc = null;
      try { doc = a.contentDocument; } catch { /* another site's frame */ }
      const inner = doc?.activeElement;
      if (!inner || inner === doc.body || inner === doc.documentElement) break;
      const fr = a.getBoundingClientRect();
      dx += fr.left; dy += fr.top;
      outer = outer ?? a;
      prefix += `${window.__wr.sel(a)} >>> `;
      a = inner;
    }
    // Coverage of a control inside a frame is measured in the page's own coordinates: the frame's position is added,
    // and the frame itself never counts as what covers it.
    const obscuredInFrame = () => {
      const r = a.getBoundingClientRect();
      const pts = [];
      for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
        const x = dx + r.left + Math.min(r.width - 1, Math.max(1, (r.width * i) / 4));
        const y = dy + r.top + Math.min(r.height - 1, Math.max(1, (r.height * j) / 4));
        if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) pts.push([x, y]);
      }
      if (!pts.length) return { inView: false, covered: 0, total: 0, by: null };
      let covered = 0;
      let by = null;
      for (const [x, y] of pts) {
        const top = document.elementFromPoint(x, y);
        if (!top || top === outer || outer.contains(top)) continue;
        const layer = window.__wr.fixedAncestor(top);
        if (layer && !layer.contains(outer)) { covered += 1; by = by || layer; }
      }
      return { inView: true, covered, total: pts.length, by: by ? window.__wr.describe(by) : null };
    };
    const d = window.__wr.describe(a);
    if (prefix) {
      // The helpers build selectors against the main document; inside a frame each control is named by its own id,
      // name and position, so two fields of an embedded form are never taken for the same stop.
      const same = [...a.ownerDocument.querySelectorAll(a.localName)];
      d.selector = `${prefix}${a.localName}${a.id ? `#${a.id}` : ''}${a.getAttribute('name') ? `[name="${a.getAttribute('name')}"]` : ''}:nth-of-type-in-doc(${same.indexOf(a) + 1})`;
    }
    return {
      inFrame: a.localName === 'iframe' || Boolean(prefix),
      ...d,
      tabindex: a.getAttribute('tabindex'),
      focusVisible: a.matches(':focus-visible'),
      inDialog: Boolean(a.closest('[aria-modal=true],dialog[open],[role=dialog],[role=alertdialog]')),
      obscured: prefix ? obscuredInFrame() : window.__wr.obscured(a),
      fixed: Boolean(window.__wr.fixedAncestor(a)),
    };
  });
}

// Put the sequential-focus starting point at the very start (or end) of the document.
async function startAt(page, where) {
  await page.evaluate((w) => {
    document.activeElement?.blur?.();
    const t = document.createElement('span');
    t.tabIndex = -1;
    if (w === 'end') document.body.append(t); else document.body.prepend(t);
    t.focus({ preventScroll: true });
    t.remove();
    if (w !== 'end') scrollTo(0, 0);
  }, where);
}

// Returns the stops in order and, when focus came back to an element without passing through the document, the cycle.
async function walk(page, key, maxStops, onStop, tabbableCount) {
  const stops = [];
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(40);
    const a = await active(page).catch(() => ({ body: true }));
    if (a.body) { if (stops.length) return { stops, wrapped: true, cycle: null }; continue; }
    const firstSeen = stops.findIndex((s) => s.selector === a.selector);
    if (firstSeen === 0 && stops.length >= Math.max(2, tabbableCount * 0.8)) return { stops, wrapped: true, cycle: null };
    // A loop over part of the page: possible trap, settled by the caller.
    if (firstSeen >= 0) return { stops, wrapped: false, cycle: stops.slice(firstSeen) };
    stops.push(a);
    if (onStop) await onStop(a, stops.length - 1);
  }
  return { stops, wrapped: false, cycle: null };
}

// Escape, then Tab and Shift+Tab: can focus get anywhere outside the cycle?
async function canLeave(page, cycle) {
  const inCycle = new Set(cycle.map((s) => s.selector));
  for (const keys of [['Escape', 'Tab'], ['Shift+Tab']]) {
    for (const k of keys) {
      // A frame from another site keeps reporting itself as the focused element while focus moves through its
      // fields: give it enough presses to pass through them.
      const presses = k === 'Escape' ? 1 : cycle.length + 2 + (cycle.some((s) => s.tag === 'iframe') ? 30 : 0);
      for (let i = 0; i < presses; i++) {
        await page.keyboard.press(k);
        await page.waitForTimeout(40);
        const a = await active(page).catch(() => ({ body: true }));
        if (a.body || !inCycle.has(a.selector)) return { left: true, by: k };
      }
    }
  }
  return { left: false };
}

export async function traverse(env, { maxStops } = {}) {
  const { context, page, consent } = await openPage(env, { viewport: DESKTOP });
  try {
    await page.mouse.move(0, 0);
    const tabbableCount = await page.evaluate(() => window.__wr.tabbables().length);
    const limit = maxStops ?? Math.min(150, tabbableCount * 2 + 10);
    const obscuredShots = [];
    let invisibleChecked = 0;
    const onStop = async (a) => {
      // A transparent control (a submenu button kept at opacity 0) can still show focus: its parent draws an outline
      // with :focus-within, or an icon beside it changes. Compare the spot with and without focus; only a stop where
      // nothing on screen changes is focus the visitor cannot see.
      if (a.obscured?.invisible && env.img && invisibleChecked < 12) {
        invisibleChecked += 1;
        try {
          const r = await page.evaluate(() => { const b = document.activeElement.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight }; });
          const x = Math.max(0, Math.floor(r.x - 10));
          const y = Math.max(0, Math.floor(r.y - 10));
          const clip = { x, y, width: Math.min(r.vw, Math.ceil(r.x + r.w + 10)) - x, height: Math.min(r.vh, Math.ceil(r.y + r.h + 10)) - y };
          if (clip.width > 2 && clip.height > 2) {
            const focused = await page.screenshot({ type: 'png', clip });
            await page.evaluate(() => { window.__wrRefocus = document.activeElement; document.activeElement.blur(); });
            await page.waitForTimeout(300);
            const blurred = await page.screenshot({ type: 'png', clip });
            await page.evaluate(() => { window.__wrRefocus?.focus(); window.__wrRefocus = null; });
            await page.waitForTimeout(300);
            const d = await env.img.diff(focused, blurred);
            if (d.changed >= 12) a.obscured.visibleChange = d.changed;
          }
        } catch { /* keep the stop as measured */ }
      }
      if (a.obscured?.inView && a.obscured.covered === a.obscured.total && obscuredShots.length < 5) {
        const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
        a.obscuredShot = writeArtifact(env, `obscured-${obscuredShots.length + 1}.jpg`, buf);
        obscuredShots.push(a.obscuredShot);
      }
    };
    await startAt(page, 'start');
    const forward = await walk(page, 'Tab', limit, onStop, tabbableCount);
    let trap = null;
    if (forward.cycle && forward.cycle.length < tabbableCount) {
      const leave = await canLeave(page, forward.cycle);
      trap = leave.left ? { cycle: forward.cycle, escapedBy: leave.by } : { cycle: forward.cycle };
    }
    let backward = { stops: [] };
    if (!trap || trap.escapedBy) {
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await startAt(page, 'end');
      backward = await walk(page, 'Shift+Tab', limit, onStop, tabbableCount);
    }
    return { tabbableCount, forward: forward.stops, wrapped: forward.wrapped, backward: backward.stops, trap, consent, limit };
  } finally {
    await context.close();
  }
}

// Custom controls that the keyboard reaches (tabindex) and that react to a click, but that tell assistive technology
// nothing about what they are (F59): no role, or a role that means "no role".
async function roleless(env) {
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    const n = await page.evaluate(() => {
      const native = 'a[href],button,input,select,textarea,summary,option,video,audio,iframe,details,area[href]';
      let i = 0;
      for (const el of document.querySelectorAll('body [tabindex]')) {
        if (i >= 60) break;
        if (el.matches(native) || el.tabIndex < 0 || !window.__wr.visible(el)) continue;
        const role = (el.getAttribute('role') || '').trim().toLowerCase();
        if (role && !['presentation', 'none', 'generic'].includes(role)) continue;
        el.setAttribute('data-wr-norole', String(i++));
      }
      return i;
    });
    const cdp = await context.newCDPSession(page);
    const found = [];
    for (let i = 0; i < n; i++) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-wr-norole="${i}"]')` });
      if (!result.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 }).catch(() => ({ listeners: [] }));
      const types = [...new Set(listeners.map((l) => l.type))];
      const info = await page.evaluate((idx) => {
        const el = document.querySelector(`[data-wr-norole="${idx}"]`);
        return { ...window.__wr.describe(el), onclick: el.hasAttribute('onclick'), role: el.getAttribute('role') };
      }, i);
      if (info.onclick || types.some((t) => /^(click|mousedown|mouseup|pointerdown|pointerup)$/.test(t))) found.push({ ...info, types });
    }
    return found;
  } finally {
    await context.close();
  }
}

// Elements that drop keyboard focus as soon as they receive it (F55): focus goes back to the page itself.
async function focusDropped(env) {
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    return await page.evaluate(async () => {
      const out = [];
      for (const el of window.__wr.tabbables().slice(0, 200)) {
        el.focus();
        await new Promise((r) => setTimeout(r, 30));
        if (document.activeElement === document.body || document.activeElement === null) out.push(window.__wr.describe(el));
        if (out.length >= 5) break;
      }
      return out;
    });
  } finally {
    await context.close();
  }
}

// Elements that react to a click but cannot be reached with Tab. Listeners are read through the DevTools protocol;
// pointer-cursor elements without their own listener are only "to check" (frameworks often delegate events).
async function unreachable(env) {
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    const n = await page.evaluate(() => {
      const skip = 'a[href],button,input,select,textarea,label,summary,option,video,audio,iframe,[tabindex],[contenteditable]';
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (out.length >= 250) break;
        if (el.matches(skip) || el.closest('a[href],button,label,summary,[tabindex]:not([tabindex="-1"])')) continue;
        if (!window.__wr.visible(el)) continue;
        const pointer = getComputedStyle(el).cursor === 'pointer' && getComputedStyle(el.parentElement || el).cursor !== 'pointer';
        if (!pointer && !el.hasAttribute('onclick')) continue;
        if ([...el.querySelectorAll('*')].some((d) => window.__wr.focusable(d))) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 6 || r.height < 6 || r.width > 600 || r.height > 300) continue;
        el.setAttribute('data-wr-cand', String(out.length));
        out.push(1);
      }
      return out.length;
    });
    const cdp = await context.newCDPSession(page);
    const found = [];
    for (let i = 0; i < n; i++) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[data-wr-cand="${i}"]')` });
      if (!result.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId, depth: 0 }).catch(() => ({ listeners: [] }));
      const types = [...new Set(listeners.map((l) => l.type))];
      const info = await page.evaluate((idx) => {
        const el = document.querySelector(`[data-wr-cand="${idx}"]`);
        return { ...window.__wr.describe(el), onclick: el.hasAttribute('onclick'), role: el.getAttribute('role') };
      }, i);
      const clicky = info.onclick || types.some((t) => /^(click|mousedown|mouseup|pointerdown|pointerup|touchstart|touchend)$/.test(t));
      const keys = types.some((t) => /^key(down|up|press)$/.test(t));
      found.push({ ...info, types, confirmed: clicky && !keys });
    }
    await page.evaluate(() => document.querySelectorAll('[data-wr-cand]').forEach((e) => e.removeAttribute('data-wr-cand')));
    return found;
  } finally {
    await context.close();
  }
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900) and close any cookie banner.',
    'Press Tab repeatedly from the top of the page and record every element that receives keyboard focus.',
    'When focus loops inside one part of the page, try Escape, Tab and Shift+Tab to leave it.',
    'Press Shift+Tab from the end of the page back to the start.',
    'List elements that react to a mouse click but are never reached with the keyboard.',
    'List elements reached with Tab that react to a click but have no role.',
    'Focus each keyboard-reachable element and check that it keeps the focus.',
  ];
  const trace = await traverse(env);
  env.shared.trace = trace;
  const artifact = writeArtifact(env, 'keyboard-trace.json', {
    tabbableCount: trace.tabbableCount, wrapped: trace.wrapped, consent: trace.consent,
    forward: trace.forward.map(({ selector, name, bbox, focusVisible, tabindex }) => ({ selector, name, bbox, focusVisible, tabindex })),
    backward: trace.backward.map(({ selector, name }) => ({ selector, name })),
    trap: trace.trap ? { escapedBy: trace.trap.escapedBy ?? null, cycle: trace.trap.cycle.map((s) => s.selector) } : null,
  });
  const signals = [];

  // 2.1.2 — a loop the keyboard cannot leave. A modal dialog may hold focus if it offers a way out.
  if (trace.trap && !trace.trap.escapedBy) {
    const cycle = trace.trap.cycle;
    const exit = cycle.find((s) => EXIT_NAME.test(s.name || ''));
    const first = cycle[0];
    if (exit && cycle.some((s) => s.inDialog)) {
      signals.push(passSignal(base, { check: 'keyboard-trap', sc: '2.1.2', description: `Keyboard focus stays inside a dialog, which can be left with its "${exit.name}" control.`, expected: 'Keyboard focus can always be moved away from any part of the page.', steps, evidence: [artifact] }));
    } else {
      signals.push(signal(base, {
        check: 'keyboard-trap', sc: ['2.1.2'], status: 'fail', selector: first.selector, html: first.html, bbox: first.bbox,
        description: `Keyboard focus loops between ${cycle.length} element(s) (${cycle.slice(0, 3).map((s) => `"${s.name || s.tag}"`).join(', ')}) and Tab, Shift+Tab and Escape cannot move it anywhere else.`,
        measured: { cycle: cycle.map((s) => s.selector), cycleLength: cycle.length, tabbableCount: trace.tabbableCount },
        barrier: 'blocker', trust: 'confirmed', evidence: [artifact],
        expected: 'If the keyboard can move into part of a page, it can also move out of it with standard keys.', steps,
      }));
    }
  } else {
    signals.push(passSignal(base, { check: 'keyboard-trap', sc: '2.1.2', description: `Tab moved through ${trace.forward.length} elements${trace.wrapped ? ' and back to the start of the page' : ''} without getting stuck.`, expected: 'Keyboard focus can always be moved away from any part of the page.', steps, evidence: [artifact] }));
  }

  // 2.1.1 — clickable but not keyboard-reachable.
  const cands = await unreachable(env);
  const confirmed = capByKind(cands.filter((c) => c.confirmed), 3, 15);
  const suspect = capByKind(cands.filter((c) => !c.confirmed), 2, 8);
  for (const c of confirmed) {
    signals.push(signal(base, {
      check: 'keyboard-unreachable', sc: c.role ? ['2.1.1'] : ['2.1.1', '4.1.2'], status: 'fail', selector: c.selector, html: c.html, bbox: c.bbox,
      description: `The ${c.tag} element${c.name ? ` "${c.name}"` : ''} reacts to a mouse click but cannot be reached or used with the keyboard${c.role ? '' : ', and nothing tells assistive technology that it is a control'}.`,
      measured: { listeners: c.types, onclickAttribute: c.onclick },
      barrier: PRIMARY.test(c.name || '') ? 'blocker' : 'major', trust: 'confirmed', evidence: [artifact],
      expected: 'Everything that works with a mouse also works with a keyboard.', steps,
    }));
  }
  for (const c of suspect) {
    signals.push(signal(base, {
      check: 'keyboard-unreachable', sc: ['2.1.1'], status: 'needs_review', selector: c.selector, html: c.html, bbox: c.bbox,
      description: `The ${c.tag} element${c.name ? ` "${c.name}"` : ''} looks clickable (pointer cursor) but cannot be reached with the keyboard.`,
      question: 'Does clicking this element do something? If so, it cannot be done with a keyboard.',
      barrier: 'major', trust: 'review', evidence: [artifact],
      expected: 'Everything that works with a mouse also works with a keyboard.', steps,
    }));
  }
  if (!confirmed.length) {
    signals.push(passSignal(base, { check: 'keyboard-unreachable', sc: '2.1.1', description: `No element with its own click handler was found outside the ${trace.tabbableCount} keyboard-reachable elements.`, expected: 'Everything that works with a mouse also works with a keyboard.', steps, evidence: [artifact] }));
  }

  // 4.1.2 — a custom control without a role (F59).
  const noRole = capByKind(await roleless(env), 2, 10);
  for (const c of noRole) {
    signals.push(signal(base, {
      check: 'custom-control-role', sc: ['4.1.2'], status: 'fail', selector: c.selector, html: c.html, bbox: c.bbox,
      description: `The ${c.tag} element${c.name ? ` "${c.name}"` : ''} works as a control (it reacts to a click and can be reached with Tab) but has no role, so screen readers do not say what it is or that it can be used.`,
      measured: { listeners: c.types, role: c.role },
      barrier: 'major', trust: 'confirmed', evidence: [artifact],
      expected: 'A control tells assistive technology what it is: a native button or link, or a role such as role="button".', steps,
    }));
  }
  if (!noRole.length) {
    signals.push(passSignal(base, { check: 'custom-control-role', sc: '4.1.2', description: 'Every element reached with Tab that reacts to a click is a native control or has a role.', expected: 'A control tells assistive technology what it is.', steps, evidence: [artifact] }));
  }

  // 2.1.1 / 2.4.7 — focus taken away by script as soon as it arrives (F55).
  const dropped = await focusDropped(env);
  for (const c of dropped.slice(0, 3)) {
    signals.push(signal(base, {
      check: 'focus-dropped', sc: ['2.1.1', '2.4.7'], status: 'fail', selector: c.selector, html: c.html, bbox: c.bbox,
      description: `When the ${c.tag} element${c.name ? ` "${c.name}"` : ''} receives keyboard focus, a script removes it again, so keyboard users cannot use it and lose their place.`,
      barrier: 'major', trust: 'confirmed', evidence: [artifact],
      expected: 'An element keeps keyboard focus until the visitor moves it.', steps,
    }));
  }
  if (!dropped.length && trace.tabbableCount) {
    signals.push(passSignal(base, { check: 'focus-dropped', sc: '2.1.1', description: `All ${Math.min(200, trace.tabbableCount)} keyboard-reachable elements keep focus when they receive it.`, expected: 'An element keeps keyboard focus until the visitor moves it.', steps, evidence: [artifact] }));
  }

  // 2.4.3 — order. Positive tabindex and large backward jumps are only signals for a person to judge.
  const positive = trace.forward.filter((s) => Number(s.tabindex) > 0);
  const jumps = [];
  for (let i = 1; i < trace.forward.length; i++) {
    const a = trace.forward[i - 1];
    const b = trace.forward[i];
    if (a.fixed || b.fixed || !a.bbox || !b.bbox) continue;
    if (b.bbox.y < a.bbox.y - 400) jumps.push({ from: a, to: b });
  }
  if (positive.length) {
    const s = positive[0];
    signals.push(signal(base, {
      check: 'focus-order', sc: ['2.4.3'], status: 'needs_review', selector: s.selector, html: s.html, bbox: s.bbox,
      description: `${positive.length} element(s) set their own place in the keyboard order (positive tabindex), for example "${s.name || s.tag}".`,
      question: 'Does moving through the page with Tab still follow the order a reader expects?',
      measured: { positiveTabindex: positive.map((p) => p.selector).slice(0, 10) }, barrier: 'major', evidence: [artifact],
      expected: 'The keyboard moves through the page in an order that keeps its meaning and use.', steps,
    }));
  }
  if (jumps.length >= 2) {
    const j = jumps[0];
    signals.push(signal(base, {
      check: 'focus-order', sc: ['2.4.3'], status: 'needs_review', selector: j.to.selector, html: j.to.html, bbox: j.to.bbox,
      description: `Keyboard focus jumps back up the page ${jumps.length} times, for example from "${j.from.name || j.from.tag}" to "${j.to.name || j.to.tag}".`,
      question: 'Is the order in which the keyboard moves through the page still logical?',
      measured: { jumps: jumps.slice(0, 5).map((x) => [x.from.selector, x.to.selector]) }, barrier: 'minor', evidence: [artifact],
      expected: 'The keyboard moves through the page in an order that keeps its meaning and use.', steps,
    }));
  }
  if (!positive.length && jumps.length < 2 && trace.forward.length) {
    signals.push(passSignal(base, { check: 'focus-order', sc: '2.4.3', description: `The keyboard moved through ${trace.forward.length} elements from top to bottom without unexpected jumps.`, expected: 'The keyboard moves through the page in an order that keeps its meaning and use.', steps, evidence: [artifact] }));
  }

  return { ran: true, environment: environment(null, DESKTOP), steps, signals, artifacts: [artifact], notes: `consent: ${trace.consent}; ${trace.forward.length} forward stops, ${trace.backward.length} backward stops` };
}
