// Observations (automated + judges) → issues.json (confirmed problems and items to check) and
// criteria-status.json (one status per criterion in the profile, following kb/guides/reporting.md).
import path from 'node:path';
import { readJson } from './io.mjs';
import { REFS_DIR } from './paths.mjs';
import { allCriteria, inProfile, compareSc } from './criteria.mjs';
import { componentFingerprint, issueKey, landmarkOf, plainSuggestion } from './dedupe.mjs';
import { severityOf, severityRank } from './severity.mjs';

const KEY_FORM_PURPOSES = ['login', 'signup', 'contact', 'checkout', 'search'];
const JOURNEY_NAMES = {
  browse: 'Find and read information',
  search: 'Search the site',
  login: 'Sign in',
  signup: 'Create an account',
  contact: 'Contact the business',
  checkout: 'Buy something',
  newsletter: 'Subscribe to updates',
};
const MEASURED_CHECKS = new Set(['reflow', 'resize-text', 'text-spacing', 'target-size', 'focus-obscured', 'orientation', 'motion']);

export function issueMethod(o) {
  const x = o.x ?? {};
  if (x.source === 'judge') return 'ai_review';
  if (x.source === 'axe') return x.measured?.ratio != null ? 'measured' : 'automated';
  if (x.source === 'collect' || x.source === 'site') return 'automated';
  return MEASURED_CHECKS.has(x.check) ? 'measured' : 'interactive';
}

// Journeys come from what the site actually has: everyone browses; forms add search, sign-in, contact, buying…
export function buildJourneys(pages, templates, collects) {
  const reviewed = pages.filter(isReviewed);
  const journeys = [{ id: 'browse', name: JOURNEY_NAMES.browse, pageIds: reviewed.map((p) => p.id), templates: templates.map((t) => t.id) }];
  for (const purpose of ['search', 'login', 'signup', 'contact', 'checkout', 'newsletter']) {
    const pageIds = collects.filter((c) => (c.forms ?? []).some((f) => f.purpose === purpose)).map((c) => c.pageId);
    if (!pageIds.length) continue;
    const tids = [...new Set(pageIds.map((pid) => reviewed.find((p) => p.id === pid)?.templateId).filter(Boolean))];
    journeys.push({ id: purpose, name: JOURNEY_NAMES[purpose], pageIds, templates: tids });
  }
  for (const j of journeys) {
    j.tested = templates.some((t) => t.deep && j.templates.includes(t.id));
  }
  return journeys;
}

export function isReviewed(p) {
  return p.status >= 200 && p.status < 300 && !p.blocked && !p.soft404 && !p.error;
}

// Task pages are where people complete something (send, sign in, buy, search): only there can a blocker be critical.
// Key pages add the home page and other key-flow page types; they lift lesser barriers one step.
function taskPages(pages, collects, templates) {
  const set = new Set();
  for (const c of collects) if ((c.forms ?? []).some((f) => KEY_FORM_PURPOSES.includes(f.purpose))) set.add(c.pageId);
  const taskTemplates = new Set(templates.filter((t) => ['cart', 'checkout', 'account', 'search', 'form'].includes(t.kind)).map((t) => t.id));
  for (const p of pages) if (taskTemplates.has(p.templateId)) set.add(p.id);
  return set;
}

function keyPages(pages, collects, templates) {
  const set = taskPages(pages, collects, templates);
  // The home page alone is not a task: a problem only there is lifted by reach or by being shared, not by place.
  const keyTemplates = new Set(templates.filter((t) => t.keyFlow && t.kind !== 'home').map((t) => t.id));
  for (const p of pages) if (keyTemplates.has(p.templateId)) set.add(p.id);
  return set;
}

