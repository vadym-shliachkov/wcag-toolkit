#!/usr/bin/env node
// A small multi-template site with planted accessibility defects (see expected.json). No dependencies.
//   node server.mjs [port]      (or PORT=… node server.mjs; also used as the "preview" script of repo-node)
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CSS = `
*{box-sizing:border-box} body{margin:0;font:16px/1.5 Arial,sans-serif;color:#222;background:#fff}
.site-header{position:sticky;top:0;z-index:10;height:96px;background:#fff;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:24px;padding:0 24px}
.site-header nav a{margin-right:16px;color:#0645ad}
.icon-link{display:inline-flex;width:32px;height:32px}
.skip{position:absolute;left:-999px} .skip:focus{left:8px;top:8px;background:#fff}
main{padding:24px;max-width:960px}
.site-footer{padding:24px;background:#fff;color:#b4b4b4;font-size:14px}
.site-footer .social a{display:inline-block;width:16px;height:16px;margin-right:2px;background:#0645ad}
.no-outline:focus{outline:none}
.carousel{position:relative;height:120px;overflow:hidden;border:1px solid #ccc}
.slide{position:absolute;inset:0;display:none;padding:16px} .slide.on{display:block}
.tip-wrap{position:relative;display:inline-block} .tip{display:none;position:absolute;top:100%;left:0;background:#333;color:#fff;padding:8px;width:220px}
.tip-wrap:hover .tip{display:block}
.wide{width:1100px;background:#f3f3f3;padding:8px}
.clip{height:48px;overflow:hidden;width:280px;border:1px solid #ccc;padding:4px}
.fake-btn{display:inline-block;padding:8px 16px;background:#0645ad;color:#fff;cursor:pointer}
.field-error{border:2px solid #d00}
.cookie{position:fixed;bottom:0;left:0;right:0;background:#222;color:#fff;padding:16px;z-index:100}
.cookie button{margin-right:8px}
`;

const ORIENTATION_CSS = '@media (orientation: portrait){ html{transform:rotate(-90deg);transform-origin:left top;width:100vh;height:100vw;overflow-x:hidden;position:absolute;top:100%;left:0} }';

function layout({ title, lang = 'en', body, extraHead = '', cookie = true }) {
  return `<!doctype html>
<html${lang ? ` lang="${lang}"` : ''}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><link rel="stylesheet" href="/css/site.css">${extraHead}</head>
<body>
<a class="skip" href="#main-content">Skip to content</a>
<header class="site-header">
  <a href="/"><img src="/img/logo.svg" alt="Planted Shop" width="120" height="32"></a>
  <nav aria-label="Main"><a href="/">Home</a><a href="/blog/">Blog</a><a href="/events/2026/11/03">Events</a><a href="/about">About</a><a href="/contact">Contact</a></nav>
  <a class="icon-link" href="/cart"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l3 12h10l3-8H7" fill="none" stroke="#222" stroke-width="2"/></svg></a>
</header>
<main id="content">
${body}
</main>
<footer class="site-footer">
  <p>© 2026 Planted Shop. All prices include VAT. <a href="/private/report">Internal report</a></p>
  <p class="social"><a href="https://example.org/community" aria-label="Community"></a><a href="https://example.org/news" aria-label="News"></a><a href="https://example.org/careers" aria-label="Careers"></a></p>
</footer>
${cookie ? `<div class="cookie" id="cookie-banner" role="dialog" aria-label="Cookies"><p>We use cookies to improve this site.</p><button type="button" id="cookie-accept">Accept all</button><button type="button" id="cookie-reject">Reject all</button></div>
<script>(function(){var b=document.getElementById('cookie-banner');if(document.cookie.indexOf('consent=')>=0){b.remove();return;}
function set(v){document.cookie='consent='+v+';path=/';b.remove();}
document.getElementById('cookie-accept').onclick=function(){set('all')};document.getElementById('cookie-reject').onclick=function(){set('none')};})();</script>` : ''}
</body></html>`;
}

const ARTICLES = [
  ['spring-planting', 'Spring planting guide', 'Spring planting guide'],
  ['watering', 'How often to water', 'How often to water'],
  ['soil', 'Choosing soil', 'Choosing soil', { lang: null }],
  ['tools', 'Garden tools', 'Blog | Planted Shop'],
  ['compost', 'Making compost', 'Blog | Planted Shop'],
  ['pests', 'Dealing with pests', 'Dealing with pests'],
];

