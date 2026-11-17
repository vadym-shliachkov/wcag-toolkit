// 2.2.2 Pause, Stop, Hide (moving content that starts by itself and lasts more than 5 s needs a control),
// 1.4.2 Audio Control (sound that plays by itself for more than 3 s needs a control), and 2.3.3 Animation from
// Interactions (AAA profile only: does the page honour the "reduce motion" setting?).
// Movement is found two ways: carousels and CSS or Web Animations, and any part of the first screen that keeps
// changing between screenshots taken after the first 5 seconds (script-driven tickers, canvas, Lottie, video).
// 2.2.1 Timing Adjustable (F40, F41, F58): a page that goes to another address by itself while it is watched.
import { openPage, signal, passSignal, environment, writeArtifact, DESKTOP } from './common.mjs';

export const check = 'motion';

const CAROUSEL = '[aria-roledescription*=carousel i],[aria-roledescription*=slide i],[class*=carousel i],[class*=slider i],[class*=swiper i],[class*=slick i],[class*=marquee i],[class*=ticker i],marquee';
const CONTROL = /pause|stop|play|пауза|стоп|остановить|зупинити|anhalten/i;

async function movingNow(page, img) {
  // Candidates: carousels and elements running long or endless animations, at least 40 × 40 px.
  const cands = await page.evaluate((carouselSel) => {
    const out = [];
    const add = (el, why) => {
      if (!window.__wr.visible(el) || out.some((o) => o.el === el || o.el.contains(el))) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40 || r.bottom < 0 || r.top > innerHeight * 3) return;
      out.push({ el, why });
    };
    document.querySelectorAll(carouselSel).forEach((el) => add(el, 'carousel'));
    for (const a of document.getAnimations()) {
      const t = a.effect?.getTiming?.();
      const el = a.effect?.target;
      if (!el || !t || a.playState !== 'running') continue;
      const total = t.iterations === Infinity ? Infinity : (Number(t.duration) || 0) * (t.iterations || 1);
      if (total > 5000) add(el, 'animation');
    }
    return out.slice(0, 6).map((o, i) => {
      o.el.setAttribute('data-wr-move', String(i));
      // A pause button sits inside the slideshow, next to it, or elsewhere in the section that holds it.
      const scopes = [o.el, o.el.parentElement, o.el.parentElement?.parentElement, o.el.closest('section,article,aside,figure,[role=region]')].filter(Boolean);
      const controls = [...new Set(scopes.flatMap((sc) => [...sc.querySelectorAll('button,[role=button],a')]))].map((b) => window.__wr.name(b)).filter(Boolean);
      return { i, why: o.why, ...window.__wr.describe(o.el), controls };
    });
  }, CAROUSEL);
  const moving = [];
  for (const c of cands) {
    const loc = page.locator(`[data-wr-move="${c.i}"]`);
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
      const a = await loc.screenshot({ type: 'png', timeout: 3000 });
      const shown = await shownContent(page, c.i);
      // Watched for 6 seconds at uneven moments: a slideshow whose round takes 2, 3 or 6 seconds is back on its first
      // slide after exactly 6, so two pictures 6 seconds apart would look the same.
      // Moving means a large share of the pixels changed, or the words or pictures it shows changed: one line of dark
      // text on white swapped for another alters only about 1 % of the pixels.
      let best = null;
      for (const wait of WATCH_MS) {
        await page.waitForTimeout(wait);
        const b = await loc.screenshot({ type: 'png', timeout: 3000 });
        const d = await img.diff(a, b);
        const swapped = d.ratio > 0 && (await shownContent(page, c.i)) !== shown;
        const score = (swapped ? 1 : 0) + d.ratio;
        if (!best || score > best.score) best = { score, swapped, ratio: d.ratio, shot: b };
      }
      if (best.swapped || best.ratio > 0.05) moving.push({ ...c, changed: best.ratio, before: a, after: best.shot });
    } catch { /* element went away */ }
  }
  return moving;
}

// What a candidate shows right now: the text and the picture addresses of the parts of it that are visible inside its
// box. A slide that is hidden, or pushed outside the box, does not count. Pictures still loading (no address yet or a
// data: placeholder) are left out, so a picture that loads late is not taken for a new slide.
const shownContent = (page, i) => page.evaluate((i) => {
  const root = document.querySelector(`[data-wr-move="${i}"]`);
  if (!root) return '';
  const box = root.getBoundingClientRect();
  const inside = (el) => {
    const r = el.getBoundingClientRect();
    return Math.min(r.right, box.right) - Math.max(r.left, box.left) >= 4 && Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top) >= 4;
  };
  const out = [];
  for (const el of [root, ...root.querySelectorAll('*')].slice(0, 400)) {
    if (!window.__wr.visible(el) || !inside(el)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (own) out.push(own);
    const src = el.currentSrc || el.getAttribute('src') || '';
    if (el.matches('img,video') && src && !src.startsWith('data:')) out.push(`[${src}]`);
  }
  return out.join('|');
}, i).catch(() => '');

// The pauses between the pictures of a candidate: 2.3 s, 3.7 s and 6 s after the first. No common slide period
// (a multiple of 0.1 s) lands on all three.
const WATCH_MS = [2300, 1400, 2300];

