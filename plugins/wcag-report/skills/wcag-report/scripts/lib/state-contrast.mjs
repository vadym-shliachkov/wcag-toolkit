// 1.4.3 in the states a visitor puts text in: the pointer over a card, keyboard focus inside it. The automated pass and
// the pixel measurements see the page at rest, so a card that turns dark under the pointer while its text stays mid-grey
// was never measured.
//
// The page's own style sheets say which elements change colour in such a state: every rule with :hover, :focus,
// :focus-visible or :focus-within that sets a colour, a background, opacity or a custom property. Each element those
// rules style is put in that state the way a visitor would reach it (the pointer: :hover forced on it and every element
// around it, as a pointer resting on it hovers them all; the keyboard: Tab focus on it or on the first control inside
// it), with transitions switched off so what is measured is where a 1 s fade ends, not a frame of it. The automated
// contrast rule then runs on that part of the page, and only text it fails there while it passed at rest is kept.
// Each one is measured against the pixels behind it in the same state; a failure the pixels overturn is dropped.
//
// A state no visitor can reach is never tested: focus states need something the keyboard can reach inside, rules
// inside media queries that do not apply to a desktop mouse (print, touch-only) are skipped, and :not(:hover) styles
// the resting state.
import { axeSource } from './deps.mjs';
import { signal, passSignal, writeArtifact } from './deep/common.mjs';
import { measureContrast, HIDE } from './measure.mjs';

export const STEPS = [
  'Load the page in a desktop window (1280 × 900) with a mouse, and switch off transitions so each state shows its final colours.',
  'From the page\'s style sheets, list the elements whose colours change when the pointer is over them or keyboard focus is on or inside them.',
  'Put each one in that state (pointer over it; Tab to it or to the control inside it) and run the contrast check on it.',
  'Keep text that fails only in that state, and confirm it against the pixels behind the text in the same state.',
];
const EXPECTED = 'Text keeps at least 4.5:1 contrast (3:1 for large text) in every state a visitor puts it in, including when the pointer is over it or keyboard focus is on it.';

