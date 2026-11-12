// findings.xlsx, for the site owner: every problem grouped by the page it is on, in the report's language.
//   By page   one shaded row per page (with its counts), then one row per place on that page, collapsible;
//   Problems  one row per problem, as in the PDF;
//   Pages     every page found, whether it was checked, and what was found there.
// Selectors and code stay in findings.csv; this file names things the way the owner sees them.
import { writeXlsx, STYLE } from './xlsx.mjs';

const SEV = ['critical', 'serious', 'moderate', 'minor'];

function shortPath(url) {
  try {
    const u = new URL(url);
    return decodeURI(u.pathname + u.search) || '/';
  } catch { return String(url ?? ''); }
}

// The owner's workbook is part of the client's report: how to fix appears only with --fix, like in the PDF. The
// expected result (the exact alt text or wording) is not a fix and is always shown. findings.csv always has the fixes.
export function changeText(r, t, { fix = false } = {}) {
  if (r.recommendation_kind === 'cleanup') return fix ? r.recommended_value : '';
  if (r.recommendation_kind === 'hide') return t('xlsx.alt_hide');
  if (r.recommendation_kind === 'replace') {
    if (!r.has_recommendation) return t('xlsx.describe');
    return r.criterion === '1.1.1' ? `alt="${r.recommended_value}"` : r.recommended_value;
  }
  return fix ? r.fix_steps || '' : '';
}

function elementText(r, t) {
  if (r.image_file) return t('xlsx.image', { file: r.image_file });
  return r.element_text || r.selector || '';
}

