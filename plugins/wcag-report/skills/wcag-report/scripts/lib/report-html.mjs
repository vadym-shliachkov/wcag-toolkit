// report.json + UI strings → print HTML. Pure: no file reads except through the arguments, so it is easy to test.
// Reading order = DOM order (the PDF is tagged from it): nothing is moved with CSS order or absolute positioning
// except the decorative screenshot overlays.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { groupIcon, sevGlyph, GROUP_IDS } from './icons.mjs';
import { claimsAccessibility } from './claims.mjs';

const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];
const WEIGHT = { critical: 8, serious: 4, moderate: 2, minor: 1 };
const PRINCIPLES = ['perceivable', 'operable', 'understandable', 'robust'];
const VERDICT_TONE = { serious_barriers: 'critical', significant_barriers: 'serious', barriers: 'moderate', none_confirmed: 'open', none_found: 'pass' };

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A string for a CSS `content:` value.
export function cssString(s) {
  return `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`;
}

// When much of the text (e.g. quoted site labels) is in a script Atkinson Hyperlegible does not cover (Cyrillic,
// Greek…), the whole text font switches to Noto Sans, so words never mix fonts.
export function usesNonLatinFont(sampleText = '') {
  const letters = sampleText.match(/\p{L}/gu) ?? [];
  if (letters.length < 50) return false;
  const outside = letters.filter((c) => !/[\u0000-ɏḀ-ỿ]/.test(c)).length;
  return outside / letters.length > 0.05;
}

