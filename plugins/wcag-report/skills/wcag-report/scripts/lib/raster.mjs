// PDF pages → PNG images for the red team, rendered by pdf.js inside Chromium (no native canvas in Node). The images
// are the same for both hosts: Claude Code reads them with Read, Codex with view_image.
import fs from 'node:fs';
import path from 'node:path';
import { resolveDep } from './deps.mjs';
import { getBrowser } from './browser.mjs';

const ORIGIN = 'http://wr-raster.local';

export async function rasterize(pdfFile, outDir, { dpi = 110 } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const build = path.dirname(resolveDep('pdfjs-dist/legacy/build/pdf.mjs'));
  const { browser } = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  // A virtual origin serves pdf.js and the PDF: module scripts and workers are not allowed from file:// URLs.
  await context.route(`${ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1);
    if (name === 'report.pdf') return route.fulfill({ body: fs.readFileSync(pdfFile), contentType: 'application/pdf' });
    if (name === 'index.html') return route.fulfill({ body: '<!doctype html><html><body></body></html>', contentType: 'text/html' });
    const file = path.join(build, path.basename(name));
    if (fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), contentType: 'text/javascript' });
    return route.fulfill({ status: 404, body: '' });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/index.html`);
  const count = await page.evaluate(async (origin) => {
    const lib = await import(`${origin}/pdf.mjs`);
    lib.GlobalWorkerOptions.workerSrc = `${origin}/pdf.worker.mjs`;
    window.__doc = await lib.getDocument({ url: `${origin}/report.pdf` }).promise;
    return window.__doc.numPages;
  }, ORIGIN);
  const files = [];
  for (let i = 1; i <= count; i++) {
    const dataUrl = await page.evaluate(async ({ n, scale }) => {
      const p = await window.__doc.getPage(n);
      const vp = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const c2d = canvas.getContext('2d');
      c2d.fillStyle = '#fff';
      c2d.fillRect(0, 0, canvas.width, canvas.height);
      await p.render({ canvasContext: c2d, viewport: vp }).promise;
      return canvas.toDataURL('image/png');
    }, { n: i, scale: dpi / 72 });
    const file = path.join(outDir, `page-${String(i).padStart(3, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    files.push(file);
  }
  await context.close();
  return files;
}
