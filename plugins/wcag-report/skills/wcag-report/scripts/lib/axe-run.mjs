// Running axe-core in a page and slimming its results to the axe/<pid>.json contract.
import { axeSource, requireDep } from './deps.mjs';

export function axeTags(level) {
  const tags = ['wcag2a', 'wcag21a', 'wcag22a'];
  if (level === 'AA' || level === 'AAA') tags.push('wcag2aa', 'wcag21aa', 'wcag22aa');
  if (level === 'AAA') tags.push('wcag2aaa', 'wcag21aaa');
  tags.push('best-practice');
  return tags;
}

export function axeVersion() {
  return requireDep('axe-core/package.json').version;
}

let source = null;

// A lazy iframe may not have started loading (several pages are open at once, none in front): start it and wait until
// every iframe with an address has navigated, so axe does not land in its empty first document.
async function framesLoaded(page, capMs = 6000) {
  const wanted = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('iframe[src^="http"]')];
    frames.forEach((f) => { f.loading = 'eager'; });
    return frames.length;
  }).catch(() => 0);
  const end = Date.now() + capMs;
  while (wanted && Date.now() < end && page.frames().slice(1).filter((f) => /^https?:/.test(f.url())).length < wanted) await page.waitForTimeout(150);
}

// Inject into every frame we can reach; axe's own iframes support then stitches the results together.
async function inject(page) {
  if (!source) source = axeSource();
  await framesLoaded(page);
  for (const frame of page.frames()) {
    try {
      // A frame still loading would swap its document and lose axe.
      await frame.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
      await frame.evaluate(source);
      // By default axe only exchanges results with frames of its own origin, so a form embedded from another domain
      // would go untested while the page reads as clean.
      await frame.evaluate(() => window.axe.configure({ allowedOrigins: ['<unsafe_all_origins>'] }));
    } catch { /* detached frame */ }
  }
}

const HTML_MAX = 400;
const cut = (s, n = HTML_MAX) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? null);

function slimNode(n) {
  const checks = [...(n.any || []), ...(n.all || []), ...(n.none || [])]
    .filter((c) => c && c.data != null)
    .map((c) => ({ id: c.id, data: c.data }));
  const target = n.target.map((t) => (Array.isArray(t) ? t.join(' ') : t));
  return {
    target,
    html: cut(n.html),
    failureSummary: cut(n.failureSummary, 800),
    bbox: null,
    frame: n.target.length > 1 ? target.slice(0, -1).join(' >> ') : null,
    any: checks,
  };
}

function slim(results, cap = 50) {
  return results.map((r) => ({
    id: r.id,
    impact: r.impact,
    tags: r.tags,
    help: r.help,
    nodeCount: r.nodes.length,
    nodes: r.nodes.slice(0, cap).map(slimNode),
  }));
}

// Bounding boxes in document coordinates, measured in the top frame only (frame nodes keep bbox null).
async function measure(page, groups) {
  const sels = [];
  for (const g of groups) for (const r of g) for (const n of r.nodes) if (!n.frame) sels.push(n.target[0]);
  const boxes = await page.evaluate((list) => list.map((s) => {
    let el;
    try { el = document.querySelector(s); } catch { return null; }
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) return null;
    return { x: Math.round(b.left + scrollX), y: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) };
  }), sels).catch(() => sels.map(() => null));
  let i = 0;
  for (const g of groups) for (const r of g) for (const n of r.nodes) if (!n.frame) n.bbox = boxes[i++];
}

export async function runAxe(page, { level = 'AA', pageId, state = 'default' } = {}) {
  await inject(page);
  const viewport = page.viewportSize();
  const once = () => page.evaluate(async (tags) => {
    // eslint-disable-next-line no-undef
    const r = await axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations', 'incomplete'],
      iframes: true,
      elementRef: false,
      performanceTimer: false,
    });
    return {
      violations: r.violations,
      incomplete: r.incomplete,
      passes: r.passes.map((p) => [p.id, p.nodes.length]),
      inapplicable: r.inapplicable.map((p) => p.id),
    };
  }, axeTags(level));
  let raw = await once();
  // A frame that did not answer was not tested: give it time and ask again, once.
  if (raw.incomplete.some((r) => r.id === 'frame-tested')) {
    await page.waitForTimeout(3000);
    await inject(page);
    raw = await once();
  }
  const violations = slim(raw.violations);
  const incomplete = slim(raw.incomplete);
  await measure(page, [violations, incomplete]);
  return {
    pageId,
    url: page.url(),
    state,
    viewport: viewport ? [viewport.width, viewport.height] : null,
    axeVersion: axeVersion(),
    violations,
    incomplete,
    passes: Object.fromEntries(raw.passes),
    inapplicable: raw.inapplicable,
  };
}
