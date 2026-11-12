// Image work without native modules: decoding, resizing, JPEG encoding and pixel comparison run inside a blank
// Chromium page (createImageBitmap + OffscreenCanvas). One page serves a whole command.

export async function imageTools(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<!doctype html><title>img</title>');

  const call = (fn, arg) => page.evaluate(fn, arg);

  // Downscale (never upscale) to maxWidth with step-down halving for quality, then encode as JPEG.
  async function toJpeg(buf, { maxWidth = Infinity, quality = 0.76 } = {}) {
    const res = await call(async ({ b64, maxWidth, quality }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      let bmp = await createImageBitmap(new Blob([bytes]));
      const scale = Math.min(1, maxWidth / bmp.width);
      const tw = Math.max(1, Math.round(bmp.width * scale));
      const th = Math.max(1, Math.round(bmp.height * scale));
      let src = bmp;
      let w = bmp.width;
      let h = bmp.height;
      while (w / 2 >= tw) {
        const c = new OffscreenCanvas(Math.round(w / 2), Math.round(h / 2));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(src, 0, 0, c.width, c.height);
        src = c; w = c.width; h = c.height;
      }
      const out = new OffscreenCanvas(tw, th);
      const g = out.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, tw, th);
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, tw, th);
      const blob = await out.convertToBlob({ type: 'image/jpeg', quality });
      const ab = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < ab.length; i += 0x8000) s += String.fromCharCode(...ab.subarray(i, i + 0x8000));
      return { b64: btoa(s), width: tw, height: th, scale };
    }, { b64: buf.toString('base64'), maxWidth, quality });
    return { buffer: Buffer.from(res.b64, 'base64'), width: res.width, height: res.height, scale: res.scale };
  }

  // Count pixels that differ between two same-size images. `region` (image pixels) limits the count; `ring` counts
  // only a band of that width around the region's inner box, which is where focus outlines are drawn.
  async function diff(a, b, { region = null, inner = null, threshold = 40 } = {}) {
    return call(async ({ a, b, region, inner, threshold }) => {
      const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const data = (img) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const da = data(ia);
      const db = data(ib);
      const r = region ?? { x: 0, y: 0, w, h };
      let changed = 0;
      let total = 0;
      let innerChanged = 0;
      for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++) {
        for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) {
          const inInner = inner && x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h;
          const i = (y * w + x) * 4;
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (inInner) { if (d > threshold) innerChanged += 1; continue; }
          total += 1;
          if (d > threshold) changed += 1;
        }
      }
      return { changed, total, ratio: total ? changed / total : 0, innerChanged };
    }, { a: a.toString('base64'), b: b.toString('base64'), region, inner, threshold });
  }

  // Share of changed pixels in each cell of a cols × rows grid laid over two same-size images (row by row).
  async function gridDiff(a, b, { cols = 8, rows = 6, threshold = 40 } = {}) {
    return call(async ({ a, b, cols, rows, threshold }) => {
      const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const data = (img) => {
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, w, h).data;
      };
      const da = data(ia);
      const db = data(ib);
      const cw = Math.floor(w / cols);
      const ch = Math.floor(h / rows);
      const changed = new Array(cols * rows).fill(0);
      const sx = new Array(cols * rows).fill(0);
      const sy = new Array(cols * rows).fill(0);
      for (let y = 0; y < ch * rows; y++) {
        for (let x = 0; x < cw * cols; x++) {
          const i = (y * w + x) * 4;
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d <= threshold) continue;
          const k = Math.floor(y / ch) * cols + Math.floor(x / cw);
          changed[k] += 1;
          sx[k] += x;
          sy[k] += y;
        }
      }
      // Where in each cell the change is: the centre of the changed pixels.
      return { cellWidth: cw, cellHeight: ch, ratios: changed.map((n) => n / (cw * ch)), centres: changed.map((n, k) => (n ? { x: Math.round(sx[k] / n), y: Math.round(sy[k] / n) } : null)) };
    }, { a: a.toString('base64'), b: b.toString('base64'), cols, rows, threshold });
  }

  // WCAG relative luminance of every pixel (or of `region`), as percentiles: the background behind text over a photo
  // or gradient is judged at its worst part, not its average.
  async function luminance(buf, { region = null } = {}) {
    return call(async ({ b64, region }) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const r = region ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
      const d = g.getImageData(Math.max(0, r.x), Math.max(0, r.y), Math.max(1, Math.min(bmp.width - r.x, r.w)), Math.max(1, Math.min(bmp.height - r.y, r.h))).data;
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const table = Array.from({ length: 256 }, (_, i) => lin(i));
      const ls = [];
      for (let i = 0; i < d.length; i += 4) ls.push(0.2126 * table[d[i]] + 0.7152 * table[d[i + 1]] + 0.0722 * table[d[i + 2]]);
      ls.sort((a, b) => a - b);
      const p = (q) => ls[Math.min(ls.length - 1, Math.max(0, Math.round(q * (ls.length - 1))))];
      return { n: ls.length, p02: p(0.02), p05: p(0.05), p50: p(0.5), p95: p(0.95), p98: p(0.98) };
    }, { b64: buf.toString('base64'), region });
  }

  // The background right under the letters: the pixels that change when the text is hidden are where its glyphs are
  // (grown by a pixel for anti-aliasing), and the hidden picture says what is behind them there. A line box reaches
  // above and below the letters (into a header bar, over a neighbour); the glyphs do not.
  async function glyphLuminance(shown, hidden, { threshold = 24 } = {}) {
    return call(async ({ a, b, threshold }) => {
      const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const px = (bmp) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(ia);
      const db = px(ib);
      const mask = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < da.length; i += 4, j += 1) {
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > threshold) mask[j] = 1;
      }
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const table = Array.from({ length: 256 }, (_, i) => lin(i));
      const ls = [];
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          let on = false;
          for (let dy = -1; dy <= 1 && !on; dy += 1) for (let dx = -1; dx <= 1 && !on; dx += 1) {
            const yy = y + dy; const xx = x + dx;
            if (yy >= 0 && yy < h && xx >= 0 && xx < w && mask[yy * w + xx]) on = true;
          }
          if (!on) continue;
          const i = (y * w + x) * 4;
          ls.push(0.2126 * table[db[i]] + 0.7152 * table[db[i + 1]] + 0.0722 * table[db[i + 2]]);
        }
      }
      if (!ls.length) return { n: 0 };
      ls.sort((p, q) => p - q);
      const p = (q) => ls[Math.min(ls.length - 1, Math.max(0, Math.round(q * (ls.length - 1))))];
      return { n: ls.length, p02: p(0.02), p05: p(0.05), p50: p(0.5), p95: p(0.95), p98: p(0.98) };
    }, { a: shown.toString('base64'), b: hidden.toString('base64'), threshold });
  }

  // Contrast of what a change drew (a focus outline, a highlight) against what was there before, pixel by pixel.
  async function changeContrast(a, b, { threshold = 40 } = {}) {
    return call(async ({ a, b, threshold }) => {
      const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.min(ia.width, ib.width);
      const h = Math.min(ia.height, ib.height);
      const data = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = data(ia);
      const db = data(ib);
      const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      const lum = (d, i) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      const ratios = [];
      for (let i = 0; i < da.length; i += 4) {
        const diff = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (diff <= threshold) continue;
        const l1 = lum(da, i);
        const l2 = lum(db, i);
        ratios.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
      ratios.sort((x, y) => x - y);
      const q = (p) => (ratios.length ? ratios[Math.min(ratios.length - 1, Math.round(p * (ratios.length - 1)))] : 0);
      return { changed: ratios.length, median: q(0.5), p75: q(0.75), share3: ratios.length ? ratios.filter((r) => r >= 3).length / ratios.length : 0 };
    }, { a: a.toString('base64'), b: b.toString('base64'), threshold });
  }

  async function size(buf) {
    return call(async (b64) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      return { width: bmp.width, height: bmp.height };
    }, buf.toString('base64'));
  }

  async function close() {
    await context.close().catch(() => {});
  }

  return { toJpeg, diff, gridDiff, luminance, glyphLuminance, changeContrast, size, close };
}