export function buildReportHtml({ report, strings, baseDir, templateHtml, css, fontsCss, fontsDir, draft = false }) {
  const { t, tn } = strings;
  const lang = report.report.language || 'en';
  const nf = new Intl.NumberFormat(lang);
  const n = (x) => nf.format(x ?? 0);
  const dateLabel = formatDate(report.report.generated_at, t('meta.date_format') || lang);
  const fileUrl = (rel) => (rel ? pathToFileURL(path.resolve(baseDir, rel)).href : '');
  const fix = Boolean(report.report.options?.fix);
  const issuesById = new Map(report.issues.map((i) => [i.id, i]));
  const reviewById = new Map(report.review_items.map((r) => [r.id, r]));
  const pagesReviewed = report.scope.pages_reviewed;
  let figureNo = 0;

  const ctx = { t, tn, n, esc, lang, fix, draft, fileUrl, issuesById, reviewById, pagesReviewed, nextFigure: () => ++figureNo, report };

  const body = [
    cover(ctx, dateLabel),
    glance(ctx),
    priorities(ctx),
    journeys(ctx),
    howToRead(ctx),
    issuesSection(ctx),
    report.review_items.length ? reviewSection(ctx) : '',
    templatesSection(ctx),
    criteriaSection(ctx),
    cleanupSection(ctx),
    limitsSection(ctx),
    methodSection(ctx),
    glossarySection(ctx),
    pagesAppendix(ctx),
  ].join('\n');

  const sample = [report.verdict.summary, ...report.issues.slice(0, 5).map((i) => `${i.title} ${i.observed}`)].join(' ');
  const pageCss = namedPageCss(ctx, dateLabel);
  const fontVars = usesNonLatinFont(sample)
    ? ':root { --font-text: "Noto Sans", "Segoe UI", Arial, sans-serif; --font-mono: "Noto Sans Mono", Consolas, monospace; }'
    : '';
  const fonts = fontsCss.replace(/url\("fonts\//g, `url("${pathToFileURL(fontsDir).href}/`);
  return templateHtml
    .replace('{{lang}}', esc(lang))
    .replace('{{title}}', esc(t('meta.doc_title', { site: report.site.name })))
    .replace('{{subject}}', esc(`${t('meta.doc_kind')} · ${t('meta.standard', { level: report.report.profile })}`))
    .replace('{{fonts}}', () => fonts)
    .replace('{{css}}', () => css)
    .replace('{{pageCss}}', () => `${pageCss}\n${fontVars}`)
    .replace('{{draftClass}}', draft ? 'draft' : '')
    .replace('{{body}}', () => body);
}

function formatDate(iso, locale) {
  const d = iso ? new Date(iso) : new Date();
  try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d); } catch { return d.toISOString().slice(0, 10); }
}

// Running headers per named page, localised; Chrome has no string-set, so each part is a named page.
// A draft carries no stamp inside the document: only its file name (-DRAFT) says it is a draft.
function namedPageCss({ t, report }, dateLabel) {
  // A local copy has no address the client knows: its headers carry the site's name.
  const host = siteHost(report) || report.site.name || hostOf(report.site.url);
  const footer = t('meta.footer', { site: host, date: dateLabel });
  const pageOf = `${cssString(`${t('meta.page_word')} `)} counter(page) ${cssString(` ${t('meta.of_word')} `)} counter(pages)`;
  const parts = { front: 'running.front', issues: 'running.issues', review: 'running.review', reference: 'running.reference', appendix: 'running.appendix' };
  const named = Object.entries(parts).map(([name, key]) => `@page ${name} { @top-left { content: ${cssString(t(key))}; } }`).join('\n');
  return `@page { @top-right { content: ${cssString(host)}; } @bottom-left { content: ${cssString(footer)}; } @bottom-right { content: ${pageOf}; } }
${named}`;
}

// The site's public host, or null for a local copy or a repository (no address the client would recognise).
const siteHost = (report) => (/^https?:/.test(String(report.site.url ?? '')) ? hostOf(report.site.url) : null);

function hostOf(url) {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return String(url ?? ''); }
}

// "https://example.com/shop/item?x=1" → "/shop/item?x=1"; non-URLs (repo paths) stay as they are.
function shortUrl(url) {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}`;
    // The home page as "/" alone is a link with no meaning when read out; its site name says where it goes.
    if (p === '/') return `${u.host.replace(/^www\./, '')}/`;
    return p.length > 60 ? `${p.slice(0, 28)}…${p.slice(-28)}` : p;
  } catch { return String(url ?? ''); }
}

// A file name or path wraps only after its separators (/ - _ .), never in the middle of a word, so a developer can
// still read and search it in a narrow column.
function breakable(s) {
  return esc(s).replace(/([/_.-])(?=[^/_.-])/g, '$1<wbr>');
}

function urlLink(url, text = shortUrl(url)) {
  return /^https?:/.test(url ?? '') ? `<a class="url" href="${esc(url)}">${breakable(text)}</a>` : `<span class="url">${breakable(text)}</span>`;
}

function sevTag({ t }, sev, withHint = true) {
  return `<span class="sev-tag sev-${sev}">${sevGlyph(sev)}<span class="sev-word">${esc(t(`severity.${sev}`))}</span>${withHint ? `<span class="sev-hint"><span class="sep">·</span>${esc(t(`severity.${sev}_hint`))}</span>` : ''}</span>`;
}

function idLink(id) {
  return `<a class="id-link" href="#${esc(id)}">${esc(id)}</a>`;
}

function idList(ids) {
  return (ids ?? []).length ? ids.map(idLink).join(', ') : '<span class="muted">—</span>';
}

function groupChip({ t }, g, short = true) {
  return `<span class="gchip">${groupIcon(g)}<span>${esc(t(`groups.${g}${short ? '_short' : ''}`))}</span></span>`;
}

function reachText(ctx, where) {
  const { t, n } = ctx;
  const total = where.pages_reviewed ?? ctx.pagesReviewed;
  if (where.pages_likely && where.pages_likely > where.pages_confirmed) {
    return t(where.pages_confirmed === 1 ? 'issues.reach_likely' : 'issues.reach_likely_many', { n: n(where.pages_confirmed), likely: n(where.pages_likely), total: n(total) });
  }
  if (where.scope === 'site_wide' && where.pages_confirmed >= total) return t('issues.reach_site_wide', { total: n(total) });
  return t('issues.reach_measured', { n: n(where.pages_confirmed), total: n(total) });
}

function reachMeter(ctx, where) {
  const total = Math.max(1, where.pages_reviewed ?? ctx.pagesReviewed);
  const confirmed = Math.min(100, (100 * (where.pages_confirmed ?? 0)) / total);
  const likely = Math.min(100, (100 * (where.pages_likely ?? 0)) / total);
  return `<span class="meter" aria-hidden="true">${likely > confirmed ? `<i class="likely" style="width:${likely.toFixed(1)}%"></i>` : ''}<i style="width:${confirmed.toFixed(1)}%"></i></span>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cover

function cover(ctx, dateLabel) {
  const { t, tn, n, report, fileUrl } = ctx;
  const tone = VERDICT_TONE[report.verdict.label];
  const c = report.verdict.conformance;
  const conformance = c.status === 'does_not_meet'
    ? t(c.failing_criteria === 1 ? 'verdict.does_not_meet_one' : 'verdict.does_not_meet', { level: report.report.profile, n: n(c.failing_criteria) })
    : t('verdict.not_established', { open: n(c.open_criteria), untested: n(c.untested_criteria) });
  const cap = report.scope.cap_reached ? t('verdict.coverage_cap', { max: n(report.scope.max_pages) }) : '';
  const coverage = t('verdict.coverage', {
    pages: n(report.scope.pages_reviewed), found: n(report.scope.pages_discovered), cap,
    deep: n(report.scope.templates_deep), date: dateLabel,
    journeys: tn('verdict.journeys', report.scope.journeys_tested ?? report.journeys.filter((j) => j.tested).length),
  });
  const shot = report.site.home_shot;
  const tot = report.totals;
  const tiles = [
    [t('cover.tile_pages'), n(report.scope.pages_reviewed), t('cover.tile_pages_note', { found: n(report.scope.pages_discovered) }), ''],
    [t('cover.tile_problems'), n(tot.issues.total ?? sum(tot.issues)), tot.review_items.total ? t('cover.tile_problems_note', { review: n(tot.review_items.total) }) : t('cover.tile_problems_note_none'), ''],
    [t('cover.tile_blockers'), n(tot.issues.critical), t('cover.tile_blockers_note'), tot.issues.critical ? 'critical' : ''],
    [t('cover.tile_blocked_pages'), n(tot.pages_with_blocker), t('cover.tile_blocked_pages_note', { pages: n(report.scope.pages_reviewed) }), tot.pages_with_blocker ? 'critical' : ''],
  ];
  return `<section class="cover" aria-labelledby="doc-title">
  <div class="cover-bar"></div>
  <div class="cover-inner">
    <div class="cover-head">
      <div class="cover-title">
        <p class="kicker">${esc(t('cover.kicker'))}</p>
        <h1 id="doc-title">${esc(report.site.name)}</h1>
        ${siteHost(report) ? `<p class="cover-url">${urlLink(report.site.url, report.site.url)}</p>` : ''}
        <p class="cover-meta">${esc(t('meta.standard', { level: report.report.profile }))}<br>${esc(t('cover.reviewed_on', { date: dateLabel }))}</p>
      </div>
      ${shot ? `<div class="browser"><div class="browser-bar" aria-hidden="true"><i></i><i></i><i></i><span>${esc(siteHost(report) || report.site.name)}</span></div><img src="${esc(fileUrl(shot.file))}" width="${shot.width}" height="${shot.height}" alt="${esc(t('cover.home_alt', { site: report.site.name }))}"></div>` : ''}
    </div>
    <div class="verdict tone-${tone}">
      <h2 class="verdict-label">${SEVERITIES.includes(tone) ? sevGlyph(tone) : ''}${esc(t(`verdict.${report.verdict.label}`, { n: n(report.totals.review_items.total) }))}</h2>
      <p class="verdict-headline">${esc(report.verdict.headline)}</p>
      <p class="verdict-summary">${esc(report.verdict.summary)}</p>
      <p class="conformance"><strong>${esc(conformance.split(':')[0])}:</strong>${esc(conformance.slice(conformance.indexOf(':') + 1))}</p>
      <p class="coverage">${esc(coverage)}</p>
      <p class="next-step"><strong>${esc(t('verdict.next_label'))}</strong> ${esc(t(`verdict.${report.issues.length ? 'next' : 'next_none'}${report.review_items.length ? '' : '_decided'}`))}</p>
    </div>
    <ul class="tiles" role="list">
      ${tiles.map(([label, value, note, sev]) => `<li class="tile${sev ? ` tile-${sev}` : ''}"><span class="tile-label">${esc(label)}</span><span class="tile-value">${sev ? sevGlyph(sev) : ''}${esc(value)}</span><span class="tile-note">${esc(note)}</span></li>`).join('')}
    </ul>
    <p class="not-cert">${esc(t('cover.not_cert'))} ${esc(t('cover.not_covered', { list: (report.limits?.gaps ?? []).map((g) => g.area.charAt(0).toLowerCase() + g.area.slice(1)).concat(t('cover.not_covered_at')).join(', ') }))}</p>
  </div>
</section>`;
}

function sum(counts) {
  return SEVERITIES.reduce((s, k) => s + (counts?.[k] ?? 0), 0);
}

// ---------------------------------------------------------------------------------------------------------------
// At a glance

function sortedGroups(report) {
  const byId = new Map(report.groups.map((g) => [g.id, g]));
  return GROUP_IDS.map((id) => byId.get(id) ?? { id, counts: { critical: 0, serious: 0, moderate: 0, minor: 0 }, issue_ids: [] })
    .map((g) => ({ ...g, weight: SEVERITIES.reduce((s, k) => s + WEIGHT[k] * (g.counts[k] ?? 0), 0), total: sum(g.counts) }))
    .sort((a, b) => b.weight - a.weight || GROUP_IDS.indexOf(a.id) - GROUP_IDS.indexOf(b.id));
}

function glance(ctx) {
  const { t, n, report } = ctx;
  const groups = sortedGroups(report);
  const maxTotal = Math.max(1, ...groups.map((g) => g.total));
  const rows = groups.map((g, i) => {
    const top = i === 0 && g.weight > 0;
    if (!g.total) {
      // Open questions for this group are not a pass: the row says so, without the green "all clear".
      const open = g.review_ids?.length ?? 0;
      return open
        ? `<tr class="none"><th scope="row">${groupChip(ctx, g.id, false)}</th><td colspan="6" class="muted">${esc(t(open === 1 ? 'glance.no_barrier_open_one' : 'glance.no_barrier_open', { n: n(open) }))}</td></tr>`
        : `<tr class="none"><th scope="row">${groupChip(ctx, g.id, false)}</th><td colspan="6" class="pass-text">${esc(t('glance.no_barrier'))}</td></tr>`;
    }
    const bar = SEVERITIES.filter((s) => g.counts[s]).map((s) => `<i class="fill-${s}" style="width:${((100 * g.counts[s]) / maxTotal).toFixed(1)}%"></i>`).join('');
    return `<tr${top ? ' class="top"' : ''}><th scope="row">${groupChip(ctx, g.id, false)}${top ? ` <span class="most">${esc(t('glance.most_affected'))}</span>` : ''}</th>
      <td class="bar-cell"><span class="stack" aria-hidden="true">${bar}</span></td>
      ${SEVERITIES.map((s) => `<td class="num${g.counts[s] ? '' : ' zero'}">${n(g.counts[s])}</td>`).join('')}
      <td class="num total">${n(g.total)}</td></tr>`;
  }).join('\n');

  // Distinct pages where a problem of this severity was seen (from the page list, so it agrees with the appendix).
  const sevPages = (s) => {
    const ids = new Set(report.issues.filter((x) => x.severity === s).map((x) => x.id));
    return report.pages.filter((p) => p.load_status === 'ok' && (p.issue_ids ?? []).some((id) => ids.has(id))).length;
  };
  const sevTiles = SEVERITIES.map((s) => {
    const count = report.totals.issues[s] ?? 0;
    const pages = sevPages(s);
    return `<li class="stile sev-${s}"><span class="stile-head">${sevGlyph(s)}<span>${esc(t(`severity.${s}`))}</span></span><span class="stile-num">${n(count)}</span><span class="stile-note">${esc(t(`severity.${s}_hint`))}${count ? ` · ${esc(t(pages === 1 ? 'glance.severity_on_page' : 'glance.severity_on_pages', { n: n(pages) }))}` : ''}</span></li>`;
  }).join('');

  const principleTiles = PRINCIPLES.map((p) => {
    const crit = report.criteria.filter((c) => c.principle === p && c.in_profile);
    // Each problem once, under its main requirement, so the four tiles add up to the total.
    const problems = report.issues.filter((i) => crit.some((c) => c.id === i.criteria.primary?.id)).length;
    const squares = crit.map((c) => `<span class="sq sq-${c.status}" title="${esc(`${c.id} ${t(`status.${c.status}`)}`)}"></span>`).join('');
    // Requirements still to check are not a clean result: say so, without the green of a pass.
    const open = crit.filter((c) => c.status === 'needs_review').length;
    const label = problems ? t(problems === 1 ? 'glance.principle_problem' : 'glance.principle_problems', { n: n(problems) })
      : open ? t(open === 1 ? 'glance.principle_open_one' : 'glance.principle_open', { n: n(open) }) : t('glance.principle_none');
    return `<li class="ptile"><span class="ptile-name">${esc(t(`principles.${p}`))}</span><span class="ptile-q">${esc(t(`principles.${p}_q`))}</span><span class="ptile-count${problems || open ? '' : ' pass-text'}">${esc(label)}</span><span class="grid" aria-hidden="true">${squares}</span></li>`;
  }).join('');
  // Only the results that occur: a legend entry for a state no requirement is in reads like a gap.
  const legend = ['fail', 'needs_review', 'pass', 'not_applicable', 'not_tested'].filter((st) => report.criteria.some((c) => c.in_profile && c.status === st))
    .map((s) => `<li><span class="sq sq-${s}" aria-hidden="true"></span>${esc(t(`status.${s}`))}</li>`).join('');

  return `<section class="glance front" aria-labelledby="glance-h">
  <h2 id="glance-h">${esc(t('glance.heading'))}</h2>
  <p class="lead">${esc(t('glance.lead'))}</p>
  <h3 class="first">${esc(t('glance.severity_heading'))}</h3>
  <ul class="stiles" role="list">${sevTiles}</ul>
  <h3>${esc(t('glance.who_heading'))}</h3>
  <table class="barrier">
    <caption>${esc(t('glance.who_caption'))}</caption>
    <thead><tr><th scope="col">${esc(t('glance.col_group'))}</th><th scope="col"><span class="sr-only">${esc(t('glance.col_bar'))}</span></th>${SEVERITIES.map((s) => `<th scope="col" class="num sev-col sev-${s}" title="${esc(t(`severity.${s}`))}">${sevGlyph(s)}<span class="sr-only">${esc(t(`severity.${s}`))}</span></th>`).join('')}<th scope="col" class="num">${esc(t('glance.col_total'))}</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="keep">
  <h3>${esc(t('glance.principles_heading'))}</h3>
  <p class="small muted">${esc(t('glance.principles_lead'))}</p>
  <ul class="ptiles" role="list">${principleTiles}</ul>
  <ul class="legend" aria-label="${esc(t('glance.grid_legend'))}">${legend}</ul>
  </div>
</section>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Fix these first

// "Block a task or make it very hard" only when every row does; a short list of those followed by minor problems says so.
function prioLead(ctx, items) {
  const { t, tn, n } = ctx;
  const top = items.filter((i) => ['critical', 'serious'].includes(i.severity)).length;
  if (!items.length || top === items.length) return t('priorities.lead');
  if (!top) return t('priorities.lead_minor');
  return tn('priorities.lead_mixed', top, { n: n(top) });
}

function priorities(ctx) {
  const { t, report, issuesById, reviewById } = ctx;
  const items = (report.priorities.issue_ids ?? []).map((id) => issuesById.get(id)).filter(Boolean);
  const soon = (report.priorities.check_soon ?? []).map((id) => reviewById.get(id)).filter(Boolean);
  const rows = items.map((i, k) => `<tr class="sev-${i.severity}">
    <td class="rank">${k + 1}</td>
    <td><a class="prio-title" href="#${esc(i.id)}"><span class="issue-id">${esc(i.id)}</span> ${esc(i.title)}</a></td>
    <td class="who-cell">${[...new Set(i.impacts.map((m) => m.group))].map((g) => groupChip(ctx, g)).join('')}</td>
    <td class="reach-cell">${esc(reachText(ctx, i.where))}</td>
    <td>${sevTag(ctx, i.severity, false)}</td></tr>`).join('\n');
  return `<section class="priorities front${items.length ? '' : ' short'}" aria-labelledby="prio-h">
  <h2 id="prio-h">${esc(t('priorities.heading'))}</h2>
  <p class="lead">${esc(report.priorities.reason || prioLead(ctx, items))}</p>
  ${items.length ? `<table class="prio">
    <thead><tr><th scope="col" class="rank">${esc(t('priorities.col_rank'))}</th><th scope="col">${esc(t('priorities.col_problem'))}</th><th scope="col">${esc(t('priorities.col_who'))}</th><th scope="col">${esc(t('priorities.col_reach'))}</th><th scope="col">${esc(t('priorities.col_severity'))}</th></tr></thead>
    <tbody>${rows}</tbody></table>` : `<p>${esc(t('priorities.none'))}</p>`}
  ${soon.length ? `<div class="soon"><h3>${esc(t(items.length ? 'priorities.check_soon' : 'priorities.check_first'))}</h3><p class="small">${esc(t(items.length ? 'priorities.check_soon_lead' : 'priorities.check_first_lead'))}</p>
    <ul>${soon.map((r) => `<li><a href="#${esc(r.id)}"><span class="issue-id">${esc(r.id)}</span> ${esc(r.title)}</a><span class="small muted block">${esc(r.where?.summary ?? '')}${r.where?.summary ? ' · ' : ''}${esc(t('priorities.if_confirmed', { severity: t(`severity.${r.if_confirmed.severity}`).toLowerCase() }))}</span></li>`).join('')}</ul></div>` : ''}
</section>`;
}

// Groups down, tasks across: eight short rows read better on a portrait page than eight narrow columns.
function journeys(ctx) {
  const { t, report } = ctx;
  if (!report.journeys.length) return '';
  const js = report.journeys;
  const rows = GROUP_IDS.map((g) => `<tr><th scope="row">${groupChip(ctx, g, true)}</th>${js.map((j) => {
    const cell = j.tested ? (j.by_group?.[g] ?? { state: 'no_barrier_found', issue_ids: [] }) : { state: 'not_tested', issue_ids: [] };
    return `<td class="js js-${cell.state}"><span class="js-state">${esc(t(`journeys.${cell.state}`))}</span>${cell.issue_ids?.length ? `<span class="js-ids">${idList(cell.issue_ids)}</span>` : ''}</td>`;
  }).join('')}</tr>`).join('\n');
  const notes = js.filter((j) => !j.tested && j.not_tested_reason).map((j) => `<li><strong>${esc(j.name)}:</strong> ${esc(j.not_tested_reason)}</li>`).join('');
  return `<section class="journeys-sec front" aria-labelledby="js-h">
  <h2 id="js-h">${esc(t('journeys.heading'))}</h2>
  <p class="lead">${esc(t('journeys.lead'))}</p>
  <table class="journeys">
    <thead><tr><th scope="col">${esc(t('glance.col_group'))}</th>${js.map((j) => `<th scope="col">${esc(j.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${notes ? `<ul class="small muted js-notes">${notes}</ul>` : ''}
</section>`;
}

// ---------------------------------------------------------------------------------------------------------------
// How to read

function howToRead(ctx) {
  const { t } = ctx;
  const sevRows = SEVERITIES.map((s) => `<li class="sev-${s}">${sevTag(ctx, s)}<p>${esc(t(`severity.${s}_desc`))}</p></li>`).join('');
  const groups = GROUP_IDS.map((g) => `<div><dt>${groupChip(ctx, g, false)}</dt><dd>${esc(t(`groups.${g}_desc`))}</dd></div>`).join('');
  const tools = (t('tools') || []).map(([term, def]) => `<div><dt>${esc(term)}</dt><dd>${esc(def)}</dd></div>`).join('');
  const know = ['automated', 'measured', 'interactive', 'ai_review'].map((m) => `<div><dt><span class="know">${esc(t(`method.${m}`))}</span></dt><dd>${esc(t(`method.${m}_desc`))}</dd></div>`).join('');
  const parts = (t('howto.card_parts') || []).map(([k, v], i) => `<li><span class="callout-n">${i + 1}</span><strong>${esc(k)}.</strong> ${esc(v)}</li>`).join('');
  return `<section class="howto front" aria-labelledby="howto-h">
  <h2 id="howto-h">${esc(t('howto.heading'))}</h2>
  <p class="lead">${esc(t('howto.lead'))}</p>
  <h3>${esc(t('howto.severity_heading'))}</h3>
  <ul class="sev-key" role="list">${sevRows}</ul>
  <p class="small muted">${esc(t('howto.severity_note'))}</p>
  <h3>${esc(t('howto.groups_heading'))}</h3>
  <dl class="key-list groups-key">${groups}</dl>
  <h3>${esc(t('howto.tools_heading'))}</h3>
  <dl class="key-list">${tools}</dl>
  <h3>${esc(t('howto.know_heading'))}</h3>
  <dl class="key-list">${know}</dl>
  <h3>${esc(t('howto.card_heading'))}</h3>
  <ol class="card-parts" role="list">${parts}</ol>
  <p class="note-box">${esc(t('howto.review_note'))}</p>
</section>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Screenshots


function overlay(width, height, boxes, cls = '', { scrim = true } = {}) {
  // Text often runs a little past its element's box (a label's last letter, a menu item's first): the outline is
  // drawn with a margin so it never cuts through the words it marks.
  const m = Math.max(4, Math.round(width / 160));
  boxes = (boxes ?? []).map((b) => clampBox({ ...b, x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, width, height)).filter(Boolean);
  if (!boxes.length) return '';
  const holes = boxes.map((b) => `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`).join(' ');
  const numbered = boxes.length > 1;
  const marks = boxes.map((b, i) => {
    const r = Math.max(14, Math.round(width / 70));
    const cx = Math.min(Math.max(b.x, r + 2), width - r - 2);
    const cy = Math.min(Math.max(b.y, r + 2), height - r - 2);
    return `<rect class="hl-halo" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/><rect class="hl" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>${numbered ? `<g class="marker"><circle cx="${cx}" cy="${cy}" r="${r}"/><text x="${cx}" y="${cy}" dy="0.35em" font-size="${Math.round(r * 1.1)}">${b.n ?? i + 1}</text></g>` : ''}`;
  }).join('');
  return `<svg class="shot-overlay ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${scrim ? `<path class="scrim" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z ${holes}"/>` : ''}${marks}</svg>`;
}

function clampBox(b, width, height) {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  const w = Math.min(width, b.x + b.w) - x;
  const h = Math.min(height, b.y + b.h) - y;
  return w > 2 && h > 2 ? { ...b, x, y, w, h } : null;
}

function shotImg(ctx, s, opts) {
  return `<div class="shot-frame" style="aspect-ratio:${s.width}/${s.height};--ar:${s.width}/${s.height}"><img src="${esc(ctx.fileUrl(s.file))}" width="${s.width}" height="${s.height}" alt="${esc(s.alt)}">${overlay(s.width, s.height, s.boxes, '', opts)}</div>`;
}

function figure(ctx, s, item) {
  // Every figure is outlined the same way, never dimmed: a grey scrim changes how colours look, and dimming some
  // figures but not others made the same kind of picture look different from page to page.
  const opts = { scrim: false };
  const no = ctx.nextFigure();
  const caption = `<p class="caption"><span class="fig-n">${esc(ctx.t('issues.figure', { n: no }))}</span> ${esc(s.caption)}${s.url ? ` ${urlLink(s.url)}` : ''}</p>`;
  if (s.kind === 'pair' && s.pair) {
    // Both pictures are labelled, and the comparison picture has its own text alternative: the same alt on both
    // would tell a screen reader user that the two are one picture.
    const { t } = ctx;
    const pairAlt = s.pair.alt && s.pair.alt !== s.alt ? s.pair.alt : t('issues.pair_without_alt');
    return `<div class="shot pair">
      <div class="pair-grid">
        <div><p class="pair-label">${esc(s.label || t('issues.pair_with_focus'))}</p>${shotImg(ctx, s, opts)}</div>
        <div><p class="pair-label">${esc(t('issues.pair_without_focus'))}</p>${shotImg(ctx, { ...s.pair, alt: pairAlt, boxes: s.pair.boxes }, opts)}</div>
      </div>${caption}</div>`;
  }
  // A tall crop (a full narrow page) is shown narrower so it never fills the page.
  const tall = s.height / s.width > 1.1;
  return `<div class="shot${tall ? ' tall' : ''}">${shotImg(ctx, s, opts)}${caption}</div>`;
}

function evidenceWidget(ctx, e) {
  const { t } = ctx;
  if (!e) return '';
  if (e.kind === 'screen_reader') {
    return `<div class="ev ev-sr"><p class="ev-title">${esc(t('issues.sr_says'))}</p>
      <dl class="sr"><div><dt>${esc(t('issues.sr_now'))}</dt><dd><q>${esc(e.announced)}</q></dd></div>${e.expected ? `<div><dt>${esc(t('issues.sr_expected'))}</dt><dd><q>${esc(e.expected)}</q></dd></div>` : ''}</dl></div>`;
  }
  if (e.kind === 'contrast') {
    const ratio = new Intl.NumberFormat(ctx.lang, { maximumFractionDigits: 2 }).format(e.ratio);
    const req = new Intl.NumberFormat(ctx.lang, { maximumFractionDigits: 1 }).format(e.required);
    return `<div class="ev ev-contrast"><p class="ev-title">${esc(t('issues.contrast_title'))}</p>
      <div class="swatch-row">
        <svg class="swatch-sample" viewBox="0 0 120 34" aria-hidden="true" focusable="false"><rect x="0.5" y="0.5" width="119" height="33" rx="3" fill="${esc(safeColor(e.bg))}" stroke="#7D8696"/><text x="10" y="22" font-size="13" fill="${esc(safeColor(e.fg))}">${esc(String(e.sample || 'Aa').slice(0, 18))}</text></svg>
        <dl class="swatch-dl"><div><dt>${esc(t('issues.contrast_text'))}</dt><dd><span class="chip" style="background:${esc(safeColor(e.fg))}" aria-hidden="true"></span><code>${esc(e.fg)}</code></dd></div>
        <div><dt>${esc(t('issues.contrast_bg'))}</dt><dd><span class="chip" style="background:${esc(safeColor(e.bg))}" aria-hidden="true"></span><code>${esc(e.bg)}</code></dd></div></dl>
        <p class="ratio"><strong>${esc(ratio)} : 1</strong> <span>— ${esc(t('issues.contrast_needs', { required: req }))}</span></p>
      </div></div>`;
  }
  if (e.kind === 'source') {
    return `<div class="ev ev-source"><p class="ev-title">${esc(t('issues.source_title'))}</p><pre>${(e.lines ?? []).slice(0, 4).map((l, i) => `<span${i === e.mark ? ' class="mark"' : ''}>${esc(l)}</span>`).join('\n')}</pre></div>`;
  }
  return '';
}

// Only #rgb/#rrggbb/rgb()/rgba() reach a style attribute.
function safeColor(c) {
  const s = String(c ?? '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(s) || /^rgba?\([\d\s.,%]+\)$/i.test(s) ? s : 'transparent';
}

// ---------------------------------------------------------------------------------------------------------------
// Issues

function criterionLine(ctx, criteria) {
  const { t } = ctx;
  const p = criteria.primary;
  const related = (criteria.related ?? []).map((r) => `${r.id} ${r.name}`).join('; ');
  return `<span class="wcag"><span class="sc">${esc(p.id)}</span> ${p.url ? `<a href="${esc(p.url)}">${esc(p.name)}</a>` : esc(p.name)} <span class="lvl">${esc(t('issues.level', { level: p.level }))}</span></span>${related ? `<span class="related">${esc(t('issues.related', { list: related }))}</span>` : ''}`;
}

function issueCard(ctx, i) {
  const { t, n, fix } = ctx;
  const groups = [...new Set(i.impacts.map((m) => m.group))];
  const shots = (i.shots ?? []).map((s) => figure(ctx, s, i)).join('');
  const who = i.impacts.slice(0, 4).map((m) => `<li>${groupIcon(m.group)}<b>${esc(t(`groups.${m.group}_short`))}</b> <span class="impact ${m.level === 'blocks' ? 'block' : 'hard'}">${esc(t(`groups.${m.level}`))}</span> <span class="impact-text">${esc(m.text)}</span></li>`).join('');
  const examples = i.where.example_urls ?? [];
  // With a row per thing to change, each row says where it is; otherwise the card says where the problem is.
  const where = i.where.places ? placesHtml(ctx, i.where.places) : `${examples.map((u) => urlLink(u)).join(', ')}${i.where.more ? ` ${esc(t('issues.and_more', { n: n(i.where.more) }))}` : ''}`;
  const seen = where && !(i.recommended ?? []).length ? `<p class="seen-on"><span class="label">${esc(t('issues.seen_on'))}</span> ${where}</p>` : '';
  const fixBlock = fix && i.fix ? `<div class="fix-wrap"><div class="fix" role="note"><p class="fix-label">${esc(t('issues.fix'))}</p><ol>${i.fix.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${i.fix.dev_note ? `<p><span class="label">${esc(t('issues.fix_dev'))}:</span> ${esc(i.fix.dev_note)}</p>` : ''}${i.fix.done_when ? `<p><span class="label">${esc(t('issues.fix_done'))}:</span> ${esc(i.fix.done_when)}</p>` : ''}</div></div>` : '';
  const instances = i.where.instances && i.where.instances > 1 ? ` · ${esc(t('issues.places', { n: n(i.where.instances) }))}` : '';
  return `<article class="issue sev-${i.severity}" id="${esc(i.id)}" aria-labelledby="${esc(i.id)}-t">
  <div class="issue-top">
    <div class="issue-head">
      <h4 id="${esc(i.id)}-t"><span class="issue-id">${esc(i.id)}</span> ${esc(i.title)}</h4>
      <p class="issue-sev">${sevTag(ctx, i.severity)}</p>
    </div>
    <ul class="issue-meta" role="list">
      <li>${criterionLine(ctx, i.criteria)}</li>
      <li class="reach">${reachMeter(ctx, i.where)}<b>${esc(reachText(ctx, i.where))}</b>${instances}</li>
      <li class="where">${esc(i.where.summary)}</li>
      <li class="know-line"><span class="know">${esc(t(`method.${i.method}`))}</span><span class="group-strip">${groups.map((g) => groupIcon(g)).join('')}</span></li>
    </ul>
    ${shots || i.evidence ? `<div class="issue-media">${shots}${evidenceWidget(ctx, i.evidence)}</div>` : ''}
  </div>
  <dl class="issue-body">
    <div><dt>${esc(t('issues.whats_wrong'))}</dt><dd>${esc(i.observed)}</dd></div>
    <div><dt>${esc(t('issues.why'))}</dt><dd>${esc(i.cause)}</dd></div>
    <div class="row-who"><dt>${esc(t('issues.who'))}</dt><dd><ul class="who" role="list">${who}</ul></dd></div>
    ${i.severity_reason ? `<div><dt>${esc(t('issues.severity_reason'))}</dt><dd>${esc(i.severity_reason)}</dd></div>` : ''}
  </dl>
  ${recTable(ctx, i)}
  ${i.confidence === 'medium' ? `<p class="confidence-note"><span class="label">${esc(t('issues.not_certain'))}</span> ${esc(i.confidence_note ?? '')}</p>` : ''}
  ${fixBlock}
  <div class="issue-foot">${seen}${i.dev_ref?.csv_rows ? `<p class="dev-ref">${esc(t(i.dev_ref.csv_rows === 1 ? 'issues.dev_ref_one' : 'issues.dev_ref', { id: i.id, n: n(i.dev_ref.csv_rows) }))}</p>` : ''}</div>
</article>`;
}

// Where something is, without sending the reader to an appendix: every page, every page of a part of the site, or
// the pages themselves with the count of the others in that part (see placesOf in findings.mjs).
function placesHtml(ctx, pl) {
  const { t, n } = ctx;
  if (pl.every) return esc(t('issues.places_every'));
  const parts = [];
  if (pl.list?.length) parts.push(pl.list.map((u) => urlLink(u)).join(', '));
  for (const g of pl.groups ?? []) {
    if (g.all) parts.push(esc(t('issues.places_section_all', { section: g.section, n: n(g.n) })));
    else parts.push(`${g.examples.map((u) => urlLink(u)).join(', ')} ${esc(t('issues.places_section_more', { n: n(g.n - g.examples.length), section: g.section }))}`);
  }
  return parts.join('; ');
}

// Text from the site, quoted. Site text that claims compliance or certification (a badge's alt text, a note addressed
// to automated reviewers) is described instead: printed, it would read as a claim of this report. findings.csv keeps
// it word for word for the developers.
function siteQuote(ctx, text) {
  if (!claimsAccessibility(text)) return `<q>${esc(text)}</q>`;
  return `<span class="small muted">${esc(ctx.t('issues.rec_claim_withheld', { n: ctx.n(String(text).trim().split(/\s+/).length) }))}</span>`;
}

// One row per thing to change: the picture (always shown, so the owner recognises it without reading code), the
// text there now, what it should be, and where it is.
function recTable(ctx, i) {
  const { t, n } = ctx;
  const rows = i.recommended ?? [];
  if (!rows.length) return '';
  const images = i.criteria?.primary?.id === '1.1.1' || rows.some((r) => r.thumb);
  const elements = rows.some((r) => r.kind === 'element');
  const head = `<tr>${images ? `<th scope="col" class="rec-img">${esc(t(elements ? 'issues.rec_element' : rows.some((r) => r.zoom) ? 'issues.rec_text' : 'issues.rec_image'))}</th>` : ''}<th scope="col">${esc(t('issues.rec_now'))}</th><th scope="col">${esc(t('issues.rec_should'))}</th><th scope="col">${esc(t('issues.rec_where'))}</th></tr>`;
  if (elements) {
    const body = rows.map((r) => {
      const name = r.current ?? t('issues.rec_element');
      // The element is outlined, as in the card's screenshots, so the close-up shows which words or control it means.
      const thumb = r.thumb ? `<span class="rec-thumb" style="aspect-ratio:${r.thumb.width}/${r.thumb.height}"><img src="${esc(ctx.fileUrl(r.thumb.file))}" width="${r.thumb.width}" height="${r.thumb.height}" alt="${esc(t('issues.rec_thumb_element', { name }))}">${overlay(r.thumb.width, r.thumb.height, r.thumb.boxes, '', { scrim: false })}</span>` : `<span class="small muted">${esc(t('issues.rec_no_image'))}</span>`;
      const d = r.detail ?? {};
      const fam = r.check === 'contrast-measured' ? 'color-contrast' : r.check === 'label' ? 'form-labels' : r.check;
      const nowDetail = d.ratio != null ? t('issues.rec_el_now_contrast', { ratio: n(Number(d.ratio).toFixed(1)) }) : d.width != null ? t('issues.rec_el_now_size', { w: n(d.width), h: n(d.height) }) : t(`issues.rec_el_now_${fam}`);
      const now = `${siteQuote(ctx, name)}${nowDetail ? `<br><span class="small">${esc(nowDetail)}</span>` : ''}`;
      // An attribute breaks after its "=", never before its closing quote.
      // The attribute a developer adds, and in words what it does for the visitor.
      const should = r.value ? `<code>${esc(r.value).replace('=', '=<wbr>')}</code>${fam === 'autocomplete' ? `<br><span class="small">${esc(t('issues.rec_el_autocomplete_note'))}</span>` : ''}` : esc(d.required != null ? t('issues.rec_el_should_contrast', { required: n(d.required) }) : t(`issues.rec_el_should_${fam}`));
      return `<tr>${images ? `<td class="rec-img">${thumb}</td>` : ''}<td>${now}</td><td>${should}</td><td class="rec-where">${placesHtml(ctx, r.places)}</td></tr>`;
    }).join('');
    return `<div class="rec-wrap"><p class="rec-label">${esc(t('issues.recommended'))}</p><table class="rec-table elements"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }
  const body = rows.map((r) => {
    // The close-up is the evidence for the row, so it has a text alternative: what it shows, else what it is.
    const thumbAlt = r.seen ? t('issues.rec_thumb_seen', { seen: r.seen }) : r.zoom ? t('issues.rec_thumb_text') : t('issues.rec_thumb_file', { file: r.file && !r.file.includes('[redacted]') ? r.file : t('issues.rec_image') });
    const thumb = r.thumb ? `<img src="${esc(ctx.fileUrl(r.thumb.file))}" width="${r.thumb.width}" height="${r.thumb.height}" alt="${esc(thumbAlt)}">` : `<span class="small muted">${esc(t('issues.rec_no_image'))}</span>`;
    // The same picture may carry different texts on different pages: each is shown.
    let now = (r.currents?.length ? r.currents : r.current == null ? [] : [r.current]).map((c) => (c === '' ? esc(t('issues.rec_no_alt')) : siteQuote(ctx, c))).join('<br>');
    if (r.zoom) now += `${now ? '<br>' : ''}<span class="small">${esc(t('issues.rec_zoom_now', { px: n(r.zoom.fontPx), pct: n(r.zoom.grows) }))}</span>`;
    const should = r.zoom ? esc(t('issues.rec_zoom_should')) : r.value == null ? `<span class="muted">${esc(t('issues.rec_describe_missing'))}</span>` : recommendation(ctx, i, r.value);
    return `<tr>${images ? `<td class="rec-img">${thumb}${r.file && !r.file.includes('[redacted]') ? `<span class="rec-file">${breakable(r.file)}</span>` : ''}</td>` : ''}<td>${now}</td><td>${should}</td><td class="rec-where">${placesHtml(ctx, r.places)}</td></tr>`;
  }).join('');
  const more = i.recommended_more ? `<p class="small muted">${esc(t('issues.rec_more', { n: n(i.recommended_more) }))}</p>` : '';
  return `<div class="rec-wrap"><p class="rec-label">${esc(t('issues.recommended'))}</p><table class="rec-table"><thead>${head}</thead><tbody>${body}</tbody></table>${more}</div>`;
}

// A recommended replacement in the form a developer pastes: an alt attribute for images, the words otherwise.
function recommendation(ctx, i, value) {
  const { t } = ctx;
  if (i.criteria?.primary?.id === '1.1.1') return value === '' ? `<code>alt=""</code> ${esc(t('issues.rec_decorative'))}` : `<code>alt="${esc(value)}"</code>`;
  return `<q>${esc(value)}</q>`;
}

function issuesSection(ctx) {
  const { t, n, report } = ctx;
  if (!report.issues.length) {
    return `<section class="issues-sec short" aria-labelledby="issues-h"><h2 id="issues-h">${esc(t('issues.heading'))}</h2><p class="lead">${esc(t('issues.none'))}</p></section>`;
  }
  const bands = SEVERITIES.map((s) => {
    const list = report.issues.filter((i) => i.severity === s);
    if (!list.length) return '';
    const head = t(list.length === 1 ? 'issues.band_one' : 'issues.band', { severity: t(`severity.${s}`), n: n(list.length) });
    return `<div class="band sev-${s}">
    <div class="band-head"><h3>${sevGlyph(s)}${esc(head)}</h3><p class="band-lead">${esc(t(`severity.band_lead_${s}`))}</p>
    <p class="band-index"><span class="label">${esc(t('issues.band_index'))}:</span> ${list.map((i) => `${idLink(i.id)} ${esc(i.title)}`).join(' · ')}</p></div>
    ${list.map((i) => issueCard(ctx, i)).join('\n')}
    </div>`;
  }).join('\n');
  return `<section class="issues-sec" aria-labelledby="issues-h">
  <h2 id="issues-h">${esc(t('issues.heading'))}</h2>
  <p class="lead">${esc(t('issues.lead'))}</p>
  ${cleanupPointer(ctx)}
  ${bands}
</section>`;
}

// The clean-up points are described with the method, at the back; the problems section says they exist, so no one
// reads their absence here as "not found".
function cleanupPointer(ctx) {
  const { t, n, report } = ctx;
  const notes = report.method?.tool_notes ?? [];
  if (!notes.length) return '';
  const list = notes.map((x) => `<a class="id-link" href="#${esc(x.id ?? x.code)}">${esc(x.id ?? '')}</a> ${esc(t(`tool_notes.${x.code}.title`))}`).join('; ');
  const heading = `<a href="#cleanup">${esc(t('tool_notes.heading'))}</a>`;
  // The sentence is escaped first; the links are put in after, so they stay links.
  const text = esc(ctx.tn('tool_notes.pointer', notes.length, { n: n(notes.length), list: '\u0001', heading: '\u0002' }));
  return `<p class="small cleanup-pointer">${text.replace('\u0001', list).replace('\u0002', heading)}</p>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Items to check

function reviewSection(ctx) {
  const { t, report } = ctx;
  const items = report.review_items;
  const full = items.filter((r) => r.if_confirmed.severity !== 'minor');
  const compact = items.filter((r) => r.if_confirmed.severity === 'minor');
  const groupsList = (gs) => gs.map((g) => t(`groups.${g}_short`)).join(', ');
  const cards = full.map((r) => `<article class="review-card" id="${esc(r.id)}" aria-labelledby="${esc(r.id)}-t">
    <div class="issue-top">
    <div class="issue-head"><h3 id="${esc(r.id)}-t"><span class="issue-id">${esc(r.id)}</span> ${esc(r.title)}</h3><p class="to-check">${esc(t('review.to_check'))}</p></div>
    <ul class="issue-meta" role="list"><li>${criterionLine(ctx, r.criteria)}</li><li class="where">${esc(r.where.summary)}</li></ul>
    ${(r.shots ?? []).map((s) => figure(ctx, s, r)).join('')}
    </div>
    <dl class="issue-body">
      <div><dt>${esc(t('review.what_we_saw'))}</dt><dd>${esc(r.observed)}</dd></div>
      <div><dt>${esc(t('review.why_uncertain'))}</dt><dd>${esc(r.why_uncertain)}</dd></div>
      <div><dt>${esc(t('review.what_to_check'))}</dt><dd>${esc(r.what_to_check)}</dd></div>
    </dl>
    <p class="if-confirmed">${esc(t('review.if_confirmed', { severity: t(`severity.${r.if_confirmed.severity}`).toLowerCase(), groups: groupsList(r.if_confirmed.groups) }))}</p>
  </article>`).join('\n');
  const rows = compact.map((r) => `<tr id="${esc(r.id)}"><td><span class="issue-id">${esc(r.id)}</span> ${esc(r.title)}<span class="small muted block">${esc(r.what_to_check)}</span></td><td>${esc(r.where.summary)}</td><td><span class="sc">${esc(r.criteria.primary.id)}</span> ${esc(r.criteria.primary.name)}</td></tr>`).join('');
  return `<section class="review-sec" aria-labelledby="review-h">
  <h2 id="review-h">${esc(t('review.heading'))}</h2>
  <p class="lead">${esc(t('review.lead'))}</p>
  ${items.length ? '' : `<p>${esc(t('review.none'))}</p>`}
  ${cards}
  ${compact.length ? `<h3 class="compact-h">${esc(t('review.compact_heading'))}</h3><table class="compact"><thead><tr><th scope="col">${esc(t('review.col_item'))}</th><th scope="col">${esc(t('review.col_where'))}</th><th scope="col">${esc(t('review.col_requirement'))}</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
</section>`;
}

// ---------------------------------------------------------------------------------------------------------------
// Reference sections

function templatesSection(ctx) {
  const { t, n, report } = ctx;
  const rows = report.templates.map((tp) => `<tr><th scope="row">${esc(tp.name)}</th><td class="num">${n(tp.page_count)}</td><td>${esc(t(tp.deep_tested ? 'templates.yes' : 'templates.no'))}</td><td>${tp.example_url ? urlLink(tp.example_url) : '—'}</td><td>${idList([...(tp.issue_ids ?? []), ...(tp.review_ids ?? [])])}</td></tr>`).join('');
  return `<section class="templates-sec reference" aria-labelledby="tpl-h">
  <h2 id="tpl-h">${esc(t('templates.heading'))}</h2>
  <p class="lead">${esc(report.scope.templates_deep >= report.scope.templates_total ? t('templates.lead_all') : t('templates.lead', { deep: n(report.scope.templates_deep), types: n(report.scope.templates_total) }))}</p>
  <table class="tpl"><thead><tr><th scope="col">${esc(t('templates.col_type'))}</th><th scope="col" class="num">${esc(t('templates.col_pages'))}</th><th scope="col">${esc(t('templates.col_deep'))}</th><th scope="col">${esc(t('templates.col_example'))}</th><th scope="col">${esc(t('templates.col_ids'))}</th></tr></thead><tbody>${rows}</tbody></table>
</section>`;
}

function criteriaSection(ctx) {
  const { t, n, report } = ctx;
  const inProfile = report.criteria.filter((c) => c.in_profile);
  const outCount = report.criteria.length - inProfile.length;
  const blocks = PRINCIPLES.map((p) => {
    const list = inProfile.filter((c) => c.principle === p);
    if (!list.length) return '';
    const rows = list.map((c) => `<tr class="st-${c.status}"><td class="sc-cell"><span class="sc">${esc(c.id)}</span></td><td><strong>${esc(c.name)}</strong>${c.plain ? `<span class="plain">${esc(c.plain)}</span>` : ''}</td><td>${esc(c.level)}</td><td><span class="status st-${c.status}"><span class="sq sq-${c.status}" aria-hidden="true"></span>${esc(t(`status.${c.status}`))}</span></td><td>${idList([...(c.issue_ids ?? []), ...(c.review_ids ?? [])])}</td><td class="note">${esc(c.note ?? '')}</td></tr>`).join('');
    return `<h3>${esc(t(`principles.${p}`))} <span class="h-q">${esc(t(`principles.${p}_q`))}</span></h3>
    <table class="crit"><thead><tr><th scope="col">${esc(t('criteria.col_id'))}</th><th scope="col">${esc(t('criteria.col_name'))}</th><th scope="col">${esc(t('criteria.col_level'))}</th><th scope="col">${esc(t('criteria.col_status'))}</th><th scope="col">${esc(t('criteria.col_ids'))}</th><th scope="col">${esc(t('criteria.col_note'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join('\n');
  return `<section class="criteria-sec reference" aria-labelledby="crit-h">
  <h2 id="crit-h">${esc(t('criteria.heading'))}</h2>
  <p class="lead">${esc(t('criteria.lead'))}</p>
  ${outCount ? `<p class="small muted">${esc(t('criteria.out_of_profile', { n: n(outCount) }))}</p>` : ''}
  ${blocks}
</section>`;
}

function limitsSection(ctx) {
  const { t, report } = ctx;
  const gaps = report.limits.gaps ?? [];
  return `<section class="limits-sec reference" aria-labelledby="lim-h">
  <h2 id="lim-h">${esc(t('limits.heading'))}</h2>
  <p class="lead">${esc(t('limits.lead'))}</p>
  <ul class="honesty">${(t('limits.fixed') || []).map((s) => `<li>${esc(s)}</li>`).join('')}<li>${esc(t('tool_notes.outside'))}</li></ul>
  <h3>${esc(t('limits.gaps_heading'))}</h3>
  ${gaps.length ? `<table class="gaps"><thead><tr><th scope="col">${esc(t('limits.col_area'))}</th><th scope="col">${esc(t('limits.col_reason'))}</th><th scope="col">${esc(t('limits.col_effect'))}</th></tr></thead><tbody>${gaps.map((g) => `<tr><th scope="row">${esc(g.area)}</th><td>${esc(g.reason)}</td><td>${esc(g.effect)}</td></tr>`).join('')}</tbody></table>` : `<p>${esc(t('limits.no_gaps'))}</p>`}
</section>`;
}

function methodSection(ctx) {
  const { t, n, report } = ctx;
  const env = report.method.environment ?? {};
  // What exactly was reviewed: the public site is named on the cover; a copy run from the code or on this computer
  // is named here, with the version of the code when it is known.
  const src = report.site.source ?? {};
  const version = src.commit ? t(src.uncommitted ? 'method_section.source_commit_changed' : 'method_section.source_commit', { commit: src.commit }) : t('method_section.source_no_commit');
  const source = src.type === 'repo' ? t('method_section.source_repo', { name: src.repo_name ?? report.site.name, version })
    : src.local ? t('method_section.source_local') : null;
  const rows = [
    [t('method_section.source'), source],
    [t('method_section.browser'), env.browser],
    [t('method_section.viewports'), (env.viewports ?? []).map((v) => `${v[0]} × ${v[1]}`).join(', ')],
    [t('method_section.zoom'), (env.zoom_percent ?? []).map((z) => new Intl.NumberFormat(ctx.lang, { style: 'percent' }).format(z / 100)).join(', ')],
    [t('method_section.tools'), (env.tools ?? []).map((x) => [x.name, x.version].filter(Boolean).join(' ')).join(', ')],
    [t('method_section.ai'), env.ai_model],
    [t('method_section.at'), env.assistive_technology || t('method_section.at_none')],
    [t('method_section.crawl'), report.scope.max_pages ? n(report.scope.max_pages) : null],
  ].filter(([, v]) => v);
  const deep = (report.method.deep_pages ?? []).map((d) => `<li>${esc(d.template)}: ${urlLink(d.url)}</li>`).join('');
  return `<section class="method-sec reference" aria-labelledby="meth-h">
  <h2 id="meth-h">${esc(t('method_section.heading'))}</h2>
  <ol class="steps">${(t('method_section.steps', { deep: n(report.scope.templates_deep), types: n(report.scope.templates_total) }) || []).map((s, k) => (k === 0 && !(report.scope.discovery ?? []).includes('sitemap') ? t('method_section.step_links_only') : s)).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  <h3>${esc(t('method_section.env_heading'))}</h3>
  <table class="env"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
  ${deep ? `<h3>${esc(t('method_section.deep_pages'))}</h3><ul class="deep-list">${deep}</ul>` : ''}
  ${report.method.dropped_automated ? `<p class="small muted">${esc(t('method_section.dropped', { n: n(report.method.dropped_automated) }))}</p>` : ''}
</section>`;
}

// Code clean-up this review found that is not a WCAG failure (with the reason, and the change only with --fix), right after the WCAG
// requirements. Only this review's own findings: no other tool or report is named.
function cleanupSection(ctx) {
  const { t, tn, n, esc, report } = ctx;
  const notes = (report.method.tool_notes ?? []).map((x) => {
    const pages = [...new Set(x.examples.map((e) => e.url).filter(Boolean))].slice(0, 3).map((u) => urlLink(u)).join(', ');
    const ex = x.examples[0];
    const code = ex?.html ? `<code>${esc(ex.html)}</code>${ex.detail ? ` <span class="muted">${esc(ex.detail)}</span>` : ''}` : '';
    return `<li id="${esc(x.id ?? x.code)}"><p>${x.id ? `<span class="issue-id">${esc(x.id)}</span> ` : ''}<strong>${esc(t(`tool_notes.${x.code}.title`))}</strong> — ${esc(tn('tool_notes.elements', x.count, { n: n(x.count) }))}${pages ? ` (${pages})` : ''}.</p>
    <p>${esc(t(`tool_notes.${x.code}.why`))}</p>${ctx.fix ? `<p>${esc(t(`tool_notes.${x.code}.fix`))}</p>` : ''}${code ? `<p class="small">${code}</p>` : ''}</li>`;
  }).join('');
  if (!notes) return '';
  return `<section class="cleanup-sec reference" aria-labelledby="cleanup">
  <h2 id="cleanup">${esc(t('tool_notes.heading'))}</h2>
  <p class="lead">${esc(t('tool_notes.lead'))}</p>
  <ul class="tool-notes">${notes}</ul>
</section>`;
}

function glossarySection(ctx) {
  const { t, report } = ctx;
  if (!report.glossary.length) return '';
  const items = [...report.glossary].sort((a, b) => a.term.localeCompare(b.term, ctx.lang));
  return `<section class="glossary-sec reference" aria-labelledby="glo-h">
  <h2 id="glo-h">${esc(t('glossary.heading'))}</h2>
  <dl class="glossary">${items.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.meaning)}</dd></div>`).join('')}</dl>
</section>`;
}

// Above this many pages found but not checked (a sitemap of thousands of colour or product pages), the PDF names them
// by reason and site section instead of one row each; the workbook's Pages sheet keeps every one.
const NOT_CHECKED_ROWS_MAX = 100;

function sectionOf(url) {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    return seg.length ? `/${seg.slice(0, Math.min(2, seg.length)).join('/')}/` : '/';
  } catch { return String(url); }
}

function notCheckedSummary(ctx, excluded) {
  const { t } = ctx;
  const byReason = new Map();
  for (const p of excluded) byReason.set(p.reason ?? '', [...(byReason.get(p.reason ?? '') ?? []), p]);
  const rows = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length).map(([reason, list]) => {
    const sections = new Map();
    for (const p of list) sections.set(sectionOf(p.url), (sections.get(sectionOf(p.url)) ?? 0) + 1);
    const top = [...sections.entries()].sort((a, b) => b[1] - a[1]);
    const shown = top.slice(0, 4).map(([s, n]) => `${esc(s)}… (${n.toLocaleString('en')})`);
    const rest = top.slice(4).reduce((n, [, c]) => n + c, 0);
    const where = shown.join(', ') + (rest ? esc(t('pages_appendix.other_sections', { n: rest.toLocaleString('en') })) : '');
    return `<tr><td>${esc(reason)}</td><td class="num">${list.length.toLocaleString('en')}</td><td>${where}</td></tr>`;
  }).join('\n');
  return `<h3 id="pages-not-checked-h">${esc(t('pages_appendix.not_checked_heading', { n: excluded.length.toLocaleString('en') }))}</h3>
  <p>${esc(t('pages_appendix.not_checked_lead'))}</p>
  <table class="pages not-checked"><thead><tr><th scope="col">${esc(t('pages_appendix.col_reason'))}</th><th scope="col">${esc(t('pages_appendix.col_count'))}</th><th scope="col">${esc(t('pages_appendix.col_where'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function pagesAppendix(ctx) {
  const { t, report } = ctx;
  const tplName = new Map(report.templates.map((x) => [x.id, x.name]));
  // The pages table holds exactly the pages the cover counts as found; addresses that are not pages of their own
  // follow in a list of their own.
  const pages = report.pages.filter((p) => !p.not_a_page);
  const notPages = report.pages.filter((p) => p.not_a_page);
  const excluded = pages.filter((p) => p.load_status === 'excluded');
  const summarise = excluded.length > NOT_CHECKED_ROWS_MAX;
  const listed = summarise ? pages.filter((p) => p.load_status !== 'excluded') : pages;
  const rows = listed.map((p) => {
    const ok = p.load_status === 'ok';
    const status = ok ? '' : `<span class="page-status">${esc(t(`pages_appendix.status_${p.load_status}`))}${p.reason ? `: ${esc(p.reason)}` : ''}</span>`;
    return `<tr${ok ? '' : ' class="failed"'}><td>${urlLink(p.url)}${p.title ? `<span class="ptitle">${esc(p.title)}</span>` : ''}${status}</td><td>${esc(tplName.get(p.template_id) ?? '—')}</td><td>${ok ? esc(t(p.deep_tested ? 'pages_appendix.deep' : 'pages_appendix.auto')) : '—'}</td><td>${idList([...(p.issue_ids ?? []), ...(p.review_ids ?? [])])}</td></tr>`;
  }).join('\n');
  const notPageRows = notPages.slice(0, NOT_CHECKED_ROWS_MAX).map((p) => `<tr><td>${urlLink(p.url)}</td><td>${esc(p.reason ?? '')}</td></tr>`).join('\n');
  const notPageList = notPages.length ? `<h3 id="pages-not-pages-h">${esc(t('pages_appendix.not_pages_heading', { n: notPages.length.toLocaleString('en') }))}</h3>
  <p>${esc(t(notPages.length > NOT_CHECKED_ROWS_MAX ? 'pages_appendix.not_pages_lead_summary' : 'pages_appendix.not_pages_lead', { max: NOT_CHECKED_ROWS_MAX }))}</p>
  <table class="pages not-pages"><thead><tr><th scope="col">${esc(t('pages_appendix.col_address'))}</th><th scope="col">${esc(t('pages_appendix.col_reason'))}</th></tr></thead><tbody>${notPageRows}</tbody></table>` : '';
  return `<section class="pages-sec appendix" aria-labelledby="pages-h">
  <h2 id="pages-h">${esc(t('pages_appendix.heading'))}</h2>
  <p class="lead">${esc(t(summarise ? 'pages_appendix.lead_summary' : 'pages_appendix.lead', { n: pages.length.toLocaleString('en') }))}</p>
  <table class="pages"><thead><tr><th scope="col">${esc(t('pages_appendix.col_url'))}</th><th scope="col">${esc(t('pages_appendix.col_type'))}</th><th scope="col">${esc(t('pages_appendix.col_deep'))}</th><th scope="col">${esc(t('pages_appendix.col_ids'))}</th></tr></thead><tbody>${rows}</tbody></table>
  ${summarise ? notCheckedSummary(ctx, excluded) : ''}
  ${notPageList}
</section>`;
}
