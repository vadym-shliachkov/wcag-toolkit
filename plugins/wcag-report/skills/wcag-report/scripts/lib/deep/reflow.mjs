// 1.4.10 Reflow: at 320 CSS px wide (the same as 400 % zoom on a 1280 px screen), content must fit without
// scrolling sideways and without being cut off. Data tables, maps, diagrams, video and similar 2-D content are
// exempt, so overflow caused only by them is left for a person to judge.
// F102: content shown at desktop width must still be there at 320 px, on screen or behind a control that shows it
// (a menu button, an accordion, a carousel).
import { openPage, signal, passSignal, environment, writeArtifact, NARROW, DESKTOP } from './common.mjs';

export const check = 'reflow';

const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,a[href],button,label,figcaption,blockquote,dt,dd,td,th,summary';
const REVEALABLE = 'header,nav,[role=banner],[role=navigation],details,dialog,[role=dialog],[role=tabpanel],[aria-roledescription*=carousel i],[aria-roledescription*=slide i],[class*=carousel i],[class*=slider i],[class*=swiper i],[class*=slick i],[class*=marquee i],[class*=ticker i]';

// Text blocks a desktop visitor sees, by their normalised text.
async function desktopBlocks(page) {
  return page.evaluate((sel) => {
      const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const out = new Map();
      for (const el of document.querySelectorAll(sel)) {
        if (out.size >= 400) break;
        if (!window.__wr.visible(el) || el.closest('[aria-hidden=true]')) continue;
        const t = norm(el.innerText);
        if (t.length < 12 || t.length > 300 || out.has(t)) continue;
        out.set(t, { tag: el.localName, text: window.__wr.text(el, 100) });
      }
      return [...out.entries()];
  }, BLOCKS);
}

// One page, made narrow and then wide again, as zooming does: content chosen at random or rotated on each load is
// the same throughout, and a block counts as lost only if it comes back when the window is wide again.
async function contentLoss(env) {
  const { context, page } = await openPage(env, { viewport: DESKTOP });
  try {
    const blocks = await desktopBlocks(page);
    if (!blocks.length) return { blocks: 0, lost: [] };
    await page.setViewportSize(NARROW);
    await page.waitForTimeout(700);
    const lost = await lostBlocks(page, blocks);
    if (!lost.length) return { blocks: blocks.length, lost };
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(700);
    const back = await page.evaluate((texts) => {
      const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const shown = norm(document.body.innerText);
      return texts.map((t) => shown.includes(norm(t)));
    }, lost.map((l) => l.text.replace(/…$/, '')));
    return { blocks: blocks.length, lost: lost.filter((_, i) => back[i]) };
  } finally {
    await context.close();
  }
}

// At 320 px: which desktop blocks are neither on screen nor behind a control that reveals them.
async function lostBlocks(page, blocks) {
  return page.evaluate(({ blocks, sel, revealable }) => {
    const norm = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const shown = norm(document.body.innerText);
    // A visible control in the header that opens something (the menu button of a narrow layout).
    const menuButton = [...document.querySelectorAll('header button, header [role=button], [aria-expanded], [aria-controls]')].some((b) => window.__wr.visible(b));
    const controlled = new Set([...document.querySelectorAll('[aria-controls]')].flatMap((b) => (b.getAttribute('aria-controls') || '').split(/\s+/)).filter(Boolean));
    const lost = [];
    for (const [t, info] of blocks) {
      if (shown.includes(t)) continue;
      const el = [...document.querySelectorAll(sel)].find((x) => norm(x.textContent) === t);
      if (el) {
        const holder = el.closest(revealable);
        if (holder && (!holder.matches('header,nav,[role=banner],[role=navigation]') || menuButton)) continue;
        let byControl = false;
        for (let n = el; n && n !== document.body; n = n.parentElement) if (n.id && controlled.has(n.id)) { byControl = true; break; }
        if (byControl) continue;
        // A pause or play button goes with the media it controls: when the narrow layout drops the media too, nothing is lost.
        if (el.matches('button,[role=button]') && /pause|stop|play/.test(t)) {
          const media = [...(el.closest('section,article,aside,figure,[role=region]') || document.body).querySelectorAll('video,audio,canvas')];
          if (media.length && !media.some((m) => window.__wr.visible(m))) continue;
        }
      } else if (menuButton && /^(a|button|li)$/.test(info.tag)) continue; // a menu built when it is opened
      lost.push({ ...info, ...(el ? window.__wr.describe(el) : { selector: null, html: null, bbox: null }) });
      if (lost.length >= 12) break;
    }
    return lost;
  }, { blocks, sel: BLOCKS, revealable: REVEALABLE });
}