// Parts of the first screen that keep changing: screenshots 2 s and then 1.3 s apart (uneven, so a ticker with a
// 2-second round is not caught at the same point twice), compared cell by cell; a cell that changes in both intervals
// is moving. Each moving cell is traced to the element drawn there.
async function movingByPixels(page, img) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
  const shots = [];
  for (const wait of [0, 2000, 1300]) {
    if (wait) await page.waitForTimeout(wait);
    shots.push(await page.screenshot({ type: 'png' }));
  }
  const COLS = 8;
  const ROWS = 6;
  const g1 = await img.gridDiff(shots[0], shots[1], { cols: COLS, rows: ROWS });
  const g2 = await img.gridDiff(shots[1], shots[2], { cols: COLS, rows: ROWS });
  const cells = [];
  for (let k = 0; k < COLS * ROWS; k++) {
    if (g1.ratios[k] < 0.02 || g2.ratios[k] < 0.02) continue;
    cells.push(g2.centres[k]);
  }
  if (!cells.length) return [];
  const found = await page.evaluate(({ cells, carouselSel }) => {
    const out = [];
    for (const { x, y } of cells) {
      // Text laid over a background video or canvas is not what moves: trace the cell to the media behind it.
      let el = document.elementsFromPoint(x, y).find((e) => e.matches('video,canvas')) || document.elementFromPoint(x, y);
      // The moving block: the first ancestor at least 40 × 40 px.
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        if (r.width >= 40 && r.height >= 40) break;
        el = el.parentElement;
      }
      if (!el || el === document.body || el === document.documentElement) continue;
      if (el.closest('[data-wr-move]') || el.closest(carouselSel) || out.some((o) => o.el === el || o.el.contains(el) || el.contains(o.el))) continue;
      // A loading indicator is not content.
      if (el.closest('[role=progressbar],[aria-busy=true]') || /spin|loader|loading/i.test(String(el.className))) continue;
      out.push({ el });
    }
    return out.slice(0, 4).map((o, i) => {
      o.el.setAttribute('data-wr-move', `px${i}`);
      const scopes = [o.el, o.el.parentElement, o.el.parentElement?.parentElement, o.el.closest('section,article,aside,figure,[role=region]')].filter(Boolean);
      const controls = [...new Set(scopes.flatMap((sc) => [...sc.querySelectorAll('button,[role=button],a')]))].map((b) => window.__wr.name(b)).filter(Boolean);
      const video = o.el.matches('video') ? o.el : o.el.querySelector('video');
      return { i: `px${i}`, why: video ? 'video' : 'animation', ...window.__wr.describe(o.el), controls, native: Boolean(video && video.controls) };
    });
  }, { cells, carouselSel: CAROUSEL });
  return found.map((f) => ({ ...f, changed: cells.length / (COLS * ROWS), before: shots[1], after: shots[2], whole: true }));
}

