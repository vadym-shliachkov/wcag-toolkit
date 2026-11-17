// What a problem looks like place by place: one row per thing to change (a picture file, a wording), with its
// close-up, the text there now, what it should be and where it is. The PDF card, findings.csv and findings.xlsx are
// all built from these rows, so the three never disagree.
import fs from 'node:fs';
import path from 'node:path';
import { publicUrl } from './report-paths.mjs';
import { srcFile, normSel } from './merge.mjs';

const identity = (src) => {
  const f = srcFile(src);
  return f && !f.includes('[redacted]') ? f : null;
};

export function jpegSize(file) {
  try {
    const b = fs.readFileSync(file);
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch { /* missing or not a JPEG */ }
  return null;
}

// The close-ups taken of each page's images (shots/index.json "images"): by picture file, else by page and alt text,
// else by page and the end of the selector.
export function thumbIndex(shotIndex, runDir) {
  const bySrc = new Map();
  const byPage = new Map();
  for (const [pageId, list] of Object.entries(shotIndex?.images ?? {})) {
    for (const im of list ?? []) {
      if (!im.file || !fs.existsSync(path.join(runDir, im.file))) continue;
      const size = jpegSize(path.join(runDir, im.file));
      const t = { file: im.file, width: size?.width ?? 520, height: size?.height ?? 320, alt: im.alt, sel: normSel(im.selector) };
      const id = identity(im.src);
      if (id && !bySrc.has(id)) bySrc.set(id, t);
      byPage.set(pageId, [...(byPage.get(pageId) ?? []), t]);
    }
  }
  return (inst) => {
    const id = identity(inst.src);
    if (id && bySrc.has(id)) return bySrc.get(id);
    const list = byPage.get(inst.pageId) ?? [];
    const sel = normSel(inst.selector);
    // The element's own selector first; only a close-up that is the one candidate on the page is taken on weaker
    // evidence. Two portraits with the same alt on one page (a bio grid and a mosaic) must not swap close-ups.
    const strict = (t) => sel && (t.sel === sel || t.sel.endsWith(` ${sel}`) || sel.endsWith(` ${t.sel}`));
    const loose = (t) => sel && t.sel.split(' > ').at(-1) === sel.split(' > ').at(-1);
    const sameAlt = list.filter((t) => inst.current != null && t.alt === inst.current);
    const only = (arr) => (arr.length === 1 ? arr[0] : null);
    const strictHits = list.filter(strict);
    // Several close-ups share the selector (a mosaic): the alt tells them apart, else the judge's position.
    const pos = [...String(inst.selector ?? '').matchAll(/:nth-(?:of-type|child)\((\d+)\)/g)].map((m) => Number(m[1])).find((x) => x >= 1 && x <= strictHits.length);
    return only(strictHits)
      ?? only(strictHits.filter((t) => inst.current != null && t.alt === inst.current))
      ?? (strictHits.length > 1 && pos ? strictHits[pos - 1] : null)
      ?? only(sameAlt.filter(loose))
      ?? only(sameAlt)
      ?? (sel ? null : only(list.filter(loose)));
  };
}

const sectionOf = (url) => {
  try {
    const parts = new URL(url, 'https://x.invalid').pathname.split('/').filter(Boolean);
    return parts.length > 1 ? `/${parts[0]}/` : null;
  } catch { return null; }
};

// Where something is, in words a reader can act on without hunting through an appendix:
// - up to five pages: all of them;
// - every reviewed page: "every page";
// - every page of a part of the site: "every /insights/ page (18)";
// - otherwise two examples and the count of the others in that part of the site.
export function placesOf(urls, reviewedUrls) {
  const list = [...new Set(urls.filter(Boolean))];
  if (list.length <= 5) return { total: list.length, every: false, list, groups: [] };
  if (reviewedUrls.length && list.length >= reviewedUrls.length) return { total: list.length, every: true, list: [], groups: [] };
  const totals = new Map();
  for (const u of reviewedUrls) { const s = sectionOf(u); if (s) totals.set(s, (totals.get(s) ?? 0) + 1); }
  const bySection = new Map();
  const loose = [];
  for (const u of list) {
    const s = sectionOf(u);
    if (s) bySection.set(s, [...(bySection.get(s) ?? []), u]);
    else loose.push(u);
  }
  const groups = [];
  for (const [section, us] of [...bySection].sort((a, b) => b[1].length - a[1].length)) {
    const total = totals.get(section) ?? us.length;
    if (us.length <= 3) { loose.push(...us); continue; }
    groups.push({ section, n: us.length, total, all: us.length >= total, examples: us.length >= total ? [] : us.slice(0, 2) });
  }
  // Never "every page except …": a page missing from the list may simply not have been tested in depth, and a
  // developer would read it as unaffected.
  return { total: list.length, every: false, list: loose, groups };
}

// The first full sentence, never one that ends inside a quotation ("captioned "Brand photography.").
const firstSentence = (s) => {
  const text = String(s ?? '').trim();
  for (const m of text.matchAll(/[.!?](?=\s|$)/g)) {
    const cut = text.slice(0, m.index + 1);
    if (cut.length < 20) continue;
    if (cut.length > 260) return null;
    if ((cut.match(/["“”]/g) ?? []).length % 2 === 0) return cut;
  }
  return null;
};

// The words of a quote copied from the collected data ('"text": "This is my archive"' → 'This is my archive').
export const plainQuote = (s) => {
  if (s == null) return s;
  const m = /^\s*"?[\w-]+"?\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(s));
  return (m ? m[1] : String(s)).replace(/^["“]+|["”]+$/g, '').trim();
};

export const fixKindOf =(v) => (v == null ? null : v === '' ? 'hide' : 'replace');

// One element of a card that gathers an automated check's failures: the same menu item on every page is one row.
// Its words ("Home") and its place without positions or state classes: the menu item marked "active" on its own page
// is the same item.
// The element's words: quoted in the finding (never the "(only in the "w320" state)" note), else its own text, else
// the label its markup gives it.
const elementName = (x) => {
  const said = String(x.observed ?? '').replace(/\(only in the "[^"]*" state\)/g, '');
  const attr = (n) => new RegExp(`\\b${n}="([^"]{1,80})"`).exec(String(x.html ?? ''))?.[1];
  return /"([^"]{1,80})"/.exec(said)?.[1] ?? (textOf(x.html).slice(0, 80) || attr('aria-label') || attr('title') || attr('alt') || null);
};
export const elementKey = (x) => `${normSel(x.selector).replace(/\.(active|current|current-menu-item|current_page_item|is-active|selected)(?=[.:#[\s>]|$)/g, '')}|${elementName(x) ?? ''}|${x.state ?? 'default'}`;
// The key of a row's own close-up (shots --issues crops it): a picture by its page and exact path, positions
// included, so three photos sharing a class on one page stay three; other elements by elementKey.
export const rowThumbKey = (issue, x) => (issue.check === 'judge-1.1.1' ? `${x.pageId}|${String(x.selector ?? '').trim()}` : elementKey(x));
const ELEMENT_CHECKS = new Set(['focus-visible', 'autocomplete', 'form-labels', 'label', 'target-size', 'color-contrast', 'contrast-measured', 'label-in-name']);

// What was measured on one element, in numbers the card can print: a contrast ratio, a tap size, the token to add.
// An instance an automated rule could not decide (or one merged in from such an item) has "measured": null.
function elementDetail(check, measured) {
  const m = measured ?? {};
  if (check === 'contrast-measured') return { ratio: m.worstContrast ?? m.typicalContrast ?? null, required: m.required ?? 4.5 };
  if (check === 'color-contrast') {
    const ratio = m.ratio ?? Number(/contrast of ([\d.]+)/.exec(String(m.failureSummary ?? ''))?.[1]) ?? null;
    const required = m.required ?? Number(/ratio of ([\d.]+):1/.exec(String(m.failureSummary ?? ''))?.[1] ?? 4.5);
    return { ratio: Number.isFinite(ratio) ? ratio : null, required };
  }
  if (check === 'target-size') {
    const s = /\(([\d.]+)px by ([\d.]+)px/.exec(String(m.failureSummary ?? ''));
    return s ? { width: Math.round(Number(s[1])), height: Math.round(Number(s[2])) } : {};
  }
  if (check === 'autocomplete') return { token: m.expected ?? null };
  return {};
}

function elementRows(issue, { run, reviewedUrls }) {
  const rows = new Map();
  const thumbs = new Map((issue.rowThumbs ?? []).map((t) => [t.key, t]));
  for (const x of issue.instances ?? []) {
    const key = elementKey(x);
    const name = elementName(x);
    const detail = elementDetail(x.check ?? issue.check, x.measured);
    const r = rows.get(key) ?? { kind: 'element', check: x.check ?? issue.check, value: detail.token ? `autocomplete="${detail.token}"` : null, current: name, currents: name ? [name] : [], detail, file: null, thumb: thumbs.get(key) ?? null, urls: [], basis: [], seen: null };
    r.urls.push(publicUrl(x.url, run));
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, thumb: r.thumb ? { file: r.thumb.file, width: r.thumb.width, height: r.thumb.height, ...(r.thumb.boxes?.length ? { boxes: r.thumb.boxes } : {}) } : null, pages: [...new Set(r.urls)].length, places: placesOf(r.urls, reviewedUrls), urls: undefined }))
    .sort((a, b) => b.pages - a.pages || String(a.current ?? '').localeCompare(String(b.current ?? '')));
}

// One row per thing to change in an issue: the same picture file on three pages is one row with one answer.
export function recommendationRows(issue, { thumbFor, run, reviewedUrls }) {
  if (issue.check === 'text-zoom') return zoomRows(issue, { thumbFor, run, reviewedUrls });
  if (issue.status === 'fail' && ELEMENT_CHECKS.has(issue.check) && !(issue.check ?? '').startsWith('judge-')) return elementRows(issue, { run, reviewedUrls });
  // Outside alt text, a judge's row says what the words should be (a heading, a link text): a replacement that is
  // markup or an instruction ("Change the h4 elements to <p>") is a fix step, which the report gives only with --fix.
  if ((issue.check ?? '').startsWith('judge-') && issue.check !== 'judge-1.1.1') {
    const clean = (s) => s != null && s !== '' && !/[<>]/.test(s) && !/^(change|give|use|add|make|replace|remove|mark|wrap|set|move|turn|convert)\b/i.test(String(s).trim());
    const kept = (issue.instances ?? []).filter((x) => clean(x.suggestion)).map((x) => ({ ...x, current: plainQuote(x.current) }));
    if (!kept.length) return [];
    issue = { ...issue, instances: kept };
  }
  const rows = new Map();
  const ownThumbs = new Map((issue.rowThumbs ?? []).map((t) => [t.key, t]));
  for (const x of issue.instances ?? []) {
    if (x.suggestion == null && !(issue.check ?? '').startsWith('judge-')) continue;
    const id = identity(x.src);
    const key = id ? `s:${id}` : `t:${x.current ?? x.selector}|${x.suggestion}`;
    const r = rows.get(key) ?? { value: x.suggestion, kind: fixKindOf(x.suggestion), current: x.current ?? null, currents: new Set(), file: id ?? srcFile(x.src), thumb: null, urls: [], basis: new Set(), seen: null };
    // What the picture shows, in the judge's words: the close-up's text alternative in the report.
    // A judge who quoted the alt instead describes the picture in its observation's first sentence.
    // A place found by its alt pattern has no description of its own; the judged places of the same file do.
    r.seen = r.seen ?? (/^Seen in the picture:\s*(.+)/s.exec(String(x.html ?? ''))?.[1].trim() || (x.propagated ? null : firstSentence(x.observed)));
    if (r.value == null && x.suggestion != null) Object.assign(r, { value: x.suggestion, kind: fixKindOf(x.suggestion) });
    r.urls.push(publicUrl(x.url, run));
    if (x.current != null) r.currents.add(x.current);
    if (x.suggestionBasis) r.basis.add(x.suggestionBasis);
    r.thumb = r.thumb ?? thumbFor(x) ?? ownThumbs.get(rowThumbKey(issue, x)) ?? null;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ value: r.value, kind: r.kind, current: r.current, currents: [...r.currents], file: r.file, thumb: r.thumb ? { file: r.thumb.file, width: r.thumb.width, height: r.thumb.height } : null, pages: [...new Set(r.urls)].length, places: placesOf(r.urls, reviewedUrls), basis: [...r.basis], seen: r.seen }))
    .sort((a, b) => b.pages - a.pages || String(a.current ?? '').localeCompare(String(b.current ?? '')));
}

