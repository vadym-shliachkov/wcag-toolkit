// One defect on one component is one issue, however many pages repeat it. The component is recognised by a selector
// skeleton that survives build hashes, list positions and generated ids.
import { createHash } from 'node:crypto';

const HASHY_CLASS = /^(css|sc|jsx|emotion|svelte|astro)-|_[a-z0-9]{5,}$|[A-Za-z]+__[A-Za-z]+___[A-Za-z0-9]{5}|^[a-z]{1,3}-[a-f0-9]{5,}$/;
const HAS_DIGITS = /\d{3,}/;
const LANDMARK = /(^|[\s>.#\-_])(header|nav|navigation|footer|main|aside|dialog|banner|contentinfo|menu|cookie|consent|modal)([\s>.#\-_\[:]|$)/i;

function cleanCompound(part) {
  const tag = (/^[a-zA-Z][\w-]*/.exec(part) ?? [''])[0].toLowerCase();
  const attrs = [...part.matchAll(/\[(role|type|name|aria-[\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)]
    .filter(([, k, val]) => !(k === 'name' && HAS_DIGITS.test(val ?? '')))
    .map(([, k, val]) => `[${k}${val != null ? `=${val}` : ''}]`);
  // Classes and ids are read outside attribute selectors only: [src$="team.jpg"] holds no class ".jpg".
  const bare = part.replace(/\[[^\]]*\]/g, '');
  const classes = [...bare.matchAll(/\.((?:\\.|[\w-])+)/g)]
    .map((m) => m[1].replace(/\\(.)/g, '$1'))
    .filter((c) => !HASHY_CLASS.test(c) && !HAS_DIGITS.test(c))
    .slice(0, 3)
    .map((c) => `.${c}`);
  const id = /#((?:\\.|[\w-])+)/.exec(bare)?.[1];
  const stableId = id && !HAS_DIGITS.test(id) && !HASHY_CLASS.test(id) ? `#${id}` : '';
  return `${tag}${stableId}${classes.join('')}${attrs.join('')}`;
}

// "main > ul > li:nth-child(3) > a.card-link" → "ul > li > a.card-link" (last three meaningful steps).
export function selectorSkeleton(selector) {
  if (!selector) return '';
  const parts = String(selector)
    .replace(/:(nth-child|nth-of-type|nth-last-child|first-child|last-child|first-of-type|last-of-type)(\([^)]*\))?/g, '')
    .split(/\s*>\s*|\s+/)
    .map(cleanCompound)
    .filter(Boolean);
  return parts.slice(-3).join(' > ');
}

export function htmlSkeleton(html) {
  if (!html) return '';
  const m = /^<([a-zA-Z][\w-]*)([^>]*)>/.exec(String(html).trim());
  if (!m) return '';
  const attrs = m[2];
  const keep = [];
  for (const k of ['role', 'type']) {
    const v = new RegExp(`\\b${k}=["']?([^"'\\s>]+)`).exec(attrs)?.[1];
    if (v) keep.push(`[${k}=${v}]`);
  }
  const cls = /\bclass=["']([^"']*)["']/.exec(attrs)?.[1] ?? '';
  const classes = cls.split(/\s+/).filter((c) => c && !HASHY_CLASS.test(c) && !HAS_DIGITS.test(c)).slice(0, 3).map((c) => `.${c}`);
  return `${m[1].toLowerCase()}${classes.join('')}${keep.join('')}`;
}

export function landmarkOf(selector, html) {
  const m = LANDMARK.exec(String(selector ?? '')) ?? LANDMARK.exec(String(html ?? '').slice(0, 200));
  if (!m) return 'main';
  const w = m[2].toLowerCase();
  if (w === 'banner') return 'header';
  if (w === 'contentinfo') return 'footer';
  if (w === 'navigation' || w === 'menu') return 'nav';
  if (w === 'cookie' || w === 'consent' || w === 'modal') return 'dialog';
  return w;
}

export function componentFingerprint({ selector, html, check, measured, component }) {
  // A check may name the component itself (e.g. the form a field belongs to).
  if (component) return `${landmarkOf(component, html)}|${selectorSkeleton(component) || component}`;
  // A contrast problem is caused by one colour pair in one text style, wherever the text sits.
  if (measured?.fg && measured?.bg) return `style|${String(measured.fg).toLowerCase()}/${String(measured.bg).toLowerCase()}/${measured.fontSize ?? ''}/${measured.fontWeight ?? ''}`;
  // Text that cannot grow to 200 % comes from font sizes set by the window width (vw in the type scale), wherever
  // the text sits and whatever id each page gives its heading: one cause and one kind of change, so one issue, with
  // a row per text style (see recommendationRows).
  if (measured?.fontPx != null && measured?.pageZoom200 != null) return 'style|viewport-text';
  // Focus hidden behind a sticky header, a chat bar or a banner: the layer is the cause and the one thing to change
  // (scroll-padding, or not keeping it on screen), whichever links end up underneath it.
  // Focus on links inside one closed, transparent pop-up: the pop-up is the component.
  if (check === 'focus-obscured' && measured?.hiddenIn) {
    const box = String(measured.hiddenIn);
    return `hidden|${selectorSkeleton(box) || box}`;
  }
  if (check === 'focus-obscured' && measured?.coveredBy) {
    const layer = String(measured.coveredBy);
    return `layer|${selectorSkeleton(layer) || layer}`;
  }
  const skel = selectorSkeleton(selector) || htmlSkeleton(html) || `page:${check}`;
  return `${landmarkOf(selector, html)}|${skel}`;
}

// A reply that writes the empty alt as two quote marks ("", alt="") means the empty alt, not two quote characters.
export const plainSuggestion = (v) => (/^\s*(alt\s*=\s*)?(""|''|“”|‘’|")\s*$/i.test(String(v)) ? '' : String(v));

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export function issueKey(sc, check, fingerprint) {
  const h = createHash('sha1').update(`${sc}|${check}|${fingerprint}`).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += B32[h[i] % 32];
  return `WR-${out}`;
}
