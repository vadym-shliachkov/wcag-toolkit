// Assembles report.json, the renderer's only input (references/report.schema.json), from the run's data and the
// layered texts. It also cross-checks the numbers, so no section of the PDF can contradict another.
import path from 'node:path';
import { readJson, writeJson } from './io.mjs';
import { REFS_DIR } from './paths.mjs';
import { allCriteria } from './criteria.mjs';
import { loadSchema, validate } from './schema.mjs';
import { layeredTexts, GROUP_IDS } from './text.mjs';
import { isReviewed } from './merge.mjs';
import { publicPath, publicUrl, isLocal } from './report-paths.mjs';
import { publicTarget } from './run.mjs';
import { pageKey } from './urls.mjs';
import { loadStrings } from './i18n.mjs';
import { writeCsv } from './csv.mjs';
import { jpegSize, thumbIndex, placesOf, recommendationRows, findingRows } from './findings.mjs';
import { writeClientWorkbook } from './findings-xlsx.mjs';

const SEVERITIES = ['critical', 'serious', 'moderate', 'minor'];
const STATE_BY_SEVERITY = { critical: 'blocked', serious: 'very_hard', moderate: 'some_problems', minor: 'some_problems' };
const ROLE_WORDS = { button: 'button', link: 'link' };
const SR_RULES = { 'button-name': 'button', 'input-button-name': 'button', 'aria-command-name': 'button', 'link-name': 'link' };