const EXEMPT = 'table,pre,code,canvas,svg,iframe,video,object,embed,math,[role=application],[role=grid],[role=img],[role=toolbar],[role=slider],input[type=range]';

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a browser window 320 CSS pixels wide (the same as 400 % zoom on a 1280 pixel screen).',
    'Measure whether the page needs scrolling sideways to show its content.',
    'Find text and controls that stick out past the right edge or are cut off there.',
  ];
  const expected = 'At 320 CSS pixels wide, everything can be read and used without scrolling sideways.';
  const viewport = [NARROW.width, NARROW.height];
  const loss = await contentLoss(env).catch(() => ({ blocks: 0, lost: [] }));
  const { context, page } = await openPage(env, { viewport: NARROW });
  try {
    const m = await page.evaluate((exemptSel) => {
      const vw = document.documentElement.clientWidth;
      const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const hiddenX = ['html', 'body'].some((t) => /hidden|clip/.test(getComputedStyle(document.querySelector(t)).overflowX));
      const clippedByAncestor = (el) => {
        for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/hidden|clip|auto|scroll/.test(s.overflowX)) return true;
        }
        return false;
      };
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        if (offenders.length > 200) break;
        if (!window.__wr.visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 2) continue;
        if (r.left >= vw) continue; // fully off-screen: a hidden drawer or slide, not cut-off content
        if (getComputedStyle(el).position === 'fixed' && r.width > vw) continue;
        // A widget fixed to the window that holds only another site's frame (a captcha badge) is parked half off-screen
        // by design and slides in when used; it is not the page's content.
        if (getComputedStyle(el).position === 'fixed' && el.querySelector('iframe') && !(el.innerText || '').trim()) continue;
        if (clippedByAncestor(el)) continue;
        const hasText = window.__wr.text(el, 40).length > 0;
        const interactive = el.matches('a[href],button,input,select,textarea,[role=button],[role=link]');
        // How far the words themselves run past the edge: a box can stick out with only padding or space in it.
        let textPast = 0;
        if (hasText) {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let t = w.nextNode(); t; t = w.nextNode()) {
            if (!t.textContent.trim()) continue;
            const g = document.createRange();
            g.selectNodeContents(t);
            for (const b of g.getClientRects()) if (b.width > 1 && b.left < vw) textPast = Math.max(textPast, b.right - vw);
          }
        }
        offenders.push({ el, exempt: Boolean(el.closest(exemptSel)), hasText, interactive, r, textPast: Math.round(textPast) });
      }
      // Report the outermost offenders: their children stick out because they do.
      const top = offenders.filter((o) => !offenders.some((p) => p !== o && p.el.contains(o.el)));
      return {
        vw, sw, hiddenX, hscroll: !hiddenX && sw > vw + 2,
        offenders: top.slice(0, 12).map((o) => ({ ...window.__wr.describe(o.el), exempt: o.exempt, hasText: o.hasText, interactive: o.interactive, overflowPx: Math.round(o.r.right - vw), textPast: Math.max(o.textPast, ...offenders.filter((p) => o.el.contains(p.el)).map((p) => p.textPast)) })),
      };
    }, EXEMPT);
    const shot = writeArtifact(env, 'reflow-320.jpg', (await env.img.toJpeg(await page.screenshot({ type: 'png' }), { quality: 0.74 })).buffer);
    // The 320 px window itself, scrolled to what sticks out or is cut off: a crop taken later around the element could
    // reach past the window and show words the visitor never sees cut.
    let shotN = 0;
    const offenderShot = async (o) => {
      // Down only: scrollIntoView would also slide the page sideways to show the part a visitor cannot see.
      await page.evaluate((sel) => {
        let el = null;
        try { el = document.querySelector(sel); } catch { /* bad selector */ }
        const y = el ? el.getBoundingClientRect().top + scrollY - innerHeight / 2 : scrollY;
        window.scrollTo({ left: 0, top: Math.max(0, y), behavior: 'instant' });
        for (const s of [document.scrollingElement, document.documentElement, document.body]) if (s) s.scrollLeft = 0;
      }, o.selector).catch(() => {});
      await page.waitForTimeout(300);
      shotN += 1;
      return writeArtifact(env, `reflow-320-${shotN}.jpg`, (await env.img.toJpeg(await page.screenshot({ type: 'png' }), { quality: 0.74 })).buffer);
    };
    const signals = [];
    const meaningful = m.offenders.filter((o) => !o.exempt && (o.hasText || o.interactive));
    // Only exempt content (a table, map, code or video) sticks out; empty boxes beside it have nothing to read.
    const exempt = m.offenders.filter((o) => o.exempt);
    const exemptOnly = exempt.length > 0 && !meaningful.length;
    const measured = { viewportWidth: m.vw, contentWidth: m.sw, overflowHidden: m.hiddenX };
    if (m.hscroll && meaningful.length) {
      for (const o of meaningful.slice(0, 3)) {
        signals.push(signal(base, {
          check, sc: ['1.4.10'], status: 'fail', state: 'w320', viewport, selector: o.selector, html: o.html, bbox: o.bbox,
          description: `At 320 pixels wide the page is ${m.sw} pixels wide, and ${o.name ? `"${o.name.slice(0, 60)}"` : `the ${o.tag} element`} sticks out ${o.overflowPx} pixels past the right edge, so visitors have to scroll sideways.`,
          measured: { ...measured, overflowPx: o.overflowPx }, barrier: o.interactive ? 'blocker' : 'major', trust: 'confirmed', evidence: [await offenderShot(o)], expected, steps,
        }));
      }
    } else if (!m.hscroll && meaningful.some((o) => o.textPast > 2)) {
      // The page hides what sticks out, and words run past the edge: they are cut off, and no scrolling brings them back.
      for (const o of meaningful.filter((x) => x.textPast > 2).slice(0, 3)) {
        signals.push(signal(base, {
          check, sc: ['1.4.10'], status: 'fail', state: 'w320', viewport, selector: o.selector, html: o.html, bbox: o.bbox,
          description: `At 320 pixels wide the words of ${o.name ? `"${o.name.slice(0, 60)}"` : `the ${o.tag} element`} run ${o.textPast} pixels past the right edge, where the page cuts them off; scrolling does not bring them back.`,
          measured: { ...measured, overflowPx: o.overflowPx, textPastPx: o.textPast }, barrier: o.interactive ? 'blocker' : 'major', trust: 'confirmed', evidence: [await offenderShot(o)], expected, steps,
        }));
      }
    } else if (!m.hscroll && meaningful.length) {
      for (const o of meaningful.slice(0, 3)) {
        signals.push(signal(base, {
          check, sc: ['1.4.10'], status: 'needs_review', state: 'w320', viewport, selector: o.selector, html: o.html, bbox: o.bbox,
          description: `At 320 pixels wide ${o.name ? `"${o.name.slice(0, 60)}"` : `the ${o.tag} element`} runs ${o.overflowPx} pixels past the right edge, where the page cuts it off.`,
          question: 'Is any text or control lost at the right edge of the narrow screen (see the 320 px screenshot)?',
          measured: { ...measured, overflowPx: o.overflowPx }, barrier: 'major', trust: 'review', evidence: [shot], expected, steps,
        }));
      }
    } else if (exemptOnly) {
      const o = exempt[0];
      signals.push(signal(base, {
        check, sc: ['1.4.10'], status: 'needs_review', state: 'w320', viewport, selector: o.selector, html: o.html, bbox: o.bbox,
        description: `At 320 pixels wide only content such as a table, map, code or video is wider than the screen (${o.tag}).`,
        question: 'Does this content need a two-dimensional layout to make sense (a data table, map or diagram)? If not, it has to fit the narrow screen.',
        measured, barrier: 'minor', trust: 'review', evidence: [shot], expected, steps,
      }));
    } else if (m.hscroll) {
      // The page scrolls sideways, but nothing with text or a control was found past the edge (a box with no text, a
      // margin, a picture): the sideways scroll is measured, the loss of content is not.
      const o = m.offenders[0];
      signals.push(signal(base, {
        check, sc: ['1.4.10'], status: 'needs_review', state: 'w320', viewport, selector: o?.selector ?? null, html: o?.html ?? null, bbox: o?.bbox ?? null,
        description: `At 320 pixels wide the page is ${m.sw} pixels wide and scrolls sideways, but no text or control was found past the right edge${o ? ` (only the ${o.tag} element, with no text or control in it, sticks out)` : ''}.`,
        question: 'Scroll the narrow page sideways: is there any text, picture or control past the right edge, or only empty space?',
        measured, barrier: 'minor', trust: 'review', evidence: [o ? await offenderShot(o) : shot], expected, steps,
      }));
    } else {
      signals.push(passSignal(base, { check, sc: '1.4.10', state: 'w320', viewport, description: 'At 320 pixels wide the page fits the screen and no text or control sticks out past the right edge.', expected, steps, evidence: [shot] }));
    }
    // F102 — content that the narrow layout drops.
    const { lost } = loss;
    const contentSteps = ['Load the page at 1280 pixels wide and list the text blocks, links and buttons a visitor sees.', 'Make the same window 320 pixels wide and check that each one is on screen, or in a menu, accordion or carousel that a control opens.', 'Make it wide again and check that what was missing comes back.'];
    if (lost.length) {
      const first = lost[0];
      signals.push(signal(base, {
        check: 'reflow-content', sc: ['1.4.10'], status: 'fail', state: 'w320', viewport, selector: first.selector, html: first.html, bbox: first.bbox,
        description: `At 320 pixels wide ${lost.length} block(s) of content shown at desktop width are gone and no control brings them back, for example ${lost.slice(0, 3).map((l) => `"${l.text.slice(0, 50)}"`).join(', ')}.`,
        measured: { lost: lost.map((l) => l.text.slice(0, 80)) },
        barrier: lost.some((l) => /^(a|button)$/.test(l.tag)) ? 'blocker' : 'major', trust: 'confirmed', evidence: [shot],
        expected: 'At 320 CSS pixels wide all content of the desktop layout is still available.', steps: contentSteps,
      }));
    } else if (loss.blocks) {
      signals.push(passSignal(base, { check: 'reflow-content', sc: '1.4.10', state: 'w320', viewport, description: `All ${loss.blocks} text blocks, links and buttons of the desktop layout are still available at 320 pixels wide.`, expected: 'At 320 CSS pixels wide all content of the desktop layout is still available.', steps: contentSteps, evidence: [shot] }));
    }
    return { ran: true, environment: environment(null, NARROW), steps, signals, artifacts: [shot] };
  } finally {
    await context.close();
  }
}