const fpTokens = (fp) => new Set((String(fp).split('|')[1] ?? '').match(/[.#][\w-]+/g)?.map((t) => t.slice(1)) ?? []);
const fpLast = (fp) => (String(fp).split('|')[1] ?? '').split(' > ').at(-1) ?? '';
const groupPages = (g) => new Set(g.observations.map((o) => o.x?.pageId).filter(Boolean));
const groupSources = (g) => new Set(g.observations.map((o) => o.x?.source));

// Deep checks and judges look at one page in depth; automation sees every page. When they describe the same element
// (same requirement, or a judge naming another requirement for it) on pages automation also flagged, it is one
// problem: the deep or judge evidence joins the automated issue instead of becoming a second card.
export function foldCrossSource(groups, reviewedCount) {
  const auto = groups.filter((g) => [...groupSources(g)].every((s) => s === 'axe' || s === 'collect'));
  const out = groups.filter((g) => auto.includes(g));
  for (const g of groups) {
    if (auto.includes(g)) continue;
    const pages = groupPages(g);
    const sc = g.observations[0].criterion_id;
    const judge = groupSources(g).has('judge');
    const tokens = fpTokens(g.fp);
    const landmark = String(g.fp).split('|')[0];
    let best = null;
    let bestScore = 0;
    for (const a of auto) {
      const aPages = groupPages(a);
      if (![...pages].every((p) => aPages.has(p))) continue;
      const sameSc = a.observations.some((o) => o.criterion_id === sc);
      if (!sameSc && !judge) continue;
      const overlap = [...fpTokens(a.fp)].filter((t) => tokens.has(t)).length;
      const aLast = fpLast(a.fp);
      const bareTag = /^[a-z]+$/.test(aLast) && fpLast(g.fp).startsWith(aLast) && sameSc;
      const sharedPart = sameSc && aPages.size >= 0.8 * reviewedCount && ['header', 'footer', 'nav'].includes(landmark);
      const score = overlap * 3 + (bareTag ? 2 : 0) + (sharedPart ? 1 : 0);
      if (score > bestScore || (score === bestScore && score > 0 && aPages.size > groupPages(best).size)) { best = a; bestScore = score; }
    }
    if (best && bestScore > 0) best.observations.push(...g.observations);
    else out.push(g);
  }
  return out;
}

function groupObservations(observations, status) {
  const groups = new Map();
  for (const o of observations) {
    if (o.status !== status) continue;
    const x = o.x ?? {};
    if (x.suggestion != null) x.suggestion = plainSuggestion(x.suggestion);
    const fp = componentFingerprint({ selector: x.selector ?? o.scope?.locator, html: x.html, check: x.check, measured: x.measured, component: x.component });
    const key = issueKey(o.criterion_id, x.check ?? 'judge', fp);
    if (!groups.has(key)) groups.set(key, { key, fp, observations: [] });
    groups.get(key).observations.push(o);
  }
  return [...groups.values()];
}

function toIssue(g, ctx) {
  const { pageById, reviewedCount, keyPageIds, taskPageIds, journeys, templatesById, status } = ctx;
  const obs = g.observations;
  const first = obs[0];
  const x = first.x ?? {};
  const scs = [...new Set(obs.flatMap((o) => [o.criterion_id, ...(o.related_criteria ?? [])]))].sort(compareSc);
  const primary = first.criterion_id;
  const pageIds = [...new Set(obs.map((o) => o.x?.pageId).filter(Boolean))];
  const templateIds = [...new Set(obs.map((o) => o.x?.templateId ?? pageById.get(o.x?.pageId)?.templateId).filter(Boolean))];
  // Automation ran on every page, so when it is part of the evidence the page count is measured, not estimated. So did
  // the site-level checks (the link graph behind "ways to a page"), and a picture is found by its file on every page.
  const measured = obs.some((o) => ['axe', 'collect', 'site'].includes(o.x?.source) || (o.x?.source === 'judge' && Boolean(o.x?.srcUrl)));
  // Deep and judge findings are seen on one representative page; every page of that template likely shares them.
  // A judge reads up to five pages of a type (samplePages): the pages it read without finding the problem do not have
  // it, so only the pages it did not read are counted as likely.
  const judgedOnly = obs.every((o) => o.x?.source === 'judge');
  const likelyPages = measured ? pageIds.length : templateIds.reduce((n, tid) => {
    const all = templatesById.get(tid)?.pageIds ?? [];
    if (!judgedOnly) return n + all.length;
    const seen = pageIds.filter((p) => all.includes(p)).length;
    return n + seen + Math.max(0, all.length - 5);
  }, 0) || pageIds.length;
  const reachShare = reviewedCount ? likelyPages / reviewedCount : 0;
  const landmark = landmarkOf(x.selector, x.html);
  const global = reachShare >= 0.8 && likelyPages >= 3;
  // A shared part (header, footer) also sits on the task pages, but it is not the task: an unnamed cart link in the
  // header does not stop anyone sending the contact form. Only problems in the page's own content block a task.
  const keyTask = !global && pageIds.some((pid) => taskPageIds.has(pid));
  const keyJourney = global || keyTask || pageIds.some((pid) => keyPageIds.has(pid));
  const barrier = obs.map((o) => o.x?.barrier).sort((a, b) => ['blocker', 'major', 'minor'].indexOf(a) - ['blocker', 'major', 'minor'].indexOf(b))[0] ?? 'major';
  const severity = severityOf({ barrier, keyTask, keyJourney, global, reachShare });
  const issueJourneys = journeys.filter((j) => global || pageIds.some((pid) => j.pageIds.includes(pid)) || (!measured && templateIds.some((t) => j.templates.includes(t)))).map((j) => j.id);
  // Instances in the default state come first, so screenshots and examples show the page as people normally see it.
  const ordered = [...obs].sort((a, b) => Number((a.scope?.state ?? 'default') !== 'default') - Number((b.scope?.state ?? 'default') !== 'default'));
  // The same element reported by two checks on the same page is one place, not two.
  const seenPlaces = new Set();
  const unique = ordered.filter((o) => {
    const b = o.x?.bbox;
    // The element itself, whatever state or check saw it: its classes and id, else its position.
    const last = String(o.x?.selector ?? '').split(/\s*>\s*|\s+/).at(-1) ?? '';
    const names = (last.replace(/\[[^\]]*\]/g, '').match(/[.#][\w-]+/g) ?? []).sort().join('');
    // A picture file is one place per page, whichever selector found it (a judge's, or same-file matching).
    // A redacted file name ("[redacted].webp") is shared by every hidden picture, so it does not tell two apart.
    const file = o.x?.srcUrl ? srcFile(o.x.srcUrl) : null;
    // A judge names each picture by its own path (":nth-of-type(20)"): three photos sharing the class "aligncenter"
    // are three places.
    const judged = o.x?.source === 'judge' && o.x?.selector;
    const id = file && !file.includes('[redacted]') ? `${o.x?.pageId}|src:${file}` : file || judged ? `${o.x?.pageId}|src:${file ?? ''}|${o.x?.selector ?? o.id}|${o.x?.current ?? ''}` :`${o.x?.pageId}|${names ||(b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}` : o.x?.selector ?? o.id)}`;
    if (seenPlaces.has(id)) return false;
    seenPlaces.add(id);
    return true;
  });
  const instances = unique.slice(0, 200).map((o) => ({
    observationId: o.id,
    pageId: o.x?.pageId ?? null,
    url: o.scope?.url ?? null,
    selector: o.x?.selector ?? o.scope?.locator ?? null,
    html: o.x?.html ?? null,
    bbox: o.x?.bbox ?? null,
    state: o.scope?.state ?? 'default',
    viewport: o.x?.viewport ?? o.environment?.viewport_css_px ?? null,
    measured: o.x?.measured ?? null,
    // The W3C ACT rules an automated result was tested by (kb/data/act-rules.json).
    act: o.x?.act ?? null,
    observed: o.observed ?? null,
    // What should be there instead (a judge's recommended alt text, label or name), when the finding is a wording.
    suggestion: o.x?.suggestion ?? null,
    // Where that recommendation comes from: the judge who saw this place, the same picture file judged elsewhere,
    // or the pattern of its problem (an unseen photo named like the others is hidden like the others).
    suggestionBasis: o.x?.suggestion == null ? null : o.x?.suggestionBasis ?? 'judge',
    // The text there now (an alt text) and the picture file, so a developer finds it in the CMS or the code.
    current: o.x?.current ?? null,
    src: o.x?.srcUrl ?? null,
    confidence: o.x?.confidence ?? null,
    // Pictures a deep check took in its own state (wider spacing, 200 % text), which a fresh crop cannot reproduce.
    evidenceImages: (o.evidence ?? []).map((e) => e.reference).filter((r) => /.(jpe?g|png)$/i.test(String(r))),
  }));
  return {
    key: g.key,
    status,
    criteria: { primary, related: scs.filter((s) => s !== primary) },
    check: x.check ?? 'judge',
    sources: [...new Set(obs.map((o) => o.x?.source))],
    component: { fingerprint: g.fp, landmark, label: null },
    scope: global ? 'site_wide' : templateIds.length && !measured ? 'template' : 'pages',
    templates: templateIds,
    instances,
    instanceCount: unique.length,
    reach: { pages: pageIds.length, pagesReviewed: reviewedCount, measured, likelyPages, share: Number(reachShare.toFixed(3)) },
    severity,
    severityBasis: { barrier, keyTask, keyJourney, global, reachShare: Number(reachShare.toFixed(3)) },
    journeys: issueJourneys,
    method: issueMethod(first),
    // How sure the review is: measured and automated findings are certain; a judge says when it is less sure.
    // Only judges whose recommendation stands speak for the card: a judge outvoted on "hide or describe" was unsure
    // about a decision the card does not make, and its note would contradict the card.
    // A card is unsure only for one shared reason: notes about different pictures each doubt one picture, and the card
    // itself is decided by the rule they all follow.
    confidence: standing(obs).some((o) => o.x?.confidence === 'medium') && !obs.some((o) => ['axe', 'deep'].includes(o.x?.source)) && unsureNotes(obs).length <= 1 ? 'medium' : 'high',
    confidenceNote: unsureNotes(obs).length === 1 ? unsureNotes(obs)[0] : null,
    observed: [...new Set(obs.map((o) => o.observed).filter(Boolean))].slice(0, 5),
    measured: x.measured ?? null,
    question: status === 'needs_review' ? [...new Set(obs.flatMap((o) => o.unresolved_questions ?? []))].slice(0, 3) : null,
    thirdParty: obs.some((o) => o.x?.thirdParty),
    observationIds: obs.map((o) => o.id),
    shots: [],
  };
}

// A place found by pattern carries a copy of its source judge's fields, not a judgement of its own.
const unsureNotes = (obs) => [...new Set(standing(obs).filter((o) => o.x?.confidence === 'medium').map((o) => o.x?.confidenceNote).filter(Boolean))];
const standing = (obs) => obs.filter((o) => !o.x?.propagated && (o.x?.suggestionReplaced == null || fixKind(o.x.suggestionReplaced) === fixKind(o.x.suggestion)));

function sortIssues(list) {
  return list.sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity)
    || Number(b.severityBasis.keyJourney) - Number(a.severityBasis.keyJourney)
    || b.reach.likelyPages - a.reach.likelyPages
    || compareSc(a.criteria.primary, b.criteria.primary));
}

// A judge may find that an element automation already reported also fails another criterion ("same_as"): that is
// one problem with two criteria, so the criterion joins the automated observations instead of opening a new issue.
export function foldSameAs(observations) {
  const out = [];
  for (const o of observations) {
    const same = o.x?.sameAs;
    if (!same || o.status !== 'fail') { out.push(o); continue; }
    const targets = observations.filter((t) => t !== o && t.status === 'fail' && t.x?.check === same);
    if (!targets.length) { out.push(o); continue; }
    for (const t of targets) {
      if (t.criterion_id !== o.criterion_id && !t.related_criteria.includes(o.criterion_id)) t.related_criteria.push(o.criterion_id);
    }
  }
  return out;
}

// The element's shape without page-specific names: "#work-alpha > figure.proof > img" → "figure > img".
export function tagTail(selector, n = 2) {
  const parts = String(selector ?? '').replace(/\[[^\]]*\]/g, '').replace(/:[\w-]+(\([^)]*\))?/g, '').split(/\s*>\s*|\s+/).filter(Boolean).slice(-n);
  const tags = parts.map((c) => c.match(/^[a-z][a-z0-9-]*/i)?.[0]?.toLowerCase() ?? '*');
  return tags.every((x) => x === '*') ? null : tags.join(' > ');
}

// What makes two items to check the same question for a person, wherever they were seen:
// - automated ones: the same check that could not decide for the same reason in the same part of the page (white text
//   over a photo on every banner is one question, not one per page);
// - a judge's: the same kind of element in the same part of the page (every case-study image's description).
// Otherwise one question per requirement per page set, whichever checks raised it.
function reviewKey(g) {
  const o = g.observations[0];
  const sc = o.criterion_id;
  const src = groupSources(g);
  const landmark = String(g.fp).split('|')[0];
  if ([...src].every((x) => x === 'axe' || x === 'collect')) {
    const reason = String(o.observed ?? '').split(/Fix (?:any|all) of the following:/i)[1]?.split('.')[0]?.trim().toLowerCase();
    if (reason) return `${sc}|auto|${o.x?.check}|${landmark}|${reason}`;
  }
  if (src.size === 1 && src.has('judge')) {
    const shape = tagTail(o.x?.selector ?? o.scope?.locator);
    if (shape) return `${sc}|judge|${landmark}|${shape}`;
  }
  return `${sc}|${[...groupPages(g)].sort().join(',')}`;
}

// A judge's wording failures on the same kind of element in the same part of the page are one problem across page
// types (every case-study photo described only by the client's name), not one per page type. Each image keeps its
// own recommended replacement in its instance.
// The pattern of the text being replaced, without its names: "Alpha project context" and "Beta project context"
// are one pattern ("project context"); an accurate description of a stock photo is another.
export function altPattern(alt) {
  if (alt == null) return null;
  return String(alt).replace(/\b[\p{Lu}\d][\p{L}\d&'’.-]*/gu, ' ').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// The collected images of each page, to find which picture a judge or a pattern points at. Selectors are not unique
// (two cards built the same way give two identical paths), so a match uses the page, then the alt text and the end
// of the selector together; position pseudo-classes a judge adds (":nth-of-type(2)") are ignored.
// Classes a lazy loader adds and removes as the picture loads ("img.entered.lazyloaded") are not part of the element.
const LAZY_STATE = /\.(entered|exited|loaded|lazyloaded|lazyloading|lazyload|lazy|ls-is-cached|litespeed-loaded|perfmatters-lazy|rocket-lazyload)(?=[.:#[\s>]|$)/g;
export const normSel = (s) => String(s ?? '').replace(/:nth-[\w-]+\([^)]*\)/g, '').replace(LAZY_STATE, '').replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ').trim();
export function imageIndex(collects = []) {
  const byPage = new Map();
  for (const c of collects) byPage.set(c.pageId, (c.images ?? []).filter((im) => im.selector).map((im) => ({ ...im, sel: normSel(im.selector) })));
  return byPage;
}
export function findImage(index, pageId, selector, alt) {
  const list = index.get(pageId) ?? [];
  // The exact path, positions included, when the collected one has them too.
  const exact = (s) => String(s ?? '').replace(LAZY_STATE, '').replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ').trim();
  const ex = exact(selector);
  const exactHits = ex ? list.filter((im) => { const e = exact(im.selector); return e === ex || e.endsWith(` > ${ex}`) || ex.endsWith(` > ${e}`); }) : [];
  if (exactHits.length === 1 && (alt == null || exactHits[0].alt === alt)) return exactHits[0];
  const sel = normSel(selector);
  const selHit = (im) => sel && (im.sel === sel || im.sel.endsWith(` ${sel}`) || sel.endsWith(` ${im.sel}`));
  const altHit = (im) => alt != null && (im.alt === alt || (alt.length >= 12 && String(im.alt ?? '').startsWith(alt)));
  const both = list.filter((im) => selHit(im) && altHit(im));
  if (both.length) return both[0];
  const bySel = list.filter(selHit);
  const byAlt = list.filter(altHit);
  // The alt the judge quoted names one picture: it outweighs a selector that happens to match another one.
  if (byAlt.length === 1 && (bySel.length !== 1 || !altHit(bySel[0]))) return byAlt[0];
  if (bySel.length === 1) return bySel[0];
  if (byAlt.length === 1 || (byAlt.length && !bySel.length)) return byAlt[0];
  if (alt != null || !bySel.length) return null;
  // Several images share the selector (four portraits in a mosaic) and no alt was quoted: the judge's position
  // (":nth-of-type(3)") picks one, in page order. Without a position, guessing the first would give every place the
  // first image's alt, so none is picked.
  const pos = [...String(selector ?? '').matchAll(/:nth-(?:of-type|child)\((\d+)\)/g)].map((m) => Number(m[1]));
  const k = pos.find((x) => x >= 1 && x <= bySel.length);
  return k ? bySel[k - 1] : null;
}

// The alt a judge quoted as evidence ("alt": "…", or the bare text), when it quoted one.
function quotedAlt(o) {
  const quote = String(o.x?.html ?? '');
  if (!quote || /^Seen in the picture/.test(quote) || /^"selector"/.test(quote)) return null;
  // A selector written where the alt belongs ("figure.mosaic > span > img") is not the text read out.
  if (/^[a-z][\w-]*([.#[][^\s]*)?(\s*>\s*[a-z*][^\s>]*)+$/i.test(quote.trim())) return null;
  const m = quote.match(/"alt"\s*:\s*"((?:[^"\\]|\\.)*)"?/);
  return m ? m[1] : quote;
}

export function foldJudgeFails(groups, collects = []) {
  const images = imageIndex(collects);
  // The current alt: from the collected image (a judge may quote a shortened one), else the alt the judge quoted.
  const altOf = (o) => {
    const quoted = quotedAlt(o);
    const im = findImage(images, o.x?.pageId, o.x?.selector ?? o.scope?.locator, quoted);
    return im ? im.alt : quoted;
  };
  const byKey = new Map();
  const out = [];
  for (const g of groups) {
    const o = g.observations[0];
    const judgeOnly = g.observations.every((x) => x.x?.source === 'judge' && x.x?.suggestion != null);
    const shape = judgeOnly ? tagTail(o.x?.selector ?? o.scope?.locator) : null;
    // Same element shape and the same kind of wrong text: one problem. A different cause stays its own problem.
    const pattern = shape ? altPattern(altOf(o)) : null;
    if (!shape || !pattern) { out.push(g); continue; }
    // A brand written in lower case is not stripped ("goop project context"): patterns where one ends with the
    // other, word for word, are the same pattern.
    const base = `${o.criterion_id}|${String(g.fp).split('|')[0]}|${shape}|`;
    const same = [...byKey.keys()].find((key) => key.startsWith(base) && samePattern(key.slice(base.length), pattern));
    const k = same ?? `${base}${pattern}`;
    if (byKey.has(k)) byKey.get(k).observations.push(...g.observations);
    else { byKey.set(k, g); out.push(g); g.altPattern = pattern; g.shape = shape; }
  }
  // The same wrong text on pages a judge did not look at (a judge sees up to five pages of each type): every
  // collected image of the same shape whose alt follows the pattern is the same problem, without its own suggestion.
  // An image another finding already covers is not added a second time.
  // Keyed by the end of the path (two steps): "img" alone would make every picture of a page look covered.
  const placeKey = (pid, sel) => `${pid}|${normSel(sel).split(' > ').slice(-2).join(' > ')}`;
  const covered = new Set(groups.flatMap((g) => g.observations.map((x) => placeKey(x.x?.pageId, x.x?.selector))));
  // The same picture file described properly on other pages (a screenshot whose alt names the site on its case
  // study) is informative: where it carries the pattern's placeholder instead, the fix is that description (F30), not
  // alt="". Pages where a judge failed the file do not count as a proper description.
  const failedAt = new Set();
  for (const g of groups) for (const o of g.observations) {
    const im = findImage(images, o.x?.pageId, o.x?.selector ?? o.scope?.locator, quotedAlt(o));
    if (im?.src) failedAt.add(`${o.x.pageId}|${srcFile(im.src)}`);
  }
  const describedAs = (file, pattern) => {
    const tally = new Map();
    for (const c of collects) for (const im of c.images ?? []) {
      if (srcFile(im.src) !== file || !String(im.alt ?? '').trim() || failedAt.has(`${c.pageId}|${file}`)) continue;
      if (samePattern(altPattern(im.alt), pattern)) continue;
      tally.set(im.alt, (tally.get(im.alt) ?? 0) + 1);
    }
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  for (const g of out) {
    if (!g.altPattern) continue;
    const o = g.observations[0];
    // Only a text alternative is wrong wherever the same alt appears. Other criteria depend on more than the text:
    // a logo named "Northwind home" fails 3.1.2 on the French pages and is correct on the English ones.
    if (o.criterion_id !== '1.1.1') continue;
    const seenPages = new Set(g.observations.map((x) => x.x?.pageId));
    let n = 0;
    for (const c of collects) {
      for (const im of c.images ?? []) {
        // A picture another finding already covers is not added again; the rest of its page still counts.
        if (!im.selector || seenPages.has(c.pageId) || covered.has(placeKey(c.pageId, im.selector))) continue;
        // The same kind of element (an img, even wrapped one level deeper) with text of the same pattern.
        if (tagTail(im.selector, 1) !== g.shape.split(' > ').at(-1) || !samePattern(altPattern(im.alt), g.altPattern)) continue;
        n += 1;
        seenPages.add(c.pageId);
        const file = srcFile(im.src);
        const described = file && !file.includes('[redacted]') ? describedAs(file, g.altPattern) : null;
        const own = described
          ? { observed: `The image has the alt text "${im.alt}"; the same picture is described as "${described}" on other pages.`, suggestion: described, suggestionBasis: 'same_image', failure: 'F30' }
          : { observed: `The image has the alt text "${im.alt}", the same pattern.`, suggestion: null };
        g.observations.push({ ...o, id: `${o.id}-same-${n}`, scope: { ...o.scope, url: c.url ?? o.scope?.url, locator: im.selector }, observed: own.observed, x: { ...o.x, pageId: c.pageId, templateId: null, selector: im.selector, html: im.alt, current: im.alt, suggestion: own.suggestion, ...(own.suggestionBasis ? { suggestionBasis: own.suggestionBasis } : {}), ...(own.failure ? { failure: own.failure } : {}), propagated: true } });
      }
    }
  }
  for (const g of out) for (const o of g.observations) if (o.x?.source === 'judge' && o.x.current === undefined) o.x.current = altOf(o);
  harmonizeBySource(out, collects);
  return oneCardPerCause(oneCardPerImage(splitByFixKind(out)));
}

// One cause and one kind of change, one card, wherever on the page the pictures sit. The judges name the documented
// failure behind each picture (F39: a picture that only decorates has a text alternative; F30: the text names the
// picture instead of saying what it shows), and the fix is the same for all of them (alt="" or a description), so a
// card per page component would only repeat itself. Each picture file stays its own row in the card.
export function oneCardPerCause(groups) {
  const out = [];
  const home = new Map();
  for (const g of groups) {
    // Pictures: a judge's 1.1.1 places with a picture file, or with the alt it recommends (a picture whose file the
    // collected data did not match still has its own row).
    const pictures = g.observations.every((o) => o.x?.source === 'judge' && (o.x.src || o.x.srcUrl || o.x.propagated || (o.criterion_id === '1.1.1' && o.x.suggestion != null)));
    const kinds = new Set(g.observations.map((o) => fixKind(o.x?.suggestion) ?? o.x?.kind).filter(Boolean));
    // The kind of change is the cause the owner acts on: hide (F39, an alt on a picture that only decorates or sits in
    // a named link) or describe (F30, F65, an informative picture with no or a placeholder alt). A judge who named no
    // documented failure still gave the change.
    if (!pictures || kinds.size !== 1) { out.push(g); continue; }
    // Two reasons to hide are two causes: a picture inside a link that already has its own name, and a picture that
    // only decorates.
    const inNamedLink = g.observations.filter((o) => o.x?.linkNamed).length * 2 > g.observations.length;
    const k = `${g.observations[0].criterion_id}|${[...kinds][0]}|${[...kinds][0] === 'hide' && inNamedLink ? 'link' : 'image'}`;
    const target = home.get(k);
    if (!target) { home.set(k, g); out.push(g); continue; }
    const seen = new Set(target.observations.map((o) => o.id));
    target.observations.push(...g.observations.filter((o) => !seen.has(o.id)));
  }
  return out;
}

// The automated checks whose failures share one cause and one kind of change wherever they are: menu items with no
// focus highlight, fields without autocomplete, fields without a label, taps too small, text too faint. A card per
// element would repeat the same explanation; the card has a row per element instead (see elementRows in findings.mjs).
export const ONE_CARD_CHECKS = new Set(['focus-visible', 'autocomplete', 'form-labels', 'label', 'target-size', 'color-contrast', 'contrast-measured', 'label-in-name']);
const checkFamily = (check) => (check === 'contrast-measured' ? 'color-contrast' : check === 'label' ? 'form-labels' : check);
export function oneCardPerCheck(groups) {
  const out = [];
  const home = new Map();
  for (const g of groups) {
    const check = g.observations[0]?.x?.check;
    const automated = g.observations.every((o) => o.x?.source !== 'judge');
    if (!automated || !ONE_CARD_CHECKS.has(check)) { out.push(g); continue; }
    const k = `${g.observations[0].criterion_id}|${checkFamily(check)}`;
    const target = home.get(k);
    if (!target) { home.set(k, g); out.push(g); continue; }
    const seen = new Set(target.observations.map((o) => o.id));
    target.observations.push(...g.observations.filter((o) => !seen.has(o.id)));
  }
  return out;
}

// Hiding an image (alt="") and describing it are different fixes for different reasons, even when the wrong text
// follows one pattern: they are two problems, each with one cause and one kind of change. A place the judge did not
// see takes the kind most of its problem has; when that kind is "hide", its recommendation is alt="" as well.
export const fixKind = (s) => (s == null ? null : String(s) === '' ? 'hide' : 'replace');

export function splitByFixKind(groups) {
  const out = [];
  for (const g of groups) {
    const judged = g.observations.filter((o) => o.x?.source === 'judge');
    const kinds = new Map();
    for (const o of judged) { const k = fixKind(o.x.suggestion); if (k) kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    if (!kinds.size) { out.push(g); continue; }
    const major = [...kinds].sort((a, b) => b[1] - a[1] || (a[0] === 'hide' ? -1 : 1))[0][0];
    for (const o of judged) {
      if (o.x.suggestion != null) continue;
      o.x.kind = major;
      if (major === 'hide') { o.x.suggestion = ''; o.x.suggestionBasis = 'pattern'; }
    }
    if (kinds.size === 1) { out.push(g); continue; }
    const minor = major === 'hide' ? 'replace' : 'hide';
    const moved = g.observations.filter((o) => fixKind(o.x?.suggestion) === minor);
    g.observations = g.observations.filter((o) => !moved.includes(o));
    out.push(g, { ...g, key: issueKey(moved[0].criterion_id, `${moved[0].x?.check ?? 'judge'}|${minor}`, g.fp), observations: moved, splitFrom: g.key });
  }
  return out;
}

// One image, one card: the same picture file judged on several page types can land in two problems of the same kind
// (one alt pattern here, another there). All its places move to the problem that holds most of them.
export function oneCardPerImage(groups) {
  const where = new Map();
  for (const g of groups) {
    for (const o of g.observations) {
      if (o.x?.source !== 'judge' || !o.x.src) continue;
      const k = `${o.criterion_id}|${fixKind(o.x.suggestion) ?? o.x.kind ?? ''}|${o.x.src}`;
      const m = where.get(k) ?? new Map();
      m.set(g, (m.get(g) ?? 0) + 1);
      where.set(k, m);
    }
  }
  for (const [k, m] of where) {
    if (m.size < 2) continue;
    const [home] = [...m].sort((a, b) => b[1] - a[1] || b[0].observations.length - a[0].observations.length)[0];
    for (const g of m.keys()) {
      if (g === home) continue;
      const moving = g.observations.filter((o) => o.x?.source === 'judge' && `${o.criterion_id}|${fixKind(o.x.suggestion) ?? o.x.kind ?? ''}|${o.x.src}` === k);
      g.observations = g.observations.filter((o) => !moving.includes(o));
      home.observations.push(...moving);
    }
  }
  return groups.filter((g) => g.observations.length);
}

// One picture file, one recommendation. Judges of different page types see the same photo separately and can word it
// differently, or one may call it decorative and another not; the owner gets one answer per image. The most frequent
// recommendation wins, a high-confidence one breaks a tie, then the page crawled first (page ids are numbered in
// crawl order). An image found on a page no judge looked at gets the recommendation made for the same file elsewhere.
export function harmonizeBySource(groups, collects = []) {
  const images = imageIndex(collects);
  // A lazy-loaded picture not yet loaded shows a data: placeholder, which names no file. The same element (same alt,
  // same end of the selector) loaded on another page names it: the footer logo is one picture on every page.
  const loaded = [...images.values()].flat().filter((im) => im.src && !/^data:/i.test(im.src));
  const realSrc = (im) => {
    if (!im?.src) return null;
    if (!/^data:/i.test(im.src)) return im.src;
    const shape = normSel(im.selector).split(' > ').slice(-2).join(' > ');
    return loaded.find((x) => x.alt === im.alt && x.sel.endsWith(shape))?.src ?? null;
  };
  const srcOf = (o) => realSrc(findImage(images, o.x?.pageId, o.x?.selector ?? o.scope?.locator, o.x?.current ?? quotedAlt(o)));
  // A picture inside a link or button that already has its own name (aria-label="Go to homepage") is never read: the
  // name replaces it. The W3C decision tree makes it alt="", whatever words a judge proposed for it.
  const linksByPage = new Map(collects.map((c) => [c.pageId, [...(c.links ?? []), ...(c.buttons ?? [])]]));
  const plain = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  for (const o of groups.flatMap((g) => g.observations)) {
    if (o.x?.source !== 'judge' || o.criterion_id !== '1.1.1' || o.x.suggestion == null) continue;
    const im = findImage(images, o.x.pageId, o.x.selector ?? o.scope?.locator, o.x.current ?? quotedAlt(o));
    if (!im?.inLink) continue;
    // The picture's parent path, matched from either end: the two selectors are cut at different depths.
    const parent = normSel(im.selector).split(' > ').slice(0, -1).join(' > ');
    const link = (linksByPage.get(o.x.pageId) ?? []).map((l) => ({ ...l, sel: normSel(l.selector) }))
      .filter((l) => l.sel && parent && (l.sel === parent || l.sel.endsWith(` > ${parent}`) || parent.endsWith(` > ${l.sel}`)))
      .sort((a, b) => b.sel.length - a.sel.length)[0];
    const own = plain(link?.name);
    if (!own || (im.alt && own.includes(plain(im.alt)))) continue;
    o.x.linkNamed = link.name;
    if (o.x.suggestion === '') continue;
    o.x.suggestionReplaced = o.x.suggestion;
    o.x.suggestion = '';
  }
  const bySrc = new Map();
  for (const g of groups) {
    for (const o of g.observations) {
      if (o.x?.source !== 'judge') continue;
      const url = srcOf(o);
      if (!url) continue;
      o.x.srcUrl = url;
      o.x.src = srcFile(url);
      // A file name hidden by redaction says nothing about which picture it is: no grouping by it.
      if (!o.x.src || o.x.src.includes('[redacted]')) { o.x.src = null; continue; }
      const k = `${o.criterion_id}|${o.x.src}`;
      bySrc.set(k, [...(bySrc.get(k) ?? []), o]);
    }
  }
  for (const o of groups.flatMap((g) => g.observations)) {
    if (o.x?.source === 'judge' && o.x.suggestion != null && !o.x.propagated) o.x.suggestionBasis = 'judge';
  }
  // Page ids compare as numbers: "p1000" was crawled after "p999".
  const byPage = (a, b) => String(a.x.pageId).localeCompare(String(b.x.pageId), 'en', { numeric: true });
  const rank = (a, b) => b[1].n - a[1].n || b[1].high - a[1].high || byPage(a[1].first, b[1].first);
  const tallyBy = (list, keyOf) => {
    const tally = new Map();
    for (const o of list) {
      const s = keyOf(o);
      const v = tally.get(s) ?? { n: 0, high: 0, first: o };
      v.n += 1;
      if (byPage(o, v.first) < 0) v.first = o;
      // A judge's confidence is "high" or "medium" (judge.mjs refuses anything else), and "high" when left out.
      if (o.x.confidence !== 'medium') v.high += 1;
      tally.set(s, v);
    }
    return [...tally].sort(rank)[0][0];
  };
  for (const list of bySrc.values()) {
    const given = list.filter((o) => o.x.suggestion != null && !o.x.propagated);
    if (!given.length) continue;
    // First whether the picture needs words at all, by a majority of the judges who saw it; only then which words.
    // Voting on the exact wording would let two judges who describe it in different words lose to one who hides it.
    const kind = tallyBy(given, (o) => fixKind(o.x.suggestion));
    const winner = tallyBy(given.filter((o) => fixKind(o.x.suggestion) === kind), (o) => String(o.x.suggestion));
    for (const o of list) {
      if (o.x.suggestion === winner) continue;
      if (o.x.suggestion != null && !o.x.propagated) o.x.suggestionReplaced = o.x.suggestion;
      o.x.suggestion = winner;
      o.x.suggestionBasis = 'same_image';
    }
  }
}

// A data: URI is a placeholder or an inline picture, not a file anyone can look up: it names nothing.
export const srcFile = (url) => (/^data:/i.test(String(url ?? '')) ? null : String(url ?? '').split('/').pop().split('?')[0].split('#')[0] || null);

// Two patterns of wrong text are the same when one ends with the other ("goop project context" / "project context"),
// or when both are short and end in the same word ("project context" / "studio shown as client context").
export function samePattern(a, b) {
  if (!a || !b) return false;
  if (a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`)) return true;
  const wa = a.split(' ');
  const wb = b.split(' ');
  return wa.length <= 5 && wb.length <= 5 && wa.at(-1) === wb.at(-1);
}

export function foldReviews(groups) {
  const byKey = new Map();
  for (const g of groups) {
    const k = reviewKey(g);
    if (byKey.has(k)) byKey.get(k).observations.push(...g.observations);
    else byKey.set(k, g);
  }
  return [...byKey.values()];
}

// An aria-label or aria-labelledby on a plain container (a div or span without a role) is ignored by assistive
// technology. It is not a WCAG failure: 4.1.2 is about interactive components, and 1.3.1 asks only that what is shown
// is also in the code. A label for a group is either a visible heading (still there for everyone) or words that were
// never shown. Interactive elements stay for a decision. Automated scanners still report it, so
// the report lists it as a tool note with its one-line fix instead of dropping it without a word.
const INTERACTIVE = /^<(a|button|input|select|textarea|summary|details)\b|\b(tabindex|role=["'](button|link|checkbox|radio|tab|menuitem|switch|slider|combobox|textbox))/i;
// An ID reference (aria-controls, aria-describedby…) naming an element that is not on the page: W3C ACT rule 6a7281
// does not ask for the referenced element to exist (a menu panel may be added only when opened), and the control keeps
// its name, role and state. Untidy code, not a failure.
const IDREF = /^aria-(controls|owns|activedescendant|describedby|labelledby|details|errormessage|flowto)$/;
export const idrefOnly = (o) => {
  if (o.x?.check !== 'aria-valid-attr-value') return false;
  const said = `${o.observed ?? ''} ${o.x?.description ?? ''} ${o.x?.measured?.failureSummary ?? ''}`;
  const attrs = [...said.matchAll(/\b(aria-[a-z]+)="/g)].map((m) => m[1]);
  return attrs.length > 0 && attrs.every((a) => IDREF.test(a));
};
const isToolNote = (o) => (o.x?.source === 'axe' && o.status === 'needs_review'
  && o.x.check === 'aria-prohibited-attr' && !INTERACTIVE.test(String(o.x.html ?? ''))) || idrefOnly(o);

// A code sample short enough to read: the opening tag whole when it fits, else cut at a space and marked with "…",
// never mid-attribute.
export function codeSample(html, max = 240) {
  // Never the review's own markers (data-wr-*), which a test set on the element: they are not the site's markup.
  const s = String(html ?? '').replace(/\s+data-wr[\w-]*(="[^"]*")?/g, '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const tag = s.slice(0, s.indexOf('>') + 1);
  if (tag && tag.length <= max) return `${tag}…`;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2))}…`;
}

export function toolNotes(observations) {
  const byCheck = new Map();
  for (const o of observations) {
    if (!isToolNote(o)) continue;
    const list = byCheck.get(o.x.check) ?? [];
    if (!list.some((x) => x.url === o.scope?.url && x.selector === o.x.selector)) {
      list.push({ pageId: o.x.pageId, url: o.scope?.url ?? null, selector: o.x.selector ?? null, html: codeSample(o.x.html) });
    }
    byCheck.set(o.x.check, list);
  }
  const code = { 'aria-prohibited-attr': 'aria_name_on_generic', 'aria-valid-attr-value': 'aria_idref_missing' };
  return [...byCheck].map(([check, instances]) => ({ check, code: code[check], count: instances.length, instances }));
}

// Tool notes found while measuring each page (see pageNotes in measure.mjs), one entry per kind with every place.
export function pageToolNotes(measured = []) {
  const byCode = new Map();
  for (const m of measured) {
    for (const n of m.notes ?? []) {
      const list = byCode.get(n.code) ?? [];
      if (!list.some((x) => x.url === m.url && x.selector === n.selector)) list.push({ pageId: m.pageId, url: m.url, selector: n.selector ?? null, html: codeSample(n.html), detail: n.detail ?? null });
      byCode.set(n.code, list);
    }
  }
  return [...byCode].map(([code, instances]) => ({ check: code, code, count: instances.length, instances }));
}

// States reached by the pointer or the keyboard, in which an element's colours differ from the page at rest.
const INTERACTION_STATE = /^(hover|keyboard-focus)$/;

// Automated results that could not decide are replaced by the measurement that settled them: text over an image
// whose contrast was measured, links in text that were checked for more than colour, names compared with labels.
export function dropSettled(observations) {
  const settledTargets = new Set();
  const settledPages = new Set();
  const overturned = new Set();
  for (const o of observations) {
    const st = o.x?.measured?.settled;
    if (!st) continue;
    for (const t of st.targets ?? []) settledTargets.add(`${o.x.pageId}|${t}`);
    for (const t of st.overturned ?? []) overturned.add(`${o.x.pageId}|${t}`);
    settledPages.add(o.x.pageId);
  }
  const SETTLED_BY_PAGE = new Set(['link-in-text-block', 'label-content-name-mismatch']);
  // The rule's tap-size test uses boxes (a round button's corners "cover" its neighbour); the deep check measured the
  // targets on the page and found them large enough or spaced: that settles the rule's open question there.
  const sizedPages = new Set(observations.filter((o) => o.x?.source === 'deep' && o.x?.check === 'target-size' && o.status === 'pass').map((o) => o.x.pageId));
  return observations.filter((o) => {
    // The rule's result comes from the page as loaded (source axe) or from a window state (a deep record "only in the
    // … state").
    const ruleResult = o.x?.source === 'axe' || /\(only in the "[^"]*" state\)/.test(String(o.observed ?? ''));
    if (o.status === 'needs_review' && ruleResult && o.x?.check === 'target-size' && sizedPages.has(o.x.pageId)) return false;
    // A contrast failure whose text, measured on screen, reaches the required contrast against every part of what is
    // behind it (the same element in another window state has the same colours). Not one found with the pointer over
    // it or keyboard focus on it: those states change the colours, and were measured on screen in that state.
    if (o.status === 'fail' && o.x?.check === 'color-contrast' && overturned.has(`${o.x.pageId}|${o.x.selector}`) && !INTERACTION_STATE.test(o.scope?.state ?? '')) return false;
    if (o.status !== 'needs_review' || o.x?.source !== 'axe') return true;
    if (isToolNote(o)) return false;
    if (o.x.check === 'color-contrast') return !settledTargets.has(`${o.x.pageId}|${o.x.selector}`);
    if (SETTLED_BY_PAGE.has(o.x.check)) return !settledPages.has(o.x.pageId);
    return true;
  });
}

export function mergeObservations({ observations: raw, pages, templates, collects, level, judgedTemplates = [], refusedTemplates = [] }) {
  const observations = dropSettled(foldSameAs(raw)).filter((o) => !idrefOnly(o));
  const reviewed = pages.filter(isReviewed);
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const templatesById = new Map(templates.map((t) => [t.id, t]));
  const journeys = buildJourneys(pages, templates, collects);
  const ctx = { pageById, reviewedCount: reviewed.length, keyPageIds: keyPages(reviewed, collects, templates), taskPageIds: taskPages(reviewed, collects, templates), journeys, templatesById };

  const fails = sortIssues(oneCardPerCheck(foldJudgeFails(foldCrossSource(groupObservations(observations, 'fail'), reviewed.length), collects)).map((g) => toIssue(g, { ...ctx, status: 'fail' })));
  const failComponents = new Set(fails.map((i) => `${i.criteria.primary}|${i.component.fingerprint}`));
  // An open question about something already confirmed broken adds nothing for the owner.
  const reviews = sortIssues(foldReviews(groupObservations(observations, 'needs_review'))
    .map((g) => toIssue(g, { ...ctx, status: 'needs_review' }))
    .filter((r) => !failComponents.has(`${r.criteria.primary}|${r.component.fingerprint}`)));

  const criteriaStatus = criteriaStatuses({ observations, fails, reviews, level, templates, judgedTemplates, refusedTemplates });
  return { issues: [...fails, ...reviews], criteriaStatus, journeys, toolNotes: toolNotes(raw) };
}

function criteriaStatuses({ observations, fails, reviews, level, templates, judgedTemplates, refusedTemplates = [] }) {
  const coverage = readJson(path.join(REFS_DIR, 'coverage.json'), {});
  const deepTemplates = templates.filter((t) => t.deep && !refusedTemplates.includes(t.id)).map((t) => t.id);
  const out = [];
  for (const c of allCriteria()) {
    const cov = coverage[c.id] ?? {};
    const row = { id: c.id, name: c.name, level: c.level, principle: c.principle, in_profile: inProfile(c.id, level), status: 'not_tested', issueKeys: [], reviewKeys: [], methods: [], reason: null };
    if (!row.in_profile) { out.push(row); continue; }
    row.issueKeys = fails.filter((i) => i.criteria.primary === c.id || i.criteria.related.includes(c.id)).map((i) => i.key);
    row.reviewKeys = reviews.filter((i) => i.criteria.primary === c.id || i.criteria.related.includes(c.id)).map((i) => i.key);
    const obs = observations.filter((o) => o.criterion_id === c.id || (o.related_criteria ?? []).includes(c.id));
    row.methods = [...new Set(obs.map((o) => issueMethod(o)))];
    if (row.issueKeys.length) row.status = 'fail';
    else if (row.reviewKeys.length) row.status = 'needs_review';
    else if (passEstablished(c.id, cov, obs, deepTemplates, judgedTemplates)) row.status = 'pass';
    else if (notApplicable(obs, judgedTemplates, deepTemplates)) {
      row.status = 'not_applicable';
      const site = obs.find((o) => o.status === 'not_applicable' && o.x?.source === 'collect');
      row.reason = site ? site.applicability.reason : 'Does not occur on any of the ' + judgedTemplates.length + ' page types reviewed.';
      row.noteCode = 'not_applicable';
    } else {
      row.status = 'not_tested';
      const autoRan = obs.some((o) => o.x?.source === 'axe');
      row.reason = cov.notTestedReason || 'No check in this review could settle this requirement.';
      row.noteCode = autoRan ? 'auto_clean' : 'coverage';
    }
    out.push(row);
  }
  return out;
}

// "Does not apply" for the whole review: the collectors found no such content on any page, or every page type that
// was reviewed said so. One page type without video says nothing about the others.
function notApplicable(obs, judgedTemplates, deepTemplates = []) {
  if (obs.some((o) => o.status === 'pass' || o.status === 'fail' || o.status === 'needs_review')) return false;
  if (obs.some((o) => o.status === 'not_applicable' && (o.x?.source === 'collect' || o.x?.source === 'site'))) return true;
  // Every page type examined, by a judge or by a deep check, found none of the content the criterion is about.
  const na = (tid) => obs.some((o) => o.status === 'not_applicable' && o.x?.templateId === tid);
  const all = (tids) => tids.length > 0 && tids.every(na);
  return all(judgedTemplates) || all(deepTemplates);
}

// A pass needs every template that was examined in depth to have exercised the requirement with a method that can
// establish a pass (deep check or judge). Silence from the scanner never counts.
function passEstablished(sc, cov, obs, deepTemplates, judgedTemplates) {
  const capable = String(cov.passCapable ?? 'none');
  if (capable === 'none') return false;
  const passes = obs.filter((o) => o.status === 'pass');
  if (!passes.length) return false;
  // Site-wide comparisons (navigation order, names, help, ways to a page) settle the requirement for the whole site.
  if (capable === 'site') return passes.some((o) => o.x?.source === 'site');
  // A page type where the requirement does not apply (no video on the contact page) does not stand in the way.
  const settled = obs.filter((o) => o.status === 'pass' || o.status === 'not_applicable');
  const byDeep = (tid) => settled.some((o) => o.x?.source === 'deep' && o.x?.templateId === tid);
  const byJudge = (tid) => settled.some((o) => o.x?.source === 'judge' && o.x?.templateId === tid);
  const needDeep = capable.includes('deep');
  const needJudge = capable.includes('judge');
  const deepOk = !needDeep || (deepTemplates.length > 0 && deepTemplates.every(byDeep));
  const judgeOk = !needJudge || (judgedTemplates.length > 0 && judgedTemplates.every(byJudge));
  return deepOk && judgeOk;
}