// Text that cannot grow to 200 %: one row per text style (its size and how far it grows), with a few of its texts.
function zoomRows(issue, { thumbFor, run, reviewedUrls }) {
  const rows = new Map();
  for (const x of issue.instances ?? []) {
    const m = x.measured ?? {};
    if (m.fontPx == null) continue;
    const grows = Math.round(Math.max(m.pageZoom200 ?? 0, m.textZoom200 ?? 0) * 100);
    const key = `${Math.round(m.fontPx)}|${grows}`;
    const r = rows.get(key) ?? { zoom: { fontPx: Math.round(m.fontPx), grows }, texts: new Set(), urls: [], thumb: null };
    const sample = m.text ?? x.current ?? /^"([^"]+)"/.exec(String(x.observed ?? ''))?.[1];
    // The card puts the text in quotation marks: a quote from the page loses its own, a cut-off one shows the cut.
    const clean = sample && String(sample).trim().replace(/^["“”«»'‘’]+|["“”«»'‘’]+$/g, '');
    const full = textOf(x.html).replace(/…$/, '').trim().replace(/^["“”«»'‘’]+|["“”«»'‘’]+$/g, '');
    const cut = full ? full.length > clean.length && !clean.endsWith('…') : String(sample).trim().length >= 60;
    if (clean && r.texts.size < 3) r.texts.add(cut ? `${clean.trimEnd()}…` : clean);
    r.urls.push(publicUrl(x.url, run));
    r.thumb = r.thumb ?? thumbFor(x) ?? null;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ value: null, kind: 'resize', current: null, currents: [...r.texts], zoom: r.zoom, file: null, thumb: r.thumb ? { file: r.thumb.file, width: r.thumb.width, height: r.thumb.height } : null, pages: [...new Set(r.urls)].length, places: placesOf(r.urls, reviewedUrls), basis: [] }))
    .sort((a, b) => b.pages - a.pages || b.zoom.fontPx - a.zoom.fontPx);
}