function article([slug, heading, title, opts = {}]) {
  return layout({
    title,
    lang: 'lang' in opts ? opts.lang : 'en',
    body: `<article><h1>${heading}</h1>
<p>Published 2 March 2026. Short practical advice for home gardeners.</p>
<img src="/img/${slug}.jpg" alt="image" width="480" height="240">
<p>Plant in the morning and water the roots, not the leaves. Keep seedlings out of strong wind for the first week.</p>
<div class="wide">Planting calendar: March — tomatoes, peppers; April — beans, squash; May — basil, cucumbers; June — late lettuce and herbs for autumn.</div>
<div class="clip">Tip: mulch keeps moisture in the soil and protects roots from heat during long dry summer weeks.</div>
<h3>Related</h3>
<p><a href="/blog/">Back to the blog</a></p>
</article>`,
  });
}

function home() {
  return layout({
    title: 'Planted Shop — plants and garden advice',
    extraHead: `<style>${ORIENTATION_CSS}</style>`,
    body: `<h1>Plants for every garden</h1>
<img src="/img/hero.jpg" width="640" height="240">
<div class="carousel" aria-label="Offers"><div class="slide on">Spring sale: 20% off seeds</div><div class="slide">Free delivery over 50 euros</div><div class="slide">New: indoor herb kits</div></div>
<script>(function(){var s=document.querySelectorAll('.slide'),i=0;setInterval(function(){s[i].classList.remove('on');i=(i+1)%s.length;s[i].classList.add('on');},2000);})();</script>
<p><span class="tip-wrap"><a href="/delivery" class="tip-trigger">Delivery terms</a><span class="tip" role="tooltip">Orders before 2 pm ship the same day. Returns within 30 days.</span></span></p>
<video src="/media/welcome.mp4" controls width="480" height="270"></video>
<p>Read our <a href="/blog/?utm_source=home&amp;utm_medium=link">gardening blog</a> or <a href="/blog/?page=2">older posts</a> and <a href="/blog/?page=3">even older posts</a>.</p>
<p><a href="/brochure.pdf">Download the catalogue (PDF)</a> · <a href="/logout">Log out</a></p>`,
  });
}

function blogIndex(page) {
  const items = ARTICLES.map(([slug, heading]) => `<li><a href="/blog/${slug}">${heading}</a></li>`).join('');
  return layout({ title: 'Blog | Planted Shop', body: `<h1>Gardening blog${page ? ` — page ${page}` : ''}</h1><ul>${items}</ul>` });
}

function contact() {
  return layout({
    title: 'Contact us | Planted Shop',
    body: `<h1>Contact us</h1>
<form id="contact" novalidate action="/contact" method="post">
  <p><input type="text" name="name" placeholder="Your name" required></p>
  <p><input type="email" name="email" placeholder="Email" required></p>
  <p><textarea name="message" placeholder="Message" required></textarea></p>
  <div class="fake-btn" onclick="check()">Send</div>
</form>
<p><a href="/faq" class="no-outline">Frequently asked questions</a></p>
<div id="picker" tabindex="0" aria-label="Pick a delivery date"><button type="button">Mon</button><button type="button">Tue</button><button type="button">Wed</button></div>
<script>
function check(){var f=document.getElementById('contact');[].forEach.call(f.querySelectorAll('[required]'),function(el){el.classList.toggle('field-error',!el.value);});}
(function(){var p=document.getElementById('picker');var b=p.querySelectorAll('button');
p.addEventListener('keydown',function(e){if(e.key==='Tab'){e.preventDefault();var i=[].indexOf.call(b,document.activeElement);b[(i+1+b.length)%b.length].focus();}});})();
</script>
<iframe src="/map.html" width="400" height="200"></iframe>`,
  });
}

