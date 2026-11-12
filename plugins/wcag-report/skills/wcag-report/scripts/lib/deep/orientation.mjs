// 1.3.4 Orientation: the page must work in both portrait and landscape unless one orientation is essential.
// A "rotate your device" message, a rotated page or content that only one orientation shows is a lock.
import { openPage, signal, passSignal, environment, writeArtifact } from './common.mjs';

export const check = 'orientation';

const ROTATE_MSG = /rotate (your|the) (device|phone|screen)|turn your (device|phone)|landscape mode|portrait mode|поверните|переверните|поверніть|drehen sie/i;

async function measure(env, viewport) {
  const { context, page } = await openPage(env, { viewport });
  try {
    const m = await page.evaluate((re) => {
      const rx = new RegExp(re, 'i');
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      const rotated = ['html', 'body'].map((t) => getComputedStyle(document.querySelector(t)).transform).find((t) => t && t !== 'none' && /matrix\((-?0(\.0+)?|6\.1\d*e-17), (-?1|1)/.test(t)) || null;
      return { textLength: text.length, message: (text.match(rx) || [null])[0], rotated, sample: text.slice(0, 200) };
    }, ROTATE_MSG.source);
    const shot = (await env.img.toJpeg(await page.screenshot({ type: 'png' }), { quality: 0.72 })).buffer;
    return { ...m, shot };
  } finally {
    await context.close();
  }
}

// Style sheet rules that hide the page or rotate it for one orientation.
async function lockRules(env) {
  const { context, page } = await openPage(env);
  try {
    return await page.evaluate(() => {
      const found = [];
      for (const sheet of [...document.styleSheets]) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of [...(rules || [])]) {
          if (!rule.media || !/orientation\s*:\s*(portrait|landscape)/i.test(rule.media.mediaText)) continue;
          for (const inner of [...rule.cssRules]) {
            const sel = inner.selectorText || '';
            const css = inner.style?.cssText || '';
            if (/^(html|body|main|#app|#root|\.app|\.page|\.wrapper)\b/i.test(sel) && /rotate\((90|-90|270)deg\)|display:\s*none|visibility:\s*hidden/i.test(css)) {
              found.push({ media: rule.media.mediaText, selector: sel, css: css.slice(0, 160) });
            }
          }
        }
      }
      return found;
    });
  } finally {
    await context.close();
  }
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page on a phone-sized screen in portrait (390 × 844) and in landscape (844 × 390).',
    'Compare the content shown in each orientation and look for messages asking to rotate the device.',
    'Read the page\'s style sheets for rules that hide or rotate the page in one orientation.',
  ];
  const expected = 'The page can be used in both portrait and landscape orientation.';
  const portrait = await measure(env, { width: 390, height: 844 });
  const landscape = await measure(env, { width: 844, height: 390 });
  const rules = await lockRules(env);
  const artifacts = [writeArtifact(env, 'orientation-portrait.jpg', portrait.shot), writeArtifact(env, 'orientation-landscape.jpg', landscape.shot)];
  const small = Math.min(portrait.textLength, landscape.textLength);
  const large = Math.max(portrait.textLength, landscape.textLength);
  const which = portrait.textLength < landscape.textLength ? 'portrait' : 'landscape';
  const msg = portrait.message || landscape.message;
  const rotated = portrait.rotated || landscape.rotated;
  const signals = [];
  const measured = { portraitTextLength: portrait.textLength, landscapeTextLength: landscape.textLength, rules: rules.slice(0, 3) };
  if (msg || rotated || (rules.length && large > 200 && small < large * 0.3)) {
    signals.push(signal(base, {
      check, sc: ['1.3.4'], status: 'fail', state: which, viewport: which === 'portrait' ? [390, 844] : [844, 390],
      description: msg ? `In ${which} orientation the page shows "${msg}" instead of its content.` : rotated ? 'The page turns itself sideways in one orientation instead of adapting to it.' : `In ${which} orientation the page hides most of its content (${small} characters instead of ${large}).`,
      measured, barrier: 'blocker', trust: 'confirmed', evidence: artifacts, expected, steps,
    }));
  } else if (rules.length || (large > 200 && small < large * 0.3)) {
    signals.push(signal(base, {
      check, sc: ['1.3.4'], status: 'needs_review', state: which, viewport: which === 'portrait' ? [390, 844] : [844, 390],
      description: rules.length ? `The page's styles change the layout for ${rules[0].media}, hiding or turning part of it.` : `In ${which} orientation much less content is shown (${small} characters instead of ${large}).`,
      question: 'Compare the two screenshots: can everything be read and used in both orientations?',
      measured, barrier: 'major', trust: 'review', evidence: artifacts, expected, steps,
    }));
  } else {
    signals.push(passSignal(base, { check, sc: '1.3.4', description: 'The page shows the same content in portrait and landscape and does not ask visitors to rotate the device.', expected, steps, evidence: artifacts }));
  }
  return { ran: true, environment: environment(null, { width: 390, height: 844 }, { input: 'touch' }), steps, signals, artifacts };
}