export function clientSheets({ rows, report, t }) {
  const titles = new Map([...report.issues, ...report.review_items].map((i) => [i.id, i.title]));
  const sevWord = (s) => (s ? t(`severity.${s}`) : '');
  const statusWord = (s) => t(s === 'fail' ? 'xlsx.status_problem' : s === 'tool_note' ? 'xlsx.status_note' : 'xlsx.status_check');
  const ORDER = ['fail', 'needs_review', 'tool_note'];
  const wcag = (r) => `${r.criterion} ${r.criterion_name}`.trim();
  const fix = Boolean(report.report?.options?.fix);

  // By page: pages in address order (home first), problems on a page by severity, then ID.
  const byPage = new Map();
  for (const r of rows) byPage.set(r.page, [...(byPage.get(r.page) ?? []), r]);
  const order = [...byPage.keys()].sort((a, b) => shortPath(a).localeCompare(shortPath(b)));
  const pageTitle = new Map(report.pages.map((p) => [p.url, p.title]));
  const columns = [
    { title: t('xlsx.col_page'), width: 34 }, { title: t('xlsx.col_id'), width: 7 }, { title: t('xlsx.col_problem'), width: 34 },
    { title: t('xlsx.col_severity'), width: 11 }, { title: t('xlsx.col_status'), width: 10 }, { title: t('xlsx.col_wcag'), width: 22 },
    { title: t('xlsx.col_element'), width: 30 }, { title: t('xlsx.col_now'), width: 30 }, { title: t('xlsx.col_change'), width: 40 },
    { title: t('xlsx.col_notes'), width: 60 },
  ];
  const pageRows = [];
  for (const url of order) {
    const list = byPage.get(url).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || SEV.indexOf(a.severity) - SEV.indexOf(b.severity) || a.id.localeCompare(b.id, undefined, { numeric: true }));
    const problems = new Set(list.filter((r) => r.status === 'fail').map((r) => r.id)).size;
    const checks = new Set(list.filter((r) => r.status === 'needs_review').map((r) => r.id)).size;
    const cleanups = new Set(list.filter((r) => r.status === 'tool_note').map((r) => r.id)).size;
    const counts = `${t('xlsx.page_counts', { p: problems, c: checks })}${cleanups ? ` · ${t('xlsx.page_cleanup', { k: cleanups })}` : ''}`;
    const head = [{ v: shortPath(url), link: url, s: STYLE.groupLink }, '', pageTitle.get(url) ?? list[0].page_title ?? '', '', '', '', '', '', '', counts];
    pageRows.push({ cells: head, style: STYLE.group });
    for (const r of list) {
      pageRows.push({
        level: 1,
        cells: [{ v: shortPath(url), s: STYLE.muted }, r.id, titles.get(r.id) ?? r.title, sevWord(r.severity), statusWord(r.status), wcag(r), r.status === 'tool_note' ? r.html : elementText(r, t), r.status === 'tool_note' ? '' : r.current_value, changeText(r, t, { fix }), r.observed],
      });
    }
  }

  const issueRows = [
    ...report.issues.map((i) => [i.id, i.title, sevWord(i.severity), statusWord('fail'), `${i.criteria.primary?.id ?? ''} ${i.criteria.primary?.name ?? ''}`.trim(), i.criteria.primary?.level ?? '', i.where.pages_confirmed, i.where.instances ?? i.where.pages_confirmed, i.observed, i.cause, i.confidence === 'medium' ? t('xlsx.sure_medium') : t('xlsx.sure_high')]),
    ...report.review_items.map((i) => [i.id, i.title, '', statusWord('needs_review'), `${i.criteria.primary?.id ?? ''} ${i.criteria.primary?.name ?? ''}`.trim(), i.criteria.primary?.level ?? '', i.where.pages_confirmed, i.where.instances ?? i.where.pages_confirmed, i.observed, i.why_uncertain, '']),
    ...(report.method?.tool_notes ?? []).map((x) => [x.id, t(`tool_notes.${x.code}.title`), '', statusWord('tool_note'), '', '', x.pages ?? x.count, x.count, t(`tool_notes.${x.code}.why`), fix ? t(`tool_notes.${x.code}.fix`) : '', '']),
  ].map((cells) => ({ cells }));

  const pagesSheet = [...report.pages].sort((a, b) => shortPath(a.url).localeCompare(shortPath(b.url))).map((pg) => ({
    cells: [{ v: shortPath(pg.url), link: pg.url, s: STYLE.link }, pg.title ?? '', pg.load_status === 'ok' ? t('xlsx.yes') : pg.reason ?? pg.load_status, pg.issue_ids.length, pg.review_ids.length, [...pg.issue_ids, ...pg.review_ids].join(', ')],
  }));

  return [
    { name: t('xlsx.sheet_by_page'), columns, rows: pageRows },
    {
      name: t('xlsx.sheet_problems'),
      filter: true,
      columns: [
        { title: t('xlsx.col_id'), width: 7 }, { title: t('xlsx.col_problem'), width: 40 }, { title: t('xlsx.col_severity'), width: 11 },
        { title: t('xlsx.col_status'), width: 10 }, { title: t('xlsx.col_wcag'), width: 26 }, { title: t('xlsx.col_level'), width: 7 },
        { title: t('xlsx.col_pages'), width: 8 }, { title: t('xlsx.col_places'), width: 8 }, { title: t('xlsx.col_wrong'), width: 60 },
        { title: t('xlsx.col_why'), width: 60 }, { title: t('xlsx.col_confidence'), width: 12 },
      ],
      rows: issueRows,
    },
    {
      name: t('xlsx.sheet_pages'),
      filter: true,
      columns: [
        { title: t('xlsx.col_page'), width: 44 }, { title: t('xlsx.col_title'), width: 44 }, { title: t('xlsx.col_checked'), width: 22 },
        { title: t('xlsx.col_problems'), width: 10 }, { title: t('xlsx.col_to_check'), width: 10 }, { title: t('xlsx.col_ids'), width: 24 },
      ],
      rows: pagesSheet,
    },
  ];
}

export function writeClientWorkbook(file, { rows, report, t }) {
  return writeXlsx(file, clientSheets({ rows, report, t }), { title: `${report.site?.name ?? ''} — ${t('xlsx.title')}` });
}