// In the page: the elements whose colours a state rule changes, kept on window.__wrStates for the later steps (data-*
// markers would leak into the contrast rule's selectors).
function collect({ cap, perRule }) {
  const STATE = /:(hover|focus-within|focus-visible|focus)(?![\w-])/;
  const STATE_G = /:(hover|focus-within|focus-visible|focus)(?![\w-])/g;
  const PSEUDO_EL = /::[\w-]+(\([^)]*\))?|:(before|after|first-line|first-letter)(?![\w-])/g;
  // What can change how text reads: its colour, what is behind it, how see-through it is, whether it shows at all.
  const PROPS = /^(color|background(-color|-image)?|-webkit-text-fill-color|opacity|filter|mix-blend-mode|visibility|display|--.+)$/;
  const BG = /^background/;
  // Split at a top-level character (commas between selectors), ignoring those inside (), [] and quotes.
  const splitTop = (s) => {
    const out = [];
    let depth = 0; let quote = null; let start = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
    }
    out.push(s.slice(start).trim());
    return out.filter(Boolean);
  };
  // The compound selectors of one complex selector and the combinator after each.
  const compounds = (s) => {
    const out = [];
    let depth = 0; let quote = null; let cur = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) { if (c === quote) quote = null; continue; }
      if (c === '\\') { if (!cur) cur = { start: i, end: i, next: null }; i++; cur.end = i + 1; continue; }
      if (depth === 0 && /[\s>+~]/.test(c)) {
        if (cur) { out.push(cur); cur = null; }
        if (out.length && c !== ' ' && c !== '\n' && c !== '\t') out.at(-1).next = c;
        else if (out.length && !out.at(-1).next) out.at(-1).next = ' ';
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (!cur) cur = { start: i, end: i, next: null };
      cur.end = i + 1;
    }
    if (cur) out.push(cur);
    return out;
  };
  // ".grid .card:hover .card__text" → the element to put in the state (".grid .card"), which states, and whether the
  // styled text is inside it or next to it ("+", "~").
  const subjectOf = (sel) => {
    const parts = compounds(sel);
    let k = -1;
    for (let i = 0; i < parts.length; i++) if (STATE.test(sel.slice(parts[i].start, parts[i].end))) k = i;
    if (k < 0) return null;
    const own = sel.slice(parts[k].start, parts[k].end);
    const prefix = sel.slice(0, parts[k].end);
    const subject = prefix.replace(STATE_G, ':where(*)').replace(PSEUDO_EL, '');
    // A bare ":hover" styles everything under the pointer: no element of its own to test.
    if (!own.replace(STATE_G, '').replace(PSEUDO_EL, '').replace(/^\*$/, '').trim()) return null;
    const kinds = [];
    if (/:hover(?![\w-])/.test(prefix)) kinds.push('hover');
    if (/:focus-within(?![\w-])/.test(prefix)) kinds.push('focus-within');
    else if (/:focus(-visible)?(?![\w-])/.test(prefix)) kinds.push('focus');
    return { subject, kinds, sibling: parts[k].next === '+' || parts[k].next === '~' };
  };
  const rules = [];
  let blocked = 0;
  const sheetRules = (sheet) => { try { return sheet.cssRules ?? []; } catch { blocked += 1; return []; } };
  const applies = (media) => { const t = media?.mediaText ?? ''; try { return !t || matchMedia(t).matches; } catch { return false; } };
  const walk = (list, parent) => {
    for (const r of list) {
      try {
        if (r instanceof CSSImportRule) { if (r.styleSheet && applies(r.media)) walk(sheetRules(r.styleSheet), parent); continue; }
        if (r instanceof CSSMediaRule) { if (applies(r.media)) walk(r.cssRules, parent); continue; }
        if (r instanceof CSSSupportsRule) { if (CSS.supports(r.conditionText)) walk(r.cssRules, parent); continue; }
        if (r instanceof CSSStyleRule) {
          let sel = r.selectorText;
          // A nested rule ("&:hover" inside ".card") is resolved against the rule around it.
          if (parent) sel = splitTop(sel).map((s) => (s.includes('&') ? s.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${s}`)).join(', ');
          if (STATE.test(sel)) {
            const props = [...r.style];
            if (props.some((p) => PROPS.test(p))) rules.push({ sel, bg: props.some((p) => BG.test(p)) });
          }
          if (r.cssRules?.length) walk(r.cssRules, sel);
          continue;
        }
        if (r.cssRules) walk(r.cssRules, parent);
      } catch { /* a rule this browser cannot read */ }
    }
  };
  for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
    if (sheet.disabled || !applies(sheet.media)) continue;
    walk(sheetRules(sheet), null);
  }
  // Rules that change the background first: they are the ones that move text away from its colours.
  rules.sort((a, b) => Number(b.bg) - Number(a.bg));
  const tabbable = (el) => window.__wr.focusable(el) && el.tabIndex >= 0 && window.__wr.visible(el);
  const words = (el) => /[\p{L}\p{N}]/u.test(el?.textContent ?? '');
  const states = [];
  const byEl = new Map();
  const taken = new Map();
  for (const { sel } of rules) {
    for (const one of splitTop(sel)) {
      if (states.length >= cap) break;
      const s = subjectOf(one);
      if (!s) continue;
      let els = [];
      try { els = [...document.querySelectorAll(s.subject)]; } catch { continue; }
      for (const el of els) {
        if (states.length >= cap || (taken.get(s.subject) ?? 0) >= perRule) break;
        if (el === document.documentElement || el === document.body || !window.__wr.visible(el)) continue;
        const ctx = s.sibling ? el.parentElement : el;
        if (!ctx || !words(ctx)) continue;
        let added = false;
        for (const kind of s.kinds) {
          // Keyboard focus reaches the element itself (:focus) or the first control inside it (:focus-within).
          const focusEl = kind === 'hover' ? null : tabbable(el) ? el : kind === 'focus-within' ? [...el.querySelectorAll('*')].find(tabbable) ?? null : null;
          if (kind !== 'hover' && !focusEl) continue;
          const state = kind === 'hover' ? 'hover' : 'keyboard-focus';
          // One test per element and state; a second rule that styles the text next to it widens what is checked.
          const had = byEl.get(el) ?? {};
          if (had[state]) { if (ctx !== el && had[state].ctx === el) had[state].ctx = ctx; continue; }
          const chain = [];
          for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
          had[state] = { el, ctx, state, focusEl, chain, rule: one.slice(0, 200) };
          byEl.set(el, had);
          states.push(had[state]);
          added = true;
        }
        if (added) taken.set(s.subject, (taken.get(s.subject) ?? 0) + 1);
      }
    }
  }
  window.__wrStates = states;
  return {
    rules: rules.length,
    blocked,
    states: states.map((x, i) => ({ i, state: x.state, chain: x.chain.length, rule: x.rule, own: x.ctx === x.el, ...window.__wr.describe(x.el) })),
  };
}

// The contrast rule on one state's part of the page: its failures (with the colours it worked out) and what it could
// not decide.
const axeOn = (page, i) => page.evaluate(async (k) => {
  const r = await window.axe.run(window.__wrStates[k].ctx, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations', 'incomplete'] });
  const nodes = (id) => (r[id] ?? []).flatMap((v) => v.nodes).map((n) => {
    const target = n.target.flat().join(' ');
    let el = null;
    try { el = document.querySelector(target); } catch { /* frame or shadow target */ }
    const d = [...(n.any ?? []), ...(n.all ?? []), ...(n.none ?? [])].find((c) => c.data && (c.data.contrastRatio != null || c.data.fgColor))?.data ?? {};
    return { target, html: n.html.slice(0, 400), summary: n.failureSummary ?? '', data: d, bbox: el ? window.__wr.box(el) : null, text: el ? window.__wr.text(el, 60) : '' };
  });
  return { violations: nodes('violations'), incomplete: nodes('incomplete') };
}, i);

// Transitions are off; animations a state starts (a keyframe fade) are run to their end.
const settleState = (page) => page.evaluate(() => {
  for (const a of document.getAnimations()) {
    try {
      const t = a.effect?.getComputedTiming?.();
      if (a.playState === 'running' && t && Number.isFinite(t.endTime)) a.finish();
    } catch { /* an animation that cannot finish */ }
  }
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
});

export async function stateContrast(env, page, { cap = 40, perRule = 4, budgetMs = 90000, maxFails = 12 } = {}) {
  const base = { pageId: env.pageId, url: env.url };
  const deadline = Date.now() + budgetMs;
  await page.addStyleTag({ content: HIDE }).catch(() => {});
  if (!(await page.evaluate(() => Boolean(window.axe)).catch(() => false))) await page.evaluate(axeSource());
  const found = await page.evaluate(collect, { cap, perRule });
  if (!found.states.length) return { tested: 0, rules: found.rules, signals: [] };

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  await cdp.send('DOM.getDocument', { depth: 0 });
  let forced = [];
  const nodeOf = async (expression) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression });
    if (!result?.objectId) return null;
    const { nodeId } = await cdp.send('DOM.requestNode', { objectId: result.objectId });
    return nodeId || null;
  };
  const clear = async () => {
    for (const nodeId of forced) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {});
    forced = [];
    await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
    await settleState(page).catch(() => {});
  };
  const apply = async (s) => {
    if (s.state === 'hover') {
      // A pointer resting on an element is over every element around it too.
      for (let k = 0; k < s.chain; k++) {
        const nodeId = await nodeOf(`window.__wrStates[${s.i}].chain[${k}]`);
        if (!nodeId) continue;
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        forced.push(nodeId);
      }
      await settleState(page);
      return forced.length > 0;
    }
    // Keyboard focus: focus it, step away with Shift+Tab and come back with Tab, so the browser treats it as keyboard
    // focus (:focus-visible) as a visitor pressing Tab gets it.
    const is = () => page.evaluate((k) => document.activeElement === window.__wrStates[k].focusEl, s.i);
    await page.evaluate((k) => window.__wrStates[k].focusEl.focus({ preventScroll: true }), s.i);
    if (!(await is())) return false;
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    if (!(await is())) {
      await page.evaluate((k) => window.__wrStates[k].focusEl.focus({ preventScroll: true }), s.i);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
    }
    await settleState(page);
    return is();
  };

  const confirmed = [];
  const reported = new Set();
  let tested = 0;
  let overturned = 0;
  let stopped = false;
  try {
    for (const s of found.states) {
      if (confirmed.length >= maxFails) break;
      if (Date.now() > deadline) { stopped = true; break; }
      if (!(await apply(s).catch(() => false))) { await clear(); continue; }
      const inState = await axeOn(page, s.i).catch(() => null);
      await clear();
      if (!inState) continue;
      tested += 1;
      if (!inState.violations.length) continue;
      // Only what this state causes: text the rule also fails, or cannot decide, at rest is not this state's problem.
      const atRest = await axeOn(page, s.i).catch(() => null);
      if (!atRest) continue;
      const known = new Set([...atRest.violations, ...atRest.incomplete].map((n) => n.target));
      const fresh = inState.violations.filter((n) => !known.has(n.target) && !reported.has(`${s.state}|${n.target}`));
      if (!fresh.length) continue;
      if (!(await apply(s).catch(() => false))) { await clear(); continue; }
      const kept = [];
      for (const n of fresh.slice(0, 4)) {
        const m = await measureContrast(page, env.img, n.target).catch(() => null);
        if (m?.decorative) continue;
        // The rule works out the background from the CSS under the text; the pixels behind it are what people see.
        if (m && (m.worst >= m.needed || m.halo >= m.needed)) { overturned += 1; continue; }
        reported.add(`${s.state}|${n.target}`);
        kept.push({ n, m });
      }
      let evidence = [];
      if (kept.length && env.outDir) {
        const shot = await page.evaluate(({ k, target }) => {
          const el = window.__wrStates[k].el;
          const r0 = el.getBoundingClientRect();
          const focusOn = r0.height > innerHeight - 40 ? (document.querySelector(target) ?? el) : el;
          focusOn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: innerHeight };
        }, { k: s.i, target: kept[0].n.target }).catch(() => null);
        if (shot) {
          const x = Math.max(0, Math.floor(shot.x - 16));
          const y = Math.max(0, Math.floor(shot.y - 16));
          const clip = { x, y, width: Math.min(shot.vw - x, Math.ceil(shot.w + 32)), height: Math.min(shot.vh - y, Math.ceil(shot.h + 32)) };
          if (clip.width >= 4 && clip.height >= 4) {
            const png = await page.screenshot({ type: 'png', clip }).catch(() => null);
            if (png) {
              const jpg = await env.img.toJpeg(png, { quality: 0.8, maxWidth: 1200 });
              evidence = [writeArtifact(env, `state-contrast-${env.pageId}-${confirmed.length + 1}.jpg`, jpg.buffer)];
            }
          }
        }
      }
      await clear();
      for (const k of kept) confirmed.push({ ...k, s, evidence });
    }
  } finally {
    await clear().catch(() => {});
    await page.evaluate(() => { delete window.__wrStates; }).catch(() => {});
    await cdp.send('CSS.disable').catch(() => {});
    await cdp.send('DOM.disable').catch(() => {});
    await cdp.detach().catch(() => {});
  }

  const signals = [];
  for (const { n, m, s, evidence } of confirmed) {
    const d = n.data ?? {};
    const required = Number(String(d.expectedContrastRatio ?? '').replace(/:1$/, '')) || m?.needed || 4.5;
    const ratio = d.contrastRatio ?? (m ? Number(m.worst.toFixed(2)) : null);
    const where = s.state === 'hover'
      ? (s.own && n.target === s.selector ? 'while the pointer is over it' : `while the pointer is over the ${s.tag} that holds it`)
      : (s.own && n.target === s.selector ? 'while it has keyboard focus' : `while keyboard focus is on the ${s.tag} that holds it or a control inside`);
    const colours = d.fgColor && d.bgColor ? `${d.fgColor} on ${d.bgColor}` : (m ? `${m.color.replace(/\s/g, '')} on its background` : 'its colours');
    signals.push(signal(base, {
      check: 'color-contrast', sc: ['1.4.3'], status: 'fail', state: s.state, selector: n.target, html: n.html, bbox: n.bbox,
      description: `"${(n.text || m?.text || '').slice(0, 60)}" is ${colours} ${where}: ${ratio != null ? `${Number(ratio).toFixed(2)}:1` : 'too little contrast'}, below the ${required}:1 required for text of this size (only in the "${s.state}" state).`,
      measured: {
        ratio, required, fg: d.fgColor ?? null, bg: d.bgColor ?? null, fontSize: d.fontSize ?? null, fontWeight: d.fontWeight ?? null,
        worstContrast: m ? Number(m.worst.toFixed(2)) : null, trigger: s.selector, rule: s.rule, failureSummary: n.summary,
      },
      barrier: (ratio ?? 4.5) < 2 ? 'major' : 'minor', trust: 'confirmed', evidence, expected: EXPECTED, steps: STEPS,
    }));
  }
  if (tested && !signals.length) {
    signals.push(passSignal(base, {
      check: 'state-contrast', sc: '1.4.3',
      description: `${tested} element(s) whose colours change when the pointer is over them or keyboard focus is on them were put in that state; their text keeps the required contrast there${overturned ? ` (${overturned} automated failure(s) were overturned by the pixels behind the text)` : ''}.`,
      expected: EXPECTED, steps: STEPS,
    }));
  }
  return { tested, rules: found.rules, blocked: found.blocked, overturned, stopped, signals };
}
