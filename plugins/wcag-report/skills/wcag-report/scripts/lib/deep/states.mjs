// Interactive states: menus, accordions and dialogs hide content that the first automated pass never sees. Open each
// toggle at desktop width and at 320 px, run axe on the open state, and keep only problems that the default state did
// not already show. Also runs axe once at 320 px to catch problems of the mobile layout.
import { openPage, signal, environment, writeArtifact, scFromTags, axeTags, IMPACT_BARRIER, DESKTOP, NARROW, settle } from './common.mjs';
import { axeSource } from '../deps.mjs';
import { ruleInfo } from '../signals.mjs';

export const check = 'states';

async function runAxe(page, level) {
  await page.evaluate(axeSource());
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, tags: v.tags, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => {
      let el = null;
      try { el = document.querySelector(n.target[0]); } catch { /* shadow or frame target */ }
      return { target: n.target, html: n.html.slice(0, 400), failureSummary: n.failureSummary, bbox: el ? window.__wr.box(el) : null };
    }) }));
  }, axeTags(level));
}

const key = (v, n) => `${v.id}|${n.target.join(' ')}`;

function toSignals(base, violations, known, state, viewport, steps, evidence) {
  const out = [];
  for (const v of violations) {
    const sc = scFromTags(v.tags);
    if (!sc.length) continue;
    // The same trust rule as on the page as loaded: a rule the knowledge base does not back (target-size, whose
    // overlap test uses boxes, not the round shape people tap) leaves an item to check, not a failure.
    const info = ruleInfo(v.id, v.tags);
    if (info.bestPractice) continue;
    for (const n of v.nodes) {
      if (known.has(key(v, n))) continue;
      out.push({
        source: 'axe', check: v.id, sc, status: info.trust === 'confirmed' ? 'fail' : 'needs_review', act: info.act, pageId: base.pageId, url: base.url, state, viewport,
        selector: n.target.join(' '), html: n.html, bbox: n.bbox,
        description: `${v.help} (only in the "${state}" state).`, measured: { failureSummary: n.failureSummary },
        barrier: IMPACT_BARRIER[v.impact] ?? 'minor', trust: info.trust, evidence, expected: v.help, steps,
        ...(info.trust === 'confirmed' ? {} : { question: `The automated rule "${v.id}" is not reliable enough on its own here: ${v.help}. Does a person confirm a barrier?` }),
      });
    }
  }
  return out;
}

async function toggles(page) {
  return page.evaluate(() => [...document.querySelectorAll('[aria-expanded=false],[aria-haspopup]:not([aria-haspopup=false]),summary,[data-toggle],[data-bs-toggle]')]
    .filter((el) => window.__wr.visible(el) && !el.closest('a[href]:not([href^="#"])'))
    .slice(0, 5)
    .map((el, i) => { el.setAttribute('data-wr-toggle', String(i)); return { i, ...window.__wr.describe(el) }; }));
}

async function exploreAt(env, viewport, vpLabel, baseKnown, steps) {
  const base = { pageId: env.pageId, url: env.url };
  const vp = [viewport.width, viewport.height];
  const signals = [];
  const artifacts = [];
  const { context, page } = await openPage(env, { viewport });
  try {
    const defaults = await runAxe(page, env.level);
    const known = new Set(baseKnown);
    if (vpLabel === 'w320') signals.push(...toSignals(base, defaults, known, 'w320', vp, steps, []));
    for (const v of defaults) for (const n of v.nodes) known.add(key(v, n));
    for (const t of await toggles(page)) {
      const loc = page.locator(`[data-wr-toggle="${t.i}"]`);
      try { await loc.click({ timeout: 1500 }); } catch { continue; }
      await page.waitForTimeout(450);
      await settle(page, 200);
      const opened = await page.evaluate((i) => {
        const el = document.querySelector(`[data-wr-toggle="${i}"]`);
        return Boolean(el && (el.getAttribute('aria-expanded') === 'true' || el.closest('details')?.open)) || Boolean(document.querySelector('[aria-modal=true],dialog[open]'));
      }, t.i);
      if (!opened) continue;
      const state = `${vpLabel === 'w320' ? 'w320-' : ''}open:${(t.name || t.tag).slice(0, 30)}`;
      const shot = writeArtifact(env, `state-${vpLabel}-${t.i + 1}.jpg`, await page.screenshot({ type: 'jpeg', quality: 70 }));
      const found = toSignals(base, await runAxe(page, env.level), known, state, vp, steps, [shot]);
      if (found.length) artifacts.push(shot);
      signals.push(...found);
      for (const s of found) known.add(`${s.check}|${s.selector}`);
      // Close it again: Escape, then the toggle itself.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      if (await loc.getAttribute('aria-expanded').catch(() => null) === 'true') await loc.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  } finally {
    await context.close();
  }
  return { signals, artifacts };
}

export async function run(env) {
  const steps = [
    'Load the page at desktop width (1280 × 900) and at 320 pixels wide.',
    'Open each menu, accordion or dialog button and run the automated checks again on the open state.',
    'Keep only problems that the closed page did not already show.',
  ];
  // Problems the per-page automated pass already recorded are not repeated.
  const baseKnown = new Set();
  for (const v of env.axeDefault?.violations ?? []) for (const n of v.nodes ?? []) baseKnown.add(key(v, n));
  const desk = await exploreAt(env, DESKTOP, 'desktop', baseKnown, steps);
  const narrow = await exploreAt(env, NARROW, 'w320', baseKnown, steps);
  const signals = [...desk.signals, ...narrow.signals].slice(0, 40);
  return { ran: true, environment: environment(null, DESKTOP, { input: 'mouse' }), steps, signals, artifacts: [...desk.artifacts, ...narrow.artifacts], notes: `${desk.signals.length} new problems in open states at desktop width, ${narrow.signals.length} at 320 px` };
}