// A highlight must be seen: an element squeezed to a sliver at the image edge (a skip link hidden off-screen) gets a
// box of at least 24 px around it, kept inside the picture.
function visibleBox(b, size) {
  const min = 24;
  const w = Math.max(b.w, min);
  const h = Math.max(b.h, min);
  const x = Math.min(Math.max(0, b.x + b.w / 2 - w / 2), Math.max(0, size.width - w));
  const y = Math.min(Math.max(0, b.y + b.h / 2 - h / 2), Math.max(0, size.height - h));
  return { ...b, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function counts(list) {
  const c = Object.fromEntries(SEVERITIES.map((s) => [s, list.filter((i) => i.severity === s).length]));
  return { ...c, total: list.length };
}

const pageUrl = (pg) => pg?.finalUrl || pg?.url;
const reachOf = (r) => r.where?.pages_likely ?? r.where?.pages_confirmed ?? 0;

function siteName(run) {
  if (run.target.name) return run.target.name;
  if (run.target.url && !isLocal(run.target.url)) return new URL(run.target.url).hostname.replace(/^www\./, '');
  return run.target.repoName || 'Site';
}

function groupsOf(entry, issue) {
  const g = (entry?.impacts ?? []).map((x) => x.group).filter((x) => GROUP_IDS.includes(x));
  return g.length ? g : issue.baselineGroups ?? [];
}

function where(issue, entry, ctx) {
  const urls = [...new Set(issue.instances.map((x) => publicUrl(x.url, ctx.run)).filter(Boolean))];
  const shown = urls.slice(0, 3);
  return {
    scope: issue.scope,
    summary: entry?.where ?? '',
    component: entry?.component_label ?? null,
    template_ids: issue.templates,
    pages_confirmed: issue.reach.pages,
    pages_likely: issue.reach.measured ? null : issue.reach.likelyPages,
    pages_reviewed: issue.reach.pagesReviewed,
    instances: issue.instanceCount,
    example_urls: shown,
    more: Math.max(0, issue.reach.pages - shown.length),
    // Where, summarised so it never sends the reader to an appendix: every page, every page of a part of the site,
    // or the pages themselves (see placesOf).
    places: placesOf(urls, ctx.reviewedUrls ?? []),
  };
}

function shots(issue, entry, ctx) {
  return (issue.shots ?? []).map((s, n) => {
    const t = entry?.shots?.[n] ?? {};
    const size = s.width && s.height ? { width: s.width, height: s.height } : jpegSize(path.join(ctx.p.dir, s.file)) ?? { width: 1200, height: 600 };
    return {
      file: s.file,
      ...size,
      kind: s.kind ?? 'crop',
      alt: t.alt ?? '',
      caption: t.caption ?? '',
      boxes: (s.boxes ?? []).map((b) => visibleBox(b, size)),
      url: s.url ? publicUrl(s.url, ctx.run) : null,
      label: s.label ?? null,
      pair: s.pair ? { file: s.pair.file, width: s.pair.width ?? size.width, height: s.pair.height ?? size.height, alt: t.pair_alt ?? t.alt ?? '', label: s.pair.label ?? '', boxes: s.pair.boxes ?? [] } : null,
    };
  });
}

function evidenceWidget(issue) {
  const m = issue.measured;
  if (m && m.fg && m.bg && m.ratio != null) {
    return { kind: 'contrast', fg: m.fg, bg: m.bg, ratio: Number(m.ratio), required: Number(m.required ?? 4.5) };
  }
  const role = SR_RULES[issue.check];
  if (role) return { kind: 'screen_reader', announced: ROLE_WORDS[role], expected: null };
  return null;
}

function criterionRef(c) {
  return c ? { id: c.id, name: c.name, level: c.level, url: c.url } : null;
}

export function assembleReport(ctx) {
  const { p, run } = ctx;
  const warnings = [];
  const lang = run.options.lang;
  const { t, missing } = loadStrings(lang, p.dir);
  if (missing.length) warnings.push(`${missing.length} interface string(s) missing in "${lang}", English used instead (e.g. ${missing.slice(0, 3).join(', ')}).`);
  const pagesDoc = readJson(p.pages);
  const pages = pagesDoc.pages;
  const reviewed = pages.filter(isReviewed);
  const templates = readJson(p.templates, { templates: [] }).templates;
  const issuesAll = readJson(p.issues);
  const cs = readJson(p.criteriaStatus);
  const journeysRaw = readJson(path.join(p.dir, 'journeys.json'), []);
  const shotIndex = readJson(p.shotsIndex, { templates: {} });
  const signalsDoc = readJson(p.signals, { skipped: {}, deepRan: [] });
  const toolNotesRaw = readJson(path.join(p.dir, 'tool-notes.json'), []);
  const { entries, report: edited } = layeredTexts(p);
  const coverage = readJson(path.join(REFS_DIR, 'coverage.json'), {});
  const plain = readJson(path.join(REFS_DIR, 'criteria-plain.en.json'), {});
  const crit = new Map(allCriteria().map((c) => [c.id, c]));
  for (const i of issuesAll) i.baselineGroups = crit.get(i.criteria.primary)?.groups ?? [];
  ctx.reviewedUrls = reviewed.map((pg) => publicUrl(pageUrl(pg), run));
  const thumbFor = thumbIndex(shotIndex, p.dir);

  const fails = issuesAll.filter((i) => i.status === 'fail');
  const reviews = issuesAll.filter((i) => i.status === 'needs_review');
  const idByKey = new Map(issuesAll.map((i) => [i.key, i.id]));

  for (const i of issuesAll) if (!entries[i.key]) warnings.push(`No text was written for ${i.id}; it is shown with placeholder text and will fail review.`);

  const issues = fails.map((i, n) => {
    const e = entries[i.key] ?? {};
    return {
      id: i.id,
      key: i.key,
      rank: n + 1,
      severity: i.severity,
      severity_reason: e.severity_reason ?? null,
      method: i.method,
      title: e.title ?? `${i.criteria.primary} ${crit.get(i.criteria.primary)?.name ?? ''}`,
      where: where(i, e, ctx),
      journeys: i.journeys,
      observed: e.observed ?? (i.observed?.[0] ?? ''),
      cause: e.cause ?? '',
      impacts: (e.impacts ?? []).filter((x) => GROUP_IDS.includes(x.group)),
      criteria: { primary: criterionRef(crit.get(i.criteria.primary)), related: i.criteria.related.map((r) => criterionRef(crit.get(r))).filter(Boolean) },
      shots: shots(i, e, ctx),
      evidence: evidenceWidget(i),
      fix: run.options.fix ? (e.fix ?? null) : null,
      // The judge's exact replacement (an alt text, a link text), one per distinct value, with where it applies.
      // One row per thing to change (a picture file, a wording): its close-up, the text now, the exact replacement
      // and where it is. Every place is also in findings.xlsx and findings.csv.
      ...(() => {
        const rows = recommendationRows(i, { thumbFor, run, reviewedUrls: ctx.reviewedUrls });
        return { recommended: rows, recommended_more: 0 };
      })(),
      confidence: i.confidence ?? 'high',
      confidence_note: i.confidence === 'medium' ? (i.confidenceNote ?? null) : null,
      dev_ref: { csv_rows: i.instanceCount },
    };
  });
  const reviewItems = reviews.map((i) => {
    const e = entries[i.key] ?? {};
    return {
      id: i.id,
      key: i.key,
      title: e.title ?? (i.question?.[0] ?? i.criteria.primary),
      where: where(i, e, ctx),
      observed: e.observed ?? (i.observed?.[0] ?? ''),
      why_uncertain: e.why_uncertain ?? '',
      what_to_check: e.what_to_check ?? (i.question?.[0] ?? ''),
      if_confirmed: e.if_confirmed ?? { severity: i.severity, groups: i.baselineGroups },
      criteria: { primary: criterionRef(crit.get(i.criteria.primary)), related: i.criteria.related.map((r) => criterionRef(crit.get(r))).filter(Boolean) },
      // An item to check shows one picture; the card stays short because it is a question, not a finding.
      shots: shots(i, e, ctx).slice(0, 1),
    };
  });

  // Who meets which barrier, from the writers' "who it affects" lines.
  const impacted = (i, g) => groupsOf(entries[i.key], i).includes(g);
  // A group is "blocked" only where its own line says it cannot do the task; "harder" never reads as blocked.
  const stateFor = (i, g) => {
    const level = (entries[i.key]?.impacts ?? []).find((x) => x.group === g)?.level;
    const state = STATE_BY_SEVERITY[i.severity];
    return level === 'harder' && state === 'blocked' ? 'very_hard' : state;
  };
  const rank = ['blocked', 'very_hard', 'some_problems'];
  // Browsing counts problems people meet while reading and moving around, not those that live only inside a form.
  const formPages = new Set(journeysRaw.filter((j) => j.id !== 'browse').flatMap((j) => j.pageIds));
  const onJourney = (i, j) => i.journeys.includes(j.id) && (j.id !== 'browse' || i.scope === 'site_wide' || i.instances.some((x) => !formPages.has(x.pageId)));
  const reviewImpacts = (i, g) => (entries[i.key]?.if_confirmed?.groups ?? i.baselineGroups ?? []).includes(g);
  const openFor = (j, g) => reviews.filter((i) => onJourney(i, j) && reviewImpacts(i, g));
  const journeys = journeysRaw.map((j) => {
    const by = {};
    for (const g of GROUP_IDS) {
      const hits = fails.filter((i) => onJourney(i, j) && impacted(i, g)).map((i) => ({ i, state: stateFor(i, g) }))
        .sort((a, b) => rank.indexOf(a.state) - rank.indexOf(b.state));
      by[g] = hits.length
        ? { state: hits[0].state, issue_ids: hits.slice(0, 8).map((h) => h.i.id) }
        : !j.tested ? { state: 'not_tested', issue_ids: [] }
          // Nothing confirmed, but open questions that would affect this group: not a clean bill of health.
          : openFor(j, g).length ? { state: 'to_check', issue_ids: openFor(j, g).slice(0, 4).map((i) => i.id) }
            : { state: 'no_barrier_found', issue_ids: [] };
    }
    return { id: j.id, name: t(`journeys.names.${j.id}`) === `journeys.names.${j.id}` ? j.name : t(`journeys.names.${j.id}`), tested: j.tested, not_tested_reason: j.tested ? null : t('gaps.shallow_templates.effect'), by_group: by };
  });
  const groups = GROUP_IDS.map((g) => {
    const list = fails.filter((i) => impacted(i, g));
    return {
      id: g,
      counts: counts(list),
      issue_ids: list.map((i) => i.id),
      hardest_issue_id: list[0]?.id ?? null,
      blocked_journeys: journeys.filter((j) => j.by_group[g].state === 'blocked').map((j) => j.id),
      review_ids: reviews.filter((i) => reviewImpacts(i, g)).map((i) => i.id),
      summary: edited.groups_summary?.[g] ?? null,
    };
  });

  const templatePages = new Map(templates.map((tp) => [tp.id, tp.pageIds]));
  const blockerPages = new Set();
  for (const i of fails.filter((x) => x.severity === 'critical')) {
    for (const x of i.instances) if (x.pageId) blockerPages.add(x.pageId);
    if (!i.reach.measured) for (const tid of i.templates) for (const pid of templatePages.get(tid) ?? []) blockerPages.add(pid);
  }

  const inProfile = cs.filter((c) => c.in_profile);
  const st = (s) => inProfile.filter((c) => c.status === s).length;
  const noteFor = (c) => {
    if (c.status === 'not_tested') {
      if (c.noteCode === 'auto_clean') return t('criteria.note_auto_clean');
      if (c.noteCode === 'judge_failed') return t('criteria.note_judge_failed');
      // The reason recorded with the amendment says what the re-check showed, not just that something was withdrawn.
      if (c.noteCode === 'withdrawn') return c.reason || t('criteria.note_withdrawn');
      return coverage[c.id]?.notTestedReason ?? null;
    }
    if (c.status === 'not_applicable') return c.reason ?? null;
    return null;
  };
  const criteria = cs.map((c) => ({
    id: c.id,
    name: c.name,
    plain: plain[c.id]?.plain ?? null,
    level: c.level,
    principle: c.principle,
    in_profile: c.in_profile,
    status: c.status,
    note: c.in_profile ? noteFor(c) : null,
    issue_ids: (c.issueKeys ?? []).map((k) => idByKey.get(k)).filter(Boolean),
    review_ids: (c.reviewKeys ?? []).map((k) => idByKey.get(k)).filter(Boolean),
  }));

  // Only pages where a problem was actually seen: "likely on the other pages of this type" is said on the card, not
  // presented as a finding on each page.
  const pageIssueIds = (pid, status) => issuesAll.filter((i) => i.status === status && i.instances.some((x) => x.pageId === pid)).map((i) => i.id);
  const pageRows = pages.map((pg) => ({
    url: publicUrl(pg.finalUrl || pg.url, run),
    title: pg.title ?? null,
    template_id: pg.templateId ?? null,
    deep_tested: templates.some((tp) => tp.deep && tp.representative === pg.id),
    load_status: isReviewed(pg) ? 'ok' : pg.blocked ? 'blocked' : pg.soft404 ? 'soft404' : 'error',
    reason: isReviewed(pg) ? null : pg.soft404 ? t('pages_appendix.skip.soft404') : pg.blocked ? t('pages_appendix.skip.blocked') : t('pages_appendix.skip.error'),
    issue_ids: pageIssueIds(pg.id, 'fail'),
    review_ids: pageIssueIds(pg.id, 'needs_review'),
  }));
  // Every page that was found but not checked is listed with its reason, so "every page we found" is literally true.
  const LISTED = ['robots', 'cap', 'shape-cap', 'depth', 'query-variant', 'logout', 'blocked', 'soft404', 'error', 'excluded', 'duplicate'];
  const listed = new Set(pageRows.map((r) => r.url));
  for (const s of pagesDoc.skipped ?? []) {
    if (!LISTED.includes(s.reason) || listed.has(publicUrl(s.url, run))) continue;
    listed.add(publicUrl(s.url, run));
    const status = s.reason === 'soft404' ? 'soft404' : s.reason === 'blocked' ? 'blocked' : s.reason === 'error' ? 'error' : 'excluded';
    const key = `pages_appendix.skip.${s.reason.replace('-', '_')}`;
    const reason = t(key);
    pageRows.push({ url: publicUrl(s.url, run), title: null, template_id: null, deep_tested: false, load_status: status, reason: reason === key ? s.reason : reason, issue_ids: [], review_ids: [] });
  }

  // Gaps: everything a reader could wrongly assume was covered.
  const gaps = [];
  const gap = (type, vars = {}, criteriaIds) => gaps.push({ area: t(`gaps.${type}.area`, vars), reason: t(`gaps.${type}.reason`, vars), effect: t(`gaps.${type}.effect`, vars), ...(criteriaIds ? { criteria: criteriaIds } : {}) });
  const stats = pagesDoc.stats ?? {};
  if (stats.capReached) gap('cap_reached', { max: run.options.maxPages, found: stats.discovered ?? pages.length });
  const failedPages = pages.length - reviewed.length;
  if (failedPages) gap('not_loaded', { n: failedPages });
  const robots = (pagesDoc.skipped ?? []).filter((s) => s.reason === 'robots').length;
  if (robots) gap('robots', { n: robots });
  if ((pagesDoc.documents ?? []).length) gap('documents', { n: pagesDoc.documents.length });
  if (!run.options.auth) gap('auth');
  gap('forms', {}, ['3.3.1', '3.3.3', '3.3.4'].filter((x) => inProfile.some((c) => c.id === x)));
  const thirdParty = issuesAll.filter((i) => i.thirdParty).length;
  if (thirdParty) gap('third_party', { n: thirdParty });
  // A form built inside a frame on the page (an embedded form service): its fields were checked with the page, but
  // its code belongs to the service, so the owner needs to know who can change it.
  const framedForms = reviewed.filter((pg) => (readJson(p.collect(pg.id), {}).forms ?? []).some((f) => f.frame));
  if (framedForms.length) gap('embedded_forms', { n: framedForms.length, pages: framedForms.slice(0, 3).map((pg) => publicPath(pg.finalUrl ?? pg.url, run.target.baseUrl)).join(', ') });
  // Page types the website refused to show the review's browser during the in-depth checks (refused.json, written
  // when a run is told to skip refusals): their automated checks from the crawl still count, the rest does not.
  const refused = readJson(path.join(p.dir, 'refused.json'), []);
  const refusedTemplates = [...new Set(refused.filter((r) => r.step === 'deep' || r.step === 'measure').map((r) => r.templateId).filter(Boolean))];
  if (refusedTemplates.length) {
    // Named by site section ("/colors/…", "/contact-us/"), so every refused page is covered without a long list.
    const paths = [...new Set(refused.filter((r) => r.step !== 'shots').map((r) => r.url).filter(Boolean).map((u) => publicPath(u, run.target.baseUrl)))];
    const bySection = new Map();
    for (const pth of paths) {
      const seg = pth.split('/').filter(Boolean)[0];
      const key = seg ? `/${seg}/` : '/';
      bySection.set(key, [...(bySection.get(key) ?? []), pth]);
    }
    const sections = [...bySection.entries()].map(([k, v]) => (v.length === 1 && v[0].replace(/\/?$/, '/') === k ? k : `${k}…`));
    gap('refused', { n: refusedTemplates.length, pages: sections.join(', ') });
  }
  const shallow = templates.filter((tp) => !tp.deep).length;
  if (shallow) gap('shallow_templates', { n: shallow, max: run.options.maxTemplates });
  if (inProfile.some((c) => c.noteCode === 'judge_failed')) gap('judge_failed', { n: inProfile.filter((c) => c.noteCode === 'judge_failed').length });
  if (inProfile.some((c) => c.id.startsWith('1.2.') && c.status !== 'not_applicable')) gap('media', {}, inProfile.filter((c) => c.id.startsWith('1.2.')).map((c) => c.id));
  gap('touch');

  const label = fails.some((i) => i.severity === 'critical') ? 'serious_barriers' : fails.some((i) => i.severity === 'serious') ? 'significant_barriers' : fails.length ? 'barriers' : reviews.length ? 'none_confirmed' : 'none_found';
  const home = pages.find((pg) => pg.depth === 0) ?? reviewed[0];
  const homeShotFile = home ? shotIndex.templates?.[home.templateId]?.desktop : null;
  const homeSize = homeShotFile ? jpegSize(path.join(p.dir, homeShotFile)) : null;
  const deepTemplates = templates.filter((tp) => tp.deep);
  // The address the site answers on (example.com/ redirects to www.example.com/), so the cover matches every other URL.
  const target = publicTarget(run);
  const siteUrl = home?.finalUrl && /^https?:/.test(target) && pageKey(home.finalUrl) === pageKey(target) ? home.finalUrl : target;

  const report = {
    schema_version: '1.0',
    report: {
      id: `WR-${ctx.id}`,
      language: lang,
      generated_at: run.createdAt,
      wcag_version: '2.2',
      profile: run.options.level,
      options: { fix: run.options.fix, max_pages: run.options.maxPages },
    },
    site: {
      name: siteName(run),
      url: siteUrl,
      source: { type: run.target.mode, repo_name: run.target.repoName ?? null, commit: run.target.commit ?? null },
      home_shot: homeShotFile && homeSize ? { file: homeShotFile, ...homeSize } : null,
    },
    scope: {
      pages_discovered: pageRows.length,
      pages_reviewed: reviewed.length,
      pages_failed: failedPages,
      cap_reached: Boolean(stats.capReached),
      max_pages: run.options.maxPages,
      templates_total: templates.length,
      templates_deep: deepTemplates.length,
      journeys_tested: journeysRaw.filter((j) => j.tested).length,
      discovery: ['sitemap', 'links'],
      excluded: run.options.exclude.map((x) => ({ what: x, reason: 'excluded' })),
      auth: Boolean(run.options.auth),
      forms_submitted: false,
      robots_respected: stats.robotsRespected !== false,
      documents_not_tested: (pagesDoc.documents ?? []).length,
    },
    verdict: {
      label,
      headline: edited.verdict_headline ?? '',
      summary: edited.summary ?? '',
      conformance: { status: fails.length ? 'does_not_meet' : 'not_established', failing_criteria: st('fail'), open_criteria: st('needs_review'), untested_criteria: st('not_tested') },
    },
    totals: {
      issues: counts(fails),
      review_items: { total: reviews.length, potential_serious: reviewItems.filter((r) => ['critical', 'serious'].includes(r.if_confirmed.severity)).length },
      criteria: { total: inProfile.length, fail: st('fail'), needs_review: st('needs_review'), pass: st('pass'), not_applicable: st('not_applicable'), not_tested: st('not_tested') },
      pages_with_blocker: [...blockerPages].filter((pid) => reviewed.some((pg) => pg.id === pid)).length,
      instances: fails.reduce((n, i) => n + i.instanceCount, 0),
    },
    groups,
    journeys,
    priorities: {
      issue_ids: fails.slice(0, 7).map((i) => i.id),
      reason: null,
      // With nothing confirmed, the owner's first job is the open items that would matter most if confirmed.
      // Ranked by how serious each would be if confirmed, then by how many pages it touches (not by ID).
      check_soon: [...(fails.length ? reviewItems.filter((r) => ['critical', 'serious'].includes(r.if_confirmed.severity)) : reviewItems)]
        .sort((a, b) => SEVERITIES.indexOf(a.if_confirmed.severity) - SEVERITIES.indexOf(b.if_confirmed.severity) || reachOf(b) - reachOf(a))
        .slice(0, 3).map((r) => r.id),
    },
    issues,
    review_items: reviewItems,
    criteria,
    templates: templates.map((tp) => ({
      id: tp.id,
      name: tp.name,
      page_count: tp.pageIds.length,
      deep_tested: Boolean(tp.deep),
      example_url: publicUrl(pageUrl(pages.find((pg) => pg.id === tp.representative)), run) || null,
      issue_ids: fails.filter((i) => i.templates.includes(tp.id)).map((i) => i.id),
      review_ids: reviews.filter((i) => i.templates.includes(tp.id)).map((i) => i.id),
    })),
    pages: pageRows,
    limits: { gaps },
    method: {
      environment: {
        browser: run.versions?.browser ?? 'Chromium',
        viewports: [[1280, 900], [320, 640]],
        zoom_percent: [100, 200],
        tools: [
          { name: 'axe-core', version: run.versions?.axe ?? '' },
          { name: 'Playwright', version: run.versions?.playwright ?? '' },
        ],
        ai_model: run.versions?.ai_model ?? null,
        assistive_technology: null,
      },
      crawl: { include: run.options.include, exclude: run.options.exclude, robots: !run.options.ignoreRobots },
      deep_pages: deepTemplates.map((tp) => ({ template: tp.name, url: publicUrl(pageUrl(pages.find((pg) => pg.id === tp.representative)), run) })),
      dropped_automated: signalsDoc.skipped?.bestPractice ?? 0,
      // Code clean-up: what this review found in the code that is not a WCAG failure, with the reason and the change.
      // Only this review's own findings: the report never refers to other tools or reports.
      tool_notes: toolNotesRaw.filter((x) => x.code).map((x, n) => ({
        id: `C-${String(n + 1).padStart(2, '0')}`, check: x.check, code: x.code, count: x.count, pages: new Set(x.instances.map((e) => e.url)).size,
        examples: x.instances.slice(0, 5).map((e) => ({ url: publicUrl(e.url, run) || e.url, html: e.html, detail: e.detail ?? null })),
      })),
    },
    glossary: (edited.glossary ?? []).slice(0, 25),
    artifacts: { findings_csv: 'findings.csv', findings_xlsx: 'findings.xlsx', evidence_dir: 'shots/' },
  };

  warnings.push(...crossCheck(report));
  const schemaErrors = validate(loadSchema('report'), report);
  if (schemaErrors.length) warnings.push(`report.json does not match its schema: ${schemaErrors.slice(0, 5).join('; ')}`);
  const rows = findingRows({ issues: issuesAll, entries, crit, pages, templates, run, thumbFor, fix: run.options.fix });
  // Clean-up points go into the work lists too, every place, so the one-line change reaches whoever edits the code.
  const pageById = new Map(pages.map((pg) => [pg.id, pg]));
  for (const note of report.method.tool_notes) {
    const raw = toolNotesRaw.find((x) => x.code === note.code);
    for (const e of raw?.instances ?? []) {
      rows.push({
        id: note.id, key: note.code, status: 'tool_note', severity: '', confidence: 'high', criterion: '', criterion_name: '', level: '', related: '',
        title: t(`tool_notes.${note.code}.title`), check: note.check, method: 'automated', scope: 'pages', fix_scope: 'page', component: '', templates: '',
        page: publicUrl(e.url, run) || e.url, page_id: e.pageId ?? '', page_title: pageById.get(e.pageId)?.title ?? '', page_type: '', state: 'default', viewport: '1280x900',
        selector: e.selector ?? '', html: e.html ?? '', element_text: '', current_value: e.detail ?? '', recommended_value: t(`tool_notes.${note.code}.fix`),
        recommendation_kind: 'cleanup', recommendation_basis: 'rule', has_recommendation: true, image_src: '', image_file: '', same_image_pages: '',
        observed: e.detail ?? '', issue_observed: t(`tool_notes.${note.code}.why`), cause: '', fix_steps: '', confidence_note: '', question: '', thumbnail: '', screenshot: '',
      });
    }
  }
  writeCsv(p, rows);
  try {
    writeClientWorkbook(p.xlsx, { rows, report, t });
  } catch (e) {
    warnings.push(`findings.xlsx could not be written: ${e.message}`);
  }
  return { report, warnings };
}

// Counts written in prose by the editor must match the data: "19 problems" when there are 18 reads as a false claim.
const NUMBER_CLAIMS = [
  { re: /(\d+)\s+(?:distinct\s+|confirmed\s+)?problems?\b/giu, total: (t) => [t.issues] },
  { re: /(\d+)\s+(?:more\s+|other\s+)?items?\b/giu, total: (t) => [t.review] },
  { re: /(\d+)\s+pages?\b/giu, total: (t) => t.pages },
];

export function numberMismatches(text, totals) {
  const out = [];
  for (const { re, total } of NUMBER_CLAIMS) {
    for (const m of String(text ?? '').matchAll(re)) {
      const n = Number(m[1]);
      if (!total(totals).includes(n)) out.push(`"${m[0]}" does not match the data (${total(totals).join(' or ')})`);
    }
  }
  return out;
}

// Numbers that must agree everywhere in the PDF.
export function crossCheck(r) {
  const w = [];
  const ids = new Set([...r.issues.map((i) => i.id), ...r.review_items.map((i) => i.id)]);
  if (r.totals.issues.total !== r.issues.length) w.push('Total issues does not match the issue list.');
  for (const s of SEVERITIES) if (r.totals.issues[s] !== r.issues.filter((i) => i.severity === s).length) w.push(`Count of ${s} issues does not match.`);
  for (const c of r.criteria.filter((x) => x.in_profile && x.status === 'fail')) if (!c.issue_ids.length) w.push(`Criterion ${c.id} fails without an issue.`);
  for (const i of r.issues) {
    const c = r.criteria.find((x) => x.id === i.criteria.primary?.id);
    if (!c || c.status !== 'fail') w.push(`${i.id}: its criterion ${i.criteria.primary?.id} is not marked as failing.`);
    if (i.where.pages_likely != null && i.where.pages_likely < i.where.pages_confirmed) w.push(`${i.id}: likely pages below confirmed pages.`);
    if (i.where.pages_confirmed > i.where.pages_reviewed) w.push(`${i.id}: more pages than were reviewed.`);
  }
  const totals = { issues: r.issues.length, review: r.review_items.length, pages: [r.scope?.pages_reviewed, r.scope?.pages_discovered, r.scope?.templates_deep, ...r.issues.flatMap((i) => [i.where.pages_confirmed, i.where.pages_likely])].filter((x) => x != null) };
  for (const msg of numberMismatches(`${r.verdict?.headline ?? ''} ${r.verdict?.summary ?? ''}`, totals)) w.push(`Summary: ${msg}`);
  const refs = [...r.priorities.issue_ids, ...r.priorities.check_soon, ...r.groups.flatMap((g) => g.issue_ids), ...r.journeys.flatMap((j) => Object.values(j.by_group).flatMap((b) => b.issue_ids)), ...r.criteria.flatMap((c) => [...c.issue_ids, ...c.review_ids])];
  for (const id of refs) if (!ids.has(id)) w.push(`Reference to unknown ID ${id}.`);
  if (/localhost|127\.0\.0\.1/.test(JSON.stringify({ site: r.site, pages: r.pages, issues: r.issues.map((i) => i.where) }))) w.push('A local server address would appear in the report.');
  return [...new Set(w)];
}

export function writeReportJson(ctx) {
  const { report, warnings } = assembleReport(ctx);
  writeJson(ctx.p.report, report);
  return { report, warnings };
}
