// report.json → report.html → report.pdf. The PDF is printed by Chromium through Playwright with tagging and an
// outline, so headings become bookmarks and the structure tree (headings, lists, tables, figures with alt text) is
// built from the HTML semantics.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEMPLATES_DIR } from './paths.mjs';
import { loadStrings } from './i18n.mjs';
import { buildReportHtml } from './report-html.mjs';
import { getBrowser } from './browser.mjs';

export function reportHtml(report, { baseDir, runDir = null, draft = false } = {}) {
  const strings = loadStrings(report.report.language || 'en', runDir);
  const html = buildReportHtml({
    report,
    strings,
    baseDir,
    draft,
    templateHtml: fs.readFileSync(path.join(TEMPLATES_DIR, 'report.html'), 'utf8'),
    css: fs.readFileSync(path.join(TEMPLATES_DIR, 'report.css'), 'utf8'),
    fontsCss: fs.readFileSync(path.join(TEMPLATES_DIR, 'fonts.css'), 'utf8'),
    fontsDir: path.join(TEMPLATES_DIR, 'fonts'),
  });
  return { html, missing: strings.missing, stringsSource: strings.source };
}

// Prints an HTML file to PDF once its fonts and images are ready; returns the page count.
export async function printPdf(htmlPath, pdfPath, { title } = {}) {
  const { browser } = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 120000 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => (img.complete && img.naturalWidth ? null : img.decode().catch(() => null))));
    });
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
    // A problem card or a short table that fits on a page is kept whole, so its last rows are not left alone on a
    // page of their own. Heights are measured at the A4 text width (170 mm); taller ones still break.
    await page.setViewportSize({ width: Math.round((170 * 96) / 25.4), height: 1000 });
    await page.evaluate(() => {
      const body = (255 * 96) / 25.4;
      for (const el of document.querySelectorAll('.issue, table')) {
        if (el.getBoundingClientRect().height < (el.matches('table') ? 0.5 : 0.45) * body) el.classList.add('wr-keep');
      }
    });
    const buf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
    const pages = countPages(buf);
    return { pages, brokenImages: broken, title: title ?? (await page.title()) };
  } finally {
    await page.close();
  }
}

// Chromium writes one /Type /Page object per page; good enough to report the count without parsing the PDF.
function countPages(buf) {
  const s = buf.toString('latin1');
  return (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

export async function renderReport(report, { outDir, baseDir = outDir, runDir = null, draft = false, htmlOnly = false, name = 'report' }) {
  fs.mkdirSync(outDir, { recursive: true });
  const { html, missing } = reportHtml(report, { baseDir, runDir, draft });
  const htmlPath = path.join(outDir, `${name}.html`);
  fs.writeFileSync(htmlPath, html);
  const result = { html: htmlPath, pdf: null, pages: null, sizeMB: null, missingI18n: missing, warnings: [] };
  if (missing.length) result.warnings.push(`${missing.length} UI strings are not translated into "${report.report.language}" and fall back to English.`);
  if (htmlOnly) return result;
  const pdfPath = path.join(outDir, `${name}.pdf`);
  fs.rmSync(pdfPath, { force: true });
  const printed = await printPdf(htmlPath, pdfPath);
  result.pdf = pdfPath;
  result.pages = printed.pages;
  result.sizeMB = Math.round((fs.statSync(pdfPath).size / 1048576) * 100) / 100;
  if (printed.brokenImages.length) result.warnings.push(`${printed.brokenImages.length} images could not be loaded: ${printed.brokenImages.slice(0, 3).join(', ')}`);
  if (result.sizeMB > 15) result.warnings.push(`The PDF is ${result.sizeMB} MB; aim for under 15 MB so it can be e-mailed.`);
  return result;
}
