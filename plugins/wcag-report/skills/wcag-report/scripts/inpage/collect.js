// Evaluated in the page as an expression: (opts) => data. No imports, no globals left behind.
// Collects what the analysis and the AI judges need to reason about a page; see docs/contracts.md "collect".
(opts) => {
  // Sections drawn only once scrolled near (content-visibility: auto) have no innerText and placeholder boxes while
  // off-screen; a visitor scrolling there sees them, so they are rendered for collection too.
  if (!document.querySelector('style[data-wr="content-visibility"]')) {
    try {
      const cv = document.createElement('style');
      cv.setAttribute('data-wr', 'content-visibility');
      cv.textContent = '*{content-visibility:visible!important}';
      (document.head || document.documentElement).append(cv);
    } catch { /* no document yet */ }
  }
  const MAX = 400;
  const maskSel = (opts && opts.mask) || [];
  const cut = (s, n = MAX) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const masked = (el) => maskSel.some((s) => { try { return el.closest(s); } catch { return false; } });
  const txt = (el, n) => (masked(el) ? '[masked]' : cut(el.innerText || el.textContent || '', n));

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };
  const bbox = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const stableId = (id) => id && !/\d{3,}|[:]|^[a-f0-9]{8,}$/i.test(id) && /^[A-Za-z][\w-]*$/.test(id);
  const stableClass = (c) => c && !/^(css|sc|jsx|emotion|svelte)-|_[a-z0-9]{5,}$|\d{3,}|__[A-Za-z0-9]{5}$/.test(c) && /^[A-Za-z_][\w-]*$/.test(c);
  const selector = (el) => {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (stableId(node.id)) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      let part = node.localName;
      const cls = [...node.classList].filter(stableClass).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${CSS.escape(c)}`).join('');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1 && !cls.length) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.localName === 'body') break;
      node = parent;
    }
    return parts.join(' > ');
  };
  const byIds = (ids, doc = document) => ids.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean).map((e) => e.textContent).join(' ');
  const accName = (el) => {
    if (masked(el)) return '[masked]';
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const t = byIds(lb, el.ownerDocument).trim(); if (t) return cut(t, 200); }
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return cut(al, 200);
    if (el.labels && el.labels.length) return cut([...el.labels].map((l) => l.textContent).join(' '), 200);
    if (el.localName === 'img' || el.localName === 'area' || (el.localName === 'input' && el.type === 'image')) {
      if (el.hasAttribute('alt')) return cut(el.getAttribute('alt'), 200);
    }
    const inner = cut(
      [...el.querySelectorAll('img[alt], svg title, [aria-label]')].map((x) => x.getAttribute('alt') || x.getAttribute('aria-label') || x.textContent).join(' ')
      + ' ' + (el.innerText || el.textContent || ''), 200);
    if (inner) return inner;
    const title = el.getAttribute('title');
    if (title) return cut(title, 200);
    if (el.localName === 'input' && ['submit', 'reset', 'button'].includes(el.type)) return cut(el.value, 200);
    return '';
  };
  const labelSource = (el) => {
    if (el.getAttribute('aria-labelledby') && byIds(el.getAttribute('aria-labelledby'), el.ownerDocument).trim()) return 'aria-labelledby';
    if ((el.getAttribute('aria-label') || '').trim()) return 'aria-label';
    if (el.labels && [...el.labels].some((l) => l.textContent.trim())) return 'label';
    if ((el.getAttribute('title') || '').trim()) return 'title';
    if ((el.getAttribute('placeholder') || '').trim()) return 'placeholder';
    return 'none';
  };

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(visible).slice(0, 150).map((h) => ({
    level: Number(h.getAttribute('aria-level')) || Number(h.localName.slice(1)) || 2,
    text: txt(h, 160),
    selector: selector(h),
  }));

  const implicitRole = (el) => {
    const n = el.localName;
    if (n === 'header' && !el.closest('article,aside,main,nav,section')) return 'banner';
    if (n === 'footer' && !el.closest('article,aside,main,nav,section')) return 'contentinfo';
    if (n === 'nav') return 'navigation';
    if (n === 'main') return 'main';
    if (n === 'aside') return 'complementary';
    if (n === 'search') return 'search';
    if (n === 'form' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'form';
    if (n === 'section' && (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))) return 'region';
    return null;
  };
  const LANDMARKS = ['banner', 'navigation', 'main', 'contentinfo', 'search', 'complementary', 'region', 'form'];
  const landmarks = [...document.querySelectorAll('header,footer,nav,main,aside,search,form,section,[role]')]
    .map((el) => ({ el, role: el.getAttribute('role') || implicitRole(el) }))
    .filter((x) => LANDMARKS.includes(x.role))
    .slice(0, 60)
    .map(({ el, role }) => ({ role, label: cut(el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ? byIds(el.getAttribute('aria-labelledby')) : ''), 120), selector: selector(el) }));

  const nearText = (el) => {
    const fig = el.closest('figure');
    if (fig) { const c = fig.querySelector('figcaption'); if (c) return cut(c.textContent, 120); }
    const p = el.parentElement;
    return p ? cut(p.innerText || p.textContent || '', 120) : '';
  };
  const images = [...document.querySelectorAll('img, svg[role=img], [role=img], input[type=image], area')].slice(0, 300).map((el) => {
    const link = el.closest('a[href]');
    const alt = el.localName === 'img' || el.localName === 'area' || el.localName === 'input' ? el.getAttribute('alt') : (el.getAttribute('aria-label') || null);
    const role = el.getAttribute('role');
    return {
      // A lazy-loaded picture still showing its data: placeholder names its file in data-src / data-lazy-src.
      src: cut((() => {
        const s = el.currentSrc || el.getAttribute('src') || el.getAttribute('href') || '';
        if (!/^data:/i.test(s)) return s;
        const lazy = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || (el.getAttribute('data-srcset') || el.getAttribute('data-lazy-srcset') || '').trim().split(/\s+/)[0];
        try { return lazy ? new URL(lazy, document.baseURI).href : s; } catch { return s; }
      })(), 300),
      alt: alt == null ? null : (masked(el) ? '[masked]' : cut(alt, 300)),
      role,
      decorative: alt === '' || role === 'presentation' || role === 'none' || el.getAttribute('aria-hidden') === 'true',
      inLink: Boolean(link),
      linkHref: link ? link.href : null,
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
      selector: selector(el),
      bbox: bbox(el),
      nearText: nearText(el),
    };
  });

  // Links of a closed menu in the header or navigation are part of the navigation too (they appear when it opens):
  // they are kept, marked hidden, so navigation and "more than one way" can be judged.
  const inNav = (a) => Boolean(a.closest('header, nav, [role=banner], [role=navigation]')) && !a.closest('main, [role=main]');
  const links = [...document.querySelectorAll('a[href], [role=link]')].filter((a) => visible(a) || inNav(a)).slice(0, 400).map((a) => ({
    ...(visible(a) ? {} : { hidden: true }),
    text: txt(a, 160),
    name: accName(a),
    href: a.href || null,
    selector: selector(a),
    newWindow: a.target === '_blank',
  }));
  const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit], input[type=button], input[type=reset]')].filter(visible).slice(0, 200).map((b) => ({
    text: txt(b, 160) || cut(b.value || '', 160),
    name: accName(b),
    selector: selector(b),
  }));

  const formPurpose = (f) => {
    const blob = `${f.getAttribute('action') || ''} ${f.id} ${f.className} ${f.getAttribute('role') || ''} ${f.getAttribute('aria-label') || ''} ${[...f.querySelectorAll('input,button')].map((i) => `${i.type} ${i.name} ${i.id} ${i.getAttribute('autocomplete') || ''} ${i.textContent}`).join(' ')}`.toLowerCase();
    if (/search|query|\bq\b|suche|поиск|пошук/.test(blob) && f.querySelectorAll('input').length <= 3) return 'search';
    if (/password/.test(blob) && /(new-password|confirm|register|sign ?up|create)/.test(blob)) return 'signup';
    if (/password/.test(blob)) return 'login';
    if (/checkout|payment|cc-number|card|shipping|billing/.test(blob)) return 'checkout';
    if (/newsletter|subscribe/.test(blob) && f.querySelectorAll('input:not([type=hidden])').length <= 3) return 'newsletter';
    if (/message|contact|enquir|inquir|textarea/.test(blob) || f.querySelector('textarea')) return 'contact';
    return 'other';
  };
  const fieldSel = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea, [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=switch]';
  // A form widget written into an empty, same-origin iframe (common for embedded contact forms) is part of the page:
  // its fields are collected too, with the frame noted. Frames from other sites cannot be read.
  const frames = [...document.querySelectorAll('iframe')].map((f) => { try { return f.contentDocument?.body ? { el: f, doc: f.contentDocument } : null; } catch { return null; } }).filter(Boolean);
  const docs = [document, ...frames.map((f) => f.doc)];
  const frameOf = (el) => (el.ownerDocument === document ? null : selector(frames.find((f) => f.doc === el.ownerDocument)?.el));
  const formRoots = docs.flatMap((d) => [...d.querySelectorAll('form')]);
  const orphanFields = docs.flatMap((d) => [...d.querySelectorAll(fieldSel)]).filter((f) => !f.closest('form'));
  const describeField = (el) => ({
    type: el.getAttribute('role') || (el.localName === 'input' ? (el.type || 'text') : el.localName),
    name: cut(el.getAttribute('name') || el.id || '', 80),
    label: accName(el),
    labelSource: labelSource(el),
    placeholder: cut(el.getAttribute('placeholder') || '', 120),
    autocomplete: el.getAttribute('autocomplete') || '',
    required: el.required || el.getAttribute('aria-required') === 'true',
    selector: selector(el),
  });
  const forms = formRoots.slice(0, 30).map((f) => ({
    selector: selector(f),
    purpose: formPurpose(f),
    fields: [...f.querySelectorAll(fieldSel)].slice(0, 60).map(describeField),
    ...(frameOf(f) ? { frame: frameOf(f) } : {}),
  }));
  if (orphanFields.length) forms.push({ selector: null, purpose: 'other', fields: orphanFields.slice(0, 60).map(describeField) });

  const videoHost = /youtube|youtu\.be|vimeo|wistia|dailymotion|player\.|brightcove|jwplayer|loom\.com|vidyard/i;
  const media = [
    ...[...document.querySelectorAll('video, audio')].map((m) => ({
      kind: m.localName,
      src: cut(m.currentSrc || m.getAttribute('src') || (m.querySelector('source') || {}).src || '', 300),
      tracks: [...m.querySelectorAll('track')].map((t) => ({ kind: t.kind || 'subtitles', srclang: t.srclang || '' })),
      autoplay: m.autoplay,
      muted: m.muted,
      controls: m.controls,
      loop: m.loop,
      durationSec: Number.isFinite(m.duration) ? Math.round(m.duration) : null,
      title: cut(m.getAttribute('title') || m.getAttribute('aria-label') || '', 160),
      selector: selector(m),
    })),
    ...[...document.querySelectorAll('iframe')].filter((f) => videoHost.test(f.src || '')).map((f) => ({
      kind: 'iframe-video', src: cut(f.src, 300), tracks: [], autoplay: /autoplay=1/.test(f.src), muted: /mute=1/.test(f.src),
      controls: true, loop: false, durationSec: null, title: cut(f.title || '', 160), selector: selector(f),
    })),
  ].slice(0, 50);

  const iframes = [...document.querySelectorAll('iframe, frame')].slice(0, 50).map((f) => {
    let third = true;
    try { third = new URL(f.src, location.href).origin !== location.origin; } catch { /* about:blank */ }
    return { src: cut(f.getAttribute('src') || '', 300), title: cut(f.getAttribute('title') || '', 160), selector: selector(f), thirdParty: Boolean(f.getAttribute('src')) && third };
  });

  const pageLang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  const langParts = [...document.body.querySelectorAll('[lang]')].filter((el) => (el.getAttribute('lang') || '').toLowerCase() !== pageLang).slice(0, 40)
    .map((el) => ({ lang: el.getAttribute('lang'), text: txt(el, 160), selector: selector(el) }));

  // Regions repeated across pages: the outermost header/nav/footer outside main content.
  const top = (sel) => [...document.querySelectorAll(sel)].find((el) => !el.closest('main, article') && visible(el));
  const regionSel = (el) => (el ? selector(el) : null);
  const globalRegions = {
    header: regionSel(top('header, [role=banner]')),
    nav: regionSel(top('nav, [role=navigation]')),
    footer: regionSel(top('footer, [role=contentinfo]')),
  };

  const focusableSel = 'a[href], area[href], button, input:not([type=hidden]), select, textarea, iframe, summary, [tabindex], [contenteditable=""], [contenteditable=true]';
  const focusableCount = [...document.querySelectorAll(focusableSel)].filter((el) => el.tabIndex >= 0 && visible(el) && !el.disabled).length;

  // 1.3.1 — tables as software reads them (F46, F90, F91), to compare with what the screenshot shows.
  const tableSel = 'table, [role=table], [role=grid], [role=treegrid]';
  const tables = [...document.querySelectorAll(tableSel)].filter(visible).slice(0, 20).map((t) => {
    const rows = [...t.querySelectorAll('tr, [role=row]')].filter((r) => r.closest(tableSel) === t);
    const cells = (r) => [...r.children].filter((c) => /^(td|th)$/.test(c.localName) || /cell|header/.test(c.getAttribute('role') || ''));
    const isTh = (c) => c.localName === 'th' || /header/.test(c.getAttribute('role') || '');
    const first = rows[0] ? cells(rows[0]) : [];
    const bold = (c) => Number(getComputedStyle(c).fontWeight) >= 600 || Boolean(c.querySelector('b, strong'));
    return {
      role: t.getAttribute('role') || null,
      caption: t.caption ? cut(t.caption.textContent, 120) : null,
      summary: t.getAttribute('summary') || null,
      rows: rows.length,
      cols: Math.max(0, ...rows.map((r) => cells(r).length)),
      th: t.querySelectorAll('th, [role=columnheader], [role=rowheader]').length,
      thWithScope: t.querySelectorAll('th[scope]').length,
      cellsWithHeadersAttr: t.querySelectorAll('td[headers], th[headers]').length,
      firstRowStyledAsHeader: first.length > 1 && first.every((c) => !isTh(c) && bold(c)),
      nestedTable: Boolean(t.querySelector('table')),
      sample: rows.slice(0, 3).map((r) => cells(r).slice(0, 6).map((c) => `${isTh(c) ? 'th' : 'td'}: ${cut(c.innerText || c.textContent || '', 40)}`)),
      selector: selector(t),
    };
  });

  // 1.3.1 / 1.3.2 — text laid out in columns with spaces inside a pre block (F33, F34, F48). Program code is skipped.
  const preColumns = [...document.querySelectorAll('pre')].filter((p) => visible(p) && !p.querySelector('code') && !p.closest('code'))
    .filter((p) => (p.textContent.split('\n').filter((l) => /\S {3,}\S.* {3,}\S/.test(l)).length >= 2))
    .slice(0, 10).map((p) => ({ text: p.textContent.slice(0, 400), selector: selector(p) }));

  // One pass over the elements for the visual cues the markup may not carry.
  const bodySize = parseFloat(getComputedStyle(document.body).fontSize) || 16;
  const NOT_HEADING = 'h1,h2,h3,h4,h5,h6,[role=heading],a,button,[role=button],[role=link],nav,header,footer,label,legend,th,caption,figcaption,summary,option,select,textarea,script,style,noscript,svg,[aria-hidden=true]';
  const blockOf = (el) => { let b = el; while (b && b !== document.body && getComputedStyle(b).display.startsWith('inline')) b = b.parentElement; return b; };
  const styledHeadings = [];
  const backgroundImages = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (styledHeadings.length >= 25 && backgroundImages.length >= 40) break;
    // 1.3.1 — text that looks like a heading but is not marked up as one (F2): it stands alone on its line, and is
    // larger than body text or bold before a paragraph.
    if (styledHeadings.length < 25) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (own.length >= 3 && own.length <= 80 && !el.closest(NOT_HEADING) && visible(el)) {
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize) / bodySize;
        const weight = Number(cs.fontWeight) || 400;
        const block = blockOf(el);
        const alone = block && block !== document.body && (block.innerText || '').replace(/\s+/g, ' ').trim() === own;
        const next = alone ? block.nextElementSibling : null;
        const followedBy = next ? cut(next.innerText || '', 80) : '';
        if (alone && (size >= 1.25 || (weight >= 600 && followedBy.length >= 40))) {
          styledHeadings.push({ text: cut(own, 80), sizeVsBody: Math.round(size * 100) / 100, weight, followedBy, selector: selector(el) });
        }
      }
    }
    // 1.1.1 — pictures drawn by CSS (F3): the information in them reaches no one who cannot see them.
    if (backgroundImages.length < 40 && el !== document.body) {
      const bg = getComputedStyle(el).backgroundImage;
      const url = /url\(["']?([^"')]+)/.exec(bg || '');
      if (url && !/^data:image\/svg/.test(url[1]) && visible(el)) {
        const r = el.getBoundingClientRect();
        if (r.width >= 48 && r.height >= 48) {
          backgroundImages.push({
            src: cut(url[1], 300), width: Math.round(r.width), height: Math.round(r.height),
            text: txt(el, 120), role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'), selector: selector(el), bbox: bbox(el),
          });
        }
      }
    }
  }

  // 1.3.1 — role="presentation" or "none" on markup that carries structure (F92).
  const presentationRoles = [...document.querySelectorAll('[role=presentation], [role=none]')]
    .filter((el) => /^(table|ul|ol|dl|h[1-6]|blockquote)$/.test(el.localName) && visible(el) && (el.innerText || '').trim())
    .slice(0, 20).map((el) => ({ tag: el.localName, role: el.getAttribute('role'), hasTh: Boolean(el.querySelector('th')), children: el.children.length, text: txt(el, 120), selector: selector(el) }));

  // 1.3.2 — a word spelled with spaces between its letters ("S A L E"), read out letter by letter (F32).
  const spacedLetters = [];
  const SPACED = /(?:^|[\s(«"])((?:\p{L}[  ]){3,}\p{L})(?=$|[\s.,!?:;)»"])/u;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && spacedLetters.length < 15; n = walker.nextNode()) {
    const m = SPACED.exec(n.textContent);
    const host = n.parentElement;
    if (!m || !host || host.closest('script,style,code,pre,kbd,samp,[aria-hidden=true]') || !visible(host)) continue;
    spacedLetters.push({ text: m[1], context: txt(host, 120), selector: selector(host) });
  }

  const meta = document.querySelector('meta[name=viewport]');
  return {
    url: location.href,
    title: masked(document.documentElement) ? '[masked]' : cut(document.title, 200),
    lang: document.documentElement.getAttribute('lang'),
    dir: document.documentElement.getAttribute('dir') || getComputedStyle(document.documentElement).direction,
    metaViewport: meta ? meta.getAttribute('content') : null,
    headings,
    landmarks,
    images,
    links,
    buttons,
    forms,
    media,
    iframes,
    langParts,
    globalRegions,
    tables,
    preColumns,
    styledHeadings,
    presentationRoles,
    backgroundImages,
    spacedLetters,
    // Long enough to find a passage in another language (3.1.2) and to read the page in order (1.3.2).
    textSample: cut(document.body ? document.body.innerText : '', 6000),
    focusableCount,
  };
}
