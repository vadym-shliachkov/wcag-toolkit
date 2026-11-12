// 2.4.11 Focus Not Obscured (Minimum), and 2.4.12 (Enhanced) when the profile is AAA: at every keyboard stop of the
// forward and backward Tab trace, is the focused element hidden behind a sticky or fixed layer?
import { signal, passSignal, environment, DESKTOP } from './common.mjs';
import { traverse } from './keyboard.mjs';

export const check = 'focus-obscured';

const CONSENT = /cookie|consent|gdpr|privacy/i;

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900) and close any cookie banner.',
    'Move through the page with Tab and then backwards with Shift+Tab.',
    'At each stop, test whether the focused element is covered by a header, footer, banner or other layer that stays on screen.',
  ];
  const trace = env.shared.trace ?? await traverse(env);
  const all = [...trace.forward, ...trace.backward];
  const stops = all.filter((s) => s.obscured?.inView);
  // Focus that lands on something the visitor cannot see at all (links inside a closed pop-up kept at opacity 0).
  const invisible = all.filter((s) => s.obscured?.invisible && !s.obscured.visibleChange);
  if (!stops.length && !invisible.length) return { ran: false, reason: 'No keyboard stop could be measured.', steps, signals: [], artifacts: [] };
  const seen = new Set();
  const signals = [];
  for (const s of invisible) {
    if (seen.has(s.selector)) continue;
    seen.add(s.selector);
    const label = s.name ? `"${s.name}"` : `the ${s.tag} element`;
    signals.push(signal(base, {
      check, sc: ['2.4.7'], status: 'fail', state: 'focus', selector: s.selector, html: s.html, bbox: s.bbox,
      description: `Tab moves keyboard focus to ${label}, which cannot be seen: it sits in content that is fully transparent (a closed pop-up), so the visitor loses track of where focus is.`,
      measured: { opacity: 0, invisibleFocusStop: true, hiddenIn: s.obscured.hiddenIn?.selector ?? null },
      barrier: 'major', trust: 'confirmed', evidence: [],
      expected: 'Every element that receives keyboard focus is visible, with a visible focus indicator; content that is closed is not in the Tab order.', steps,
    }));
  }
  for (const s of stops) {
    if (seen.has(s.selector)) continue;
    const full = s.obscured.covered === s.obscured.total;
    const part = s.obscured.covered > 0;
    if (!full && !(part && env.level === 'AAA')) continue;
    seen.add(s.selector);
    const by = s.obscured.by;
    const label = s.name ? `"${s.name}"` : `the ${s.tag} element`;
    const layer = by?.landmark === 'banner' ? 'the page header' : by?.landmark === 'contentinfo' ? 'the page footer' : by?.name ? `"${by.name.slice(0, 40)}"` : 'a layer that stays on screen';
    const consentLayer = CONSENT.test(`${by?.selector ?? ''} ${by?.html ?? ''}`);
    const evidence = s.obscuredShot ? [s.obscuredShot] : [];
    if (full) {
      signals.push(signal(base, {
        check, sc: ['2.4.11'], status: consentLayer ? 'needs_review' : 'fail', state: 'focus', selector: s.selector, html: s.html, bbox: s.bbox,
        description: `When ${label} receives keyboard focus it is completely hidden behind ${layer}.`,
        question: consentLayer ? 'The covering layer looks like a cookie banner. Can visitors close it before using the page?' : undefined,
        measured: { coveredPoints: s.obscured.covered, sampledPoints: s.obscured.total, coveredBy: by?.selector ?? null },
        barrier: 'major', trust: consentLayer ? 'review' : 'confirmed', evidence,
        expected: 'An element that receives keyboard focus is not completely hidden by other content.', steps,
      }));
    } else {
      signals.push(signal(base, {
        check, sc: ['2.4.12'], status: 'fail', state: 'focus', selector: s.selector, html: s.html, bbox: s.bbox,
        description: `When ${label} receives keyboard focus, ${layer} covers part of it.`,
        measured: { coveredPoints: s.obscured.covered, sampledPoints: s.obscured.total, coveredBy: by?.selector ?? null },
        barrier: 'minor', trust: 'confirmed', evidence,
        expected: 'No part of an element that receives keyboard focus is hidden by other content.', steps,
      }));
    }
  }
  if (!signals.some((x) => x.sc.includes('2.4.11'))) {
    signals.push(passSignal(base, { check, sc: '2.4.11', state: 'focus', description: `None of the ${new Set(stops.map((s) => s.selector)).size} keyboard stops was completely hidden by another layer.`, expected: 'An element that receives keyboard focus is not completely hidden by other content.', steps }));
  }
  if (env.level === 'AAA' && !signals.some((x) => x.sc.includes('2.4.12'))) {
    signals.push(passSignal(base, { check, sc: '2.4.12', state: 'focus', description: 'No keyboard stop was even partly hidden by another layer.', expected: 'No part of an element that receives keyboard focus is hidden by other content.', steps }));
  }
  return { ran: true, environment: environment(null, DESKTOP), steps, signals, artifacts: stops.map((s) => s.obscuredShot).filter(Boolean) };
}