// Where a change is made once for all its places: a shared part of every page, one picture file used on several
// pages (its alt usually lives with the file in the media library), a page type, or the page itself.
function fixScope(issue, inst, sameImagePages) {
  const landmark = issue.component?.landmark;
  if (issue.scope === 'site_wide' && ['header', 'footer', 'nav', 'banner', 'contentinfo'].includes(landmark)) return 'shared_component';
  if (sameImagePages > 1) return 'image_file';
  if (issue.scope === 'site_wide') return 'shared_component';
  if (issue.scope === 'template' && issue.templates?.length) return 'template';
  return 'page';
}

const isMarkup = (html) => /^\s*</.test(String(html ?? ''));
const textOf = (html) =>String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Every place of every issue as one flat row: the work list for a developer or a model making the changes. It holds
// what is needed to decide each change without opening the PDF: the element, the text now, the exact replacement,
// whether that replacement was judged on this very page, and where one change fixes all places.
export function findingRows({ issues, entries, crit, pages, templates, run, thumbFor, fix }) {
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const tplName = new Map(templates.map((t) => [t.id, t.name]));
  const rows = [];
  for (const i of issues) {
    const e = entries[i.key] ?? {};
    const c = crit.get(i.criteria.primary);
    const srcPages = new Map();
    for (const x of i.instances) { const id = identity(x.src); if (id) srcPages.set(id, new Set([...(srcPages.get(id) ?? []), x.pageId])); }
    for (const x of i.instances) {
      const pg = pageById.get(x.pageId);
      const id = identity(x.src);
      const same = id ? srcPages.get(id).size : 1;
      const thumb = thumbFor(x);
      rows.push({
        id: i.id,
        key: i.key,
        status: i.status,
        severity: i.severity,
        confidence: x.confidence === 'medium' || i.confidence === 'medium' ? 'medium' : 'high',
        criterion: i.criteria.primary,
        criterion_name: c?.name ?? '',
        level: c?.level ?? '',
        related: i.criteria.related.join(' '),
        title: e.title ?? '',
        check: i.check,
        method: i.method,
        // The W3C ACT rule(s) an automated result was tested by: "id title url", several joined by " | ".
        act_rules: (x.act ?? []).map((r) => `${r.id} ${r.title} ${r.url}`).join(' | '),
        scope: i.scope,
        fix_scope: fixScope(i, x, same),
        component: i.component?.fingerprint ?? '',
        templates: i.templates.join(' '),
        page: publicUrl(x.url, run),
        page_id: x.pageId ?? '',
        page_title: pg?.title ?? '',
        page_type: tplName.get(pg?.templateId) ?? '',
        state: x.state,
        viewport: Array.isArray(x.viewport) ? x.viewport.join('x') : '',
        selector: x.selector ?? '',
        // Markup only: a reviewer's words about the picture belong in observed, not where a developer looks for code.
        html: isMarkup(x.html) ? String(x.html).replace(/\s+data-wr[\w-]*(="[^"]*")?/g, '').slice(0, 300) : '',
        element_text: isMarkup(x.html) ? textOf(x.html).slice(0, 120) : '',
        current_value: ((i.check ?? '').startsWith('judge-') && i.check !== 'judge-1.1.1' ? plainQuote(x.current) : x.current) ?? '',
        recommended_value: x.suggestion ?? '',
        recommendation_kind: fixKindOf(x.suggestion) ?? (i.check?.startsWith('judge-') && x.suggestion == null ? 'replace' : ''),
        recommendation_basis: x.suggestion == null ? '' : x.suggestionBasis ?? 'judge',
        has_recommendation: x.suggestion != null,
        image_src: x.src ?? '',
        image_file: id ?? '',
        same_image_pages: id ? same : '',
        observed: x.observed ?? '',
        issue_observed: e.observed ?? '',
        cause: e.cause ?? '',
        // The work list always says how to fix, whatever --fix says: that flag only decides whether the client's report
        // (PDF, HTML, workbook) shows fixes.
        fix_steps: e.fix?.steps ? e.fix.steps.join(' | ') : '',
        fix_dev_note: e.fix?.dev_note ?? '',
        fix_done_when: e.fix?.done_when ?? '',
        confidence_note: i.confidence === 'medium' ? i.confidenceNote ?? '' : '',
        question: i.status === 'needs_review' ? (e.what_to_check ?? i.question?.[0] ?? '') : '',
        thumbnail: thumb?.file ?? '',
        screenshot: i.shots?.[0]?.file ?? '',
      });
    }
  }
  return rows;
}