export async function run(env) {
  const base = { pageId: env.pageId, url: env.url };
  const steps = [
    'Load the page in a desktop browser window (1280 × 900) without touching it.',
    'Watch carousels, tickers and animations for 6 seconds and compare what they show before and after.',
    'Look for a pause, stop or hide button next to anything that moves, and for sound that starts by itself.',
  ];
  const { context, page, blocked } = await openPage(env, { viewport: DESKTOP });
  const signals = [];
  const artifacts = [];
  try {
    const moving = await movingNow(page, env.img);
    moving.push(...await movingByPixels(page, env.img).catch(() => []));
    for (const [n, m] of moving.entries()) {
      const hasControl = m.native || m.controls.some((c) => CONTROL.test(c));
      const shots = [
        writeArtifact(env, `motion-${n + 1}-start.jpg`, (await env.img.toJpeg(m.before, { maxWidth: 900, quality: 0.74 })).buffer),
        writeArtifact(env, `motion-${n + 1}-${m.whole ? 'later' : '6s'}.jpg`, (await env.img.toJpeg(m.after, { maxWidth: 900, quality: 0.74 })).buffer),
      ];
      artifacts.push(...shots);
      if (hasControl) continue;
      const what = { carousel: 'slideshow', video: 'video' }[m.why] ?? 'animation';
      const a = what === 'animation' ? 'An' : 'A';
      // Still changing after 5 seconds, measured twice: that is the condition itself, whatever draws it.
      const settled = m.why === 'carousel' || m.whole;
      signals.push(signal(base, {
        check, sc: ['2.2.2'], status: settled ? 'fail' : 'needs_review', selector: m.selector, html: m.html, bbox: m.bbox,
        description: m.whole ? `${a} ${what} keeps moving by itself (it was still changing 5 to 9 seconds after the page opened) and there is no button to pause or stop it.` : `${a} ${what} changes by itself (it changed while it was watched for 6 seconds) and there is no button to pause or stop it.`,
        question: settled ? undefined : 'Is this animation part of the content or a loading indicator? Content that moves for more than 5 seconds needs a way to pause, stop or hide it.',
        measured: { changedShare: Math.round(m.changed * 100) / 100, controlsNearby: m.controls.slice(0, 8) },
        barrier: 'major', trust: settled ? 'confirmed' : 'review', evidence: shots,
        expected: 'Anything that moves by itself for more than 5 seconds can be paused, stopped or hidden.', steps,
      }));
    }
    if (!signals.some((x) => x.sc.includes('2.2.2'))) {
      signals.push(passSignal(base, { check, sc: '2.2.2', description: moving.length ? 'Content that moves by itself has a pause or stop button.' : 'Nothing on the page moved by itself during 6 seconds of watching.', expected: 'Anything that moves by itself for more than 5 seconds can be paused, stopped or hidden.', steps, evidence: artifacts }));
    }

    // 1.4.2: media playing with sound after load.
    const audio = await page.evaluate(() => [...document.querySelectorAll('video,audio')]
      .filter((m) => !m.paused && !m.muted && m.volume > 0)
      .map((m) => ({ ...window.__wr.describe(m), controls: m.controls, duration: Number.isFinite(m.duration) ? Math.round(m.duration) : null, loop: m.loop })));
    const autoplayFrames = await page.evaluate(() => [...document.querySelectorAll('iframe[src*="autoplay=1"]')].filter((f) => !/mute=1|muted=1/.test(f.src)).map((f) => window.__wr.describe(f)));
    for (const a of audio) {
      const long = a.duration === null || a.duration > 3 || a.loop;
      if (!long) continue;
      signals.push(signal(base, {
        check, sc: ['1.4.2'], status: a.controls ? 'needs_review' : 'fail', selector: a.selector, html: a.html, bbox: a.bbox,
        description: `A ${a.tag} starts playing sound by itself when the page opens${a.duration ? ` and lasts ${a.duration} seconds` : ''}${a.controls ? ', with the player\'s own controls' : ' with no control to stop it'}.`,
        question: a.controls ? 'Can visitors who use a screen reader find the player\'s pause or mute button before the sound drowns out their screen reader?' : undefined,
        measured: { durationSec: a.duration, loop: a.loop, controls: a.controls }, barrier: 'blocker', trust: a.controls ? 'review' : 'confirmed',
        expected: 'Sound that plays by itself for more than 3 seconds can be paused or stopped, or its volume changed separately.', steps,
      }));
    }
    for (const f of autoplayFrames.slice(0, 2)) {
      signals.push(signal(base, {
        check, sc: ['1.4.2'], status: 'needs_review', selector: f.selector, html: f.html, bbox: f.bbox,
        description: 'An embedded video is set to start playing by itself and is not muted.',
        question: 'Does this video play sound when the page opens, and can visitors stop it straight away?',
        barrier: 'major', trust: 'review', expected: 'Sound that plays by itself for more than 3 seconds can be paused or stopped.', steps,
      }));
    }
    if (!audio.length && !autoplayFrames.length) {
      signals.push(passSignal(base, { check, sc: '1.4.2', description: 'No sound started playing by itself when the page opened.', expected: 'Sound that plays by itself for more than 3 seconds can be paused or stopped.', steps }));
    }
    // 2.2.1 — the page went (or tried to go) to another address by itself while nothing was touched.
    const timedExpected = 'A page does not reload or redirect after a time limit unless the visitor can turn it off, change it or extend it.';
    if (blocked.navigations) {
      signals.push(signal(base, {
        check: 'timed-redirect', sc: ['2.2.1'], status: 'fail', selector: null, html: null, bbox: null,
        description: `While the page was open and nothing was touched, it tried to go to ${blocked.lastNavigation ? `"${blocked.lastNavigation.slice(0, 120)}"` : 'another address'} by itself, so visitors who read slowly lose the page.`,
        measured: { navigations: blocked.navigations, to: blocked.lastNavigation ?? null },
        barrier: 'major', trust: 'confirmed', expected: timedExpected, steps,
      }));
    } else {
      signals.push(passSignal(base, { check: 'timed-redirect', sc: '2.2.1', description: 'The page stayed where it was while it was watched; it did not reload or redirect by itself.', expected: timedExpected, steps }));
    }
  } finally {
    await context.close();
  }

  // 2.3.3 (AAA): with "reduce motion" switched on, do the long animations stop?
  if (env.level === 'AAA') {
    const { context: c2, page: p2 } = await openPage(env, { viewport: DESKTOP, reducedMotion: 'reduce' });
    try {
      const running = await p2.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      signals.push(running > 0
        ? signal(base, { check, sc: ['2.3.3'], status: 'needs_review', description: `With the "reduce motion" setting on, ${running} animation(s) still run.`, question: 'Are these animations essential, or triggered by interaction? If not, they should stop when visitors ask for less motion.', barrier: 'minor', trust: 'review', expected: 'Motion triggered by interaction can be turned off.', steps })
        : passSignal(base, { check, sc: '2.3.3', description: 'With the "reduce motion" setting on, no animations run.', expected: 'Motion triggered by interaction can be turned off.', steps }));
    } finally {
      await c2.close();
    }
  }
  return { ran: true, environment: environment(null, DESKTOP, { input: 'none' }), steps, signals, artifacts };
}
