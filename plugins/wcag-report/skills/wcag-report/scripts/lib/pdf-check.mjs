// Reads a rendered report back: text per page and the PDF's own accessibility (tagged structure, language, title,
// bookmarks, figure alternatives, table headers). A report about accessibility that is itself inaccessible must
// not reach the client.
import fs from 'node:fs';
import { pdfjs } from './deps.mjs';

async function load(file) {
  // pdf.js warns on stderr about optional canvas polyfills it does not need for text and structure.
  const warn = console.warn;
  console.warn = () => {};
  try {
    const lib = await pdfjs();
    const data = new Uint8Array(fs.readFileSync(file));
    return await lib.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
  } finally {
    console.warn = warn;
  }
}

export async function pageTexts(file) {
  const doc = await load(file);
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    let text = '';
    for (const item of tc.items) text += item.str + (item.hasEOL ? '\n' : ' ');
    out.push(text.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim());
  }
  return out;
}

function walk(node, fn, depth = 0) {
  if (!node) return;
  fn(node, depth);
  for (const c of node.children ?? []) if (c && c.role) walk(c, fn, depth + 1);
}

export async function pdfAccessibility(file, { lang, title }) {
  const doc = await load(file);
  const raw = fs.readFileSync(file).toString('latin1');
  const info = (await doc.getMetadata()).info ?? {};
  const outline = (await doc.getOutline()) ?? [];
  const checks = [];
  const add = (id, ok, severity, message, detail) => checks.push({ id, ok, severity: ok ? null : severity, message, ...(detail ? { detail } : {}) });

  let tagged = 0;
  const figures = { total: 0, withoutAlt: [] };
  const tables = { total: 0, withoutTh: 0 };
  const headings = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tree = await (await doc.getPage(i)).getStructTree();
    if (tree?.children?.length) tagged++;
    walk(tree, (n) => {
      if (n.role === 'Figure' && n.children?.some((c) => c.type === 'content')) {
        figures.total++;
        if (!n.alt || !String(n.alt).trim()) figures.withoutAlt.push(i);
      }
      if (n.role === 'Table') {
        tables.total++;
        let th = false;
        walk(n, (m) => { if (m.role === 'TH') th = true; });
        if (!th) tables.withoutTh++;
      }
      if (/^H[1-6]$/.test(n.role)) headings.push({ page: i, level: Number(n.role[1]) });
    });
  }
  add('PDF-01', tagged === doc.numPages && /\/StructTreeRoot/.test(raw), 'blocker', `Tagged structure on ${tagged} of ${doc.numPages} pages`);
  const docLang = info.Language ?? null;
  add('PDF-02', Boolean(docLang) && docLang.toLowerCase().split('-')[0] === String(lang).toLowerCase().split('-')[0], 'blocker', `Document language is "${docLang ?? 'missing'}", expected "${lang}"`);
  add('PDF-03', Boolean(info.Title) && (!title || info.Title === title) && /\/DisplayDocTitle\s+true/.test(raw), 'major', `Title "${info.Title ?? 'missing'}"${title ? `, expected "${title}"` : ''}; DisplayDocTitle ${/\/DisplayDocTitle\s+true/.test(raw)}`);
  const topLevel = outline.flatMap((o) => (o.items?.length ? o.items : [o]));
  add('PDF-04', topLevel.length >= 5, 'major', `${topLevel.length} section bookmarks`, topLevel.map((o) => o.title).slice(0, 20));
  add('PDF-05', figures.withoutAlt.length === 0, 'blocker', `${figures.total} figures, ${figures.withoutAlt.length} without alternative text`, figures.withoutAlt.length ? { pages: [...new Set(figures.withoutAlt)] } : null);
  let skipped = 0;
  for (let i = 1; i < headings.length; i++) if (headings[i].level > headings[i - 1].level + 1) skipped++;
  add('PDF-06', headings.length > 0 && skipped === 0, 'major', `${headings.length} headings, ${skipped} skipped level(s)`);
  add('PDF-07', tables.withoutTh === 0, 'major', `${tables.total} tables, ${tables.withoutTh} without header cells`);
  const texts = await pageTexts(file);
  const replacement = texts.reduce((n, t) => n + (t.match(/�/g)?.length ?? 0), 0);
  add('PDF-09', replacement === 0 && texts.join('').length > 200, 'blocker', `Text extracts cleanly (${replacement} replacement characters)`);
  return { pages: doc.numPages, info: { title: info.Title ?? null, lang: docLang, producer: info.Producer ?? null }, checks, headings: headings.length, figures: figures.total };
}