function eventsDay(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const next = new Date(date.getTime() + 86400000);
  const p = (n) => String(n).padStart(2, '0');
  const nextPath = `/events/${next.getUTCFullYear()}/${p(next.getUTCMonth() + 1)}/${p(next.getUTCDate())}`;
  return layout({ title: `Events on ${y}-${p(m)}-${p(d)} | Planted Shop`, body: `<h1>Events on ${p(d)}.${p(m)}.${y}</h1><p>Workshop: pruning fruit trees, 10:00.</p><p><a href="${nextPath}">Next day</a></p>` });
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32"><rect width="120" height="32" fill="#2a7"/></svg>';
// A 1×1 JPEG, enough for <img> to load.
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

export function route(urlPath, host) {
  const origin = `http://${host}`;
  const html = (body, status = 200) => ({ status, type: 'text/html; charset=utf-8', body });
  if (urlPath === '/' || urlPath === '/index.html') return html(home());
  if (urlPath === '/blog/' || urlPath === '/blog') return html(blogIndex(null));
  const art = ARTICLES.find(([slug]) => urlPath === `/blog/${slug}`);
  if (art) return html(article(art));
  if (urlPath === '/contact') return html(contact());
  if (urlPath === '/about') return html(layout({ title: 'About us | Planted Shop', body: '<h1>About us</h1><p>A family garden shop since 1998.</p><h2>Our team</h2><p>Six gardeners and one cat. See our <a href="/old-offers">old offers</a>.</p>' }));
  if (urlPath === '/delivery' || urlPath === '/faq' || urlPath === '/cart') return html(layout({ title: `${urlPath.slice(1)} | Planted Shop`, body: `<h1>${urlPath.slice(1)}</h1><p>Information page.</p>` }));
  if (urlPath === '/private/report') return html(layout({ title: 'Internal', body: '<h1>Internal report</h1>' }));
  if (urlPath === '/logout') return html(layout({ title: 'Logged out', body: '<h1>You are logged out</h1>' }));
  const ev = /^\/events\/(\d{4})\/(\d{2})\/(\d{2})$/.exec(urlPath);
  if (ev) return html(eventsDay(Number(ev[1]), Number(ev[2]), Number(ev[3])));
  if (urlPath === '/map.html') return html('<!doctype html><html lang="en"><title>Map</title><body><p>Map of the shop location.</p></body></html>');
  if (urlPath === '/css/site.css') return { status: 200, type: 'text/css', body: CSS };
  if (urlPath.startsWith('/img/') && urlPath.endsWith('.svg')) return { status: 200, type: 'image/svg+xml', body: SVG };
  if (urlPath.startsWith('/img/')) return { status: 200, type: 'image/jpeg', body: JPG };
  if (urlPath === '/media/welcome.mp4') return { status: 404, type: 'text/plain', body: 'no media in fixture' };
  if (urlPath === '/brochure.pdf') return { status: 200, type: 'application/pdf', body: '%PDF-1.4\n%%EOF\n' };
  if (urlPath === '/robots.txt') return { status: 200, type: 'text/plain', body: `User-agent: *\nDisallow: /private/\nSitemap: ${origin}/sitemap_index.xml\n` };
  if (urlPath === '/sitemap_index.xml') return { status: 200, type: 'application/xml', body: `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap-pages.xml</loc></sitemap></sitemapindex>` };
  if (urlPath === '/sitemap-pages.xml') {
    const locs = ['/', '/about', '/contact', '/blog/', ...ARTICLES.map(([s]) => `/blog/${s}`)].map((p) => `<url><loc>${origin}${p}</loc></url>`).join('');
    return { status: 200, type: 'application/xml', body: `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>` };
  }
  // Single-page-app style catch-all: unknown routes answer 200 with a "not found" message (a soft 404).
  return html(layout({ title: 'Page not found | Planted Shop', body: '<h1>Sorry, we could not find that page</h1><p><a href="/">Go to the home page</a></p>' }));
}

export function startPlantedSite(port = 0, host = '127.0.0.1') {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, `http://${req.headers.host || host}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      server.writes = (server.writes || 0) + 1;
      res.writeHead(405).end();
      return;
    }
    const r = route(u.pathname, req.headers.host || `${host}:${server.address().port}`);
    res.writeHead(r.status, { 'content-type': r.type, 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : r.body);
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.argv[2] || process.env.PORT || 4173);
  const server = await startPlantedSite(port, process.env.HOST || '127.0.0.1');
  console.log(`planted site on http://127.0.0.1:${server.address().port}/`);
}
