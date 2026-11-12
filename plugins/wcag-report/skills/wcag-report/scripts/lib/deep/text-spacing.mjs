// 1.4.12 Text Spacing: with line height 1.5, paragraph spacing 2×, letter spacing 0.12× and word spacing 0.16× of
// the font size (the user style sheet the criterion describes), no text may be cut off.
import { openPage, signal, passSignal, environment, writeArtifact, DESKTOP } from './common.mjs';
import { markClipCandidates, newlyClipped, clearMarks, elementShot } from './layout.mjs';

export const check = 'text-spacing';

export const SPACING_CSS = '*:not(svg):not(svg *){line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p{margin-bottom:2em!important}';

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900).',
    'Apply the text spacing from the WCAG requirement: line height 1.5, space after paragraphs 2 times the font size, letter spacing 0.12 and word spacing 0.16 times the font size.',
    'Find text that the larger spacing pushes out of its box, where the box cuts it off.',
  ];
  const expected = 'When people increase line, paragraph, letter and word spacing, no text or control is cut off.';
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    const baseline = await markClipCandidates(page);
    await page.addStyleTag({ content: SPACING_CSS }).catch(() => page.evaluate((css) => { const s = document.createElement('style'); s.textContent = css; document.head.append(s); }, SPACING_CSS));
    await page.waitForTimeout(250);
    const clipped = await newlyClipped(page, baseline, { minPx: 4 });
    const signals = [];
    const artifacts = [];
    for (const [i, c] of clipped.slice(0, 5).entries()) {
      const buf = await elementShot(page, env.img, c.selector);
      const evidence = buf ? [writeArtifact(env, `spacing-${i + 1}.jpg`, buf)] : [];
      artifacts.push(...evidence);
      signals.push(signal(base, {
        check, sc: ['1.4.12'], status: 'fail', state: 'spacing', selector: c.selector, html: c.html, bbox: c.bbox,
        description: `With increased text spacing, the text "${c.text.slice(0, 60)}" no longer fits its box and ${c.lostY >= c.lostX ? `${c.lostY} pixels of it are cut off at the bottom` : `${c.lostX} pixels of it are cut off at the side`}.`,
        measured: { lostPxVertical: c.lostY, lostPxHorizontal: c.lostX }, barrier: 'major', trust: 'confirmed', evidence, expected, steps,
      }));
    }
    if (!signals.length) {
      signals.push(passSignal(base, { check, sc: '1.4.12', state: 'spacing', description: `With increased text spacing, none of the ${Object.keys(baseline).length} boxes that can cut off text did so.`, expected, steps }));
    }
    await clearMarks(page);
    return { ran: true, environment: environment(null, DESKTOP), steps, signals, artifacts };
  } finally {
    await context.close();
  }
}
