// findings.csv: one row per place, for the developers (or a model) who make the changes. Selectors and code stay out
// of the PDF. Each row carries what is needed to decide the change without the PDF: the element and its text now,
// the exact replacement and where it comes from, and where one change fixes every place (fix_scope):
//   shared_component  a part of every page (header, footer): fix it once in that component;
//   image_file        the same picture file on several pages: fix its alt once where the file is managed;
//   template          a page type: fix it once in that template;
//   page              this page only.
// recommendation_kind is "hide" (alt="") or "replace" (put recommended_value there); recommendation_basis says
// whether it was judged on this page ("judge"), for the same picture elsewhere ("same_image"), or follows the
// pattern of the problem ("pattern"). fix_steps, fix_dev_note (the technical change: element, attribute or CSS and the
// target value) and fix_done_when are always filled for confirmed problems, with or without --fix: this file is the
// instruction set for whoever makes the changes; --fix only decides whether the client's report shows fixes.
// Opens in any spreadsheet and imports into issue trackers.
import fs from 'node:fs';

export const CSV_COLUMNS = [
  'id', 'key', 'status', 'severity', 'confidence', 'criterion', 'criterion_name', 'level', 'related', 'title', 'check', 'method',
  'act_rules', 'scope', 'fix_scope', 'component', 'templates', 'page', 'page_id', 'page_title', 'page_type', 'state', 'viewport', 'selector', 'html',
  'element_text', 'current_value', 'recommended_value', 'recommendation_kind', 'recommendation_basis', 'image_src', 'image_file',
  'same_image_pages', 'observed', 'issue_observed', 'cause', 'fix_steps', 'fix_dev_note', 'fix_done_when', 'confidence_note', 'question', 'thumbnail', 'screenshot',
];

function cell(v) {
  const s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

// An empty recommended_value with recommendation_kind "hide" means alt="": the empty value is the recommendation.
export function writeCsv(p, rows) {
  const out = [CSV_COLUMNS.join(',')];
  for (const r of rows) out.push(CSV_COLUMNS.map((c) => cell(r[c])).join(','));
  // A BOM so spreadsheet programs read UTF-8 (Cyrillic page titles, quoted labels) correctly.
  fs.writeFileSync(p.csv, `﻿${out.join('\r\n')}\r\n`);
  return rows.length;
}
