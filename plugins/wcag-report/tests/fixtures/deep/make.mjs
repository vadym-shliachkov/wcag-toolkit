// Writes the deep-check fixture pages: for each check a planted page (<check>-bad.html) and a clean one
// (<check>-ok.html). Run: node tests/fixtures/deep/make.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const page = (title, css, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{font:16px sans-serif;margin:20px}${css}</style></head><body>\n${body}\n</body></html>\n`;

const links = Array.from({ length: 30 }, (_, i) => `<p style="margin:40px 0"><a href="#l${i + 1}">Article link ${i + 1}</a></p>`).join('\n');
const slides = '<div class="slide" style="background:#c33">Summer sale</div><div class="slide" style="background:#36c">New collection</div><div class="slide" style="background:#393">Free returns</div>';
const carouselCss = '.carousel{width:600px;height:200px;position:relative;overflow:hidden}.slide{position:absolute;inset:0;color:#fff;font-size:32px;padding:40px;display:none}.slide.on{display:block}';
const carouselJs = "const s=[...document.querySelectorAll('.slide')];let i=0;s[0].classList.add('on');window.__t=setInterval(()=>{s[i].classList.remove('on');i=(i+1)%s.length;s[i].classList.add('on')},1500);";
const textSlides = '<div class="slide on">Spring sale: 20% off seeds</div><div class="slide">Free delivery over 50 euros</div><div class="slide">New: indoor herb kits</div>';
const textCarouselCss = 'body{font:16px/1.5 Arial,sans-serif;color:#222;background:#fff}.carousel{position:relative;height:120px;overflow:hidden;border:1px solid #ccc}.slide{position:absolute;inset:0;display:none;padding:16px}.slide.on{display:block}';
const textCarouselJs = "var s=document.querySelectorAll('.slide'),i=0;window.__t=setInterval(function(){s[i].classList.remove('on');i=(i+1)%s.length;s[i].classList.add('on');},2000);";
const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='32'%3E%3Crect width='60' height='32' fill='%23369'/%3E%3C/svg%3E";
const menu = (alt) => `<button id="t" aria-expanded="false" aria-controls="menu">Menu</button><ul id="menu" hidden><li><a href="#s"><img ${alt} src="${svg}"></a></li><li><a href="#c">Contact</a></li></ul>
<script>const t=document.getElementById('t'),m=document.getElementById('menu');t.onclick=()=>{const o=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',String(!o));m.hidden=o;};</script>`;
const tickerCss = 'body{margin:0}.band{margin-top:40px;height:80px;overflow:hidden;white-space:nowrap;background:#123;color:#fff;font-size:32px;line-height:80px}#news{display:inline-block}';
const tickerText = 'Breaking: new opening hours from Monday — free delivery this week — new menu items every Friday';
const tickerJs = "const n=document.getElementById('news');let x=0;(function step(){if(!window.__stop){x=(x-3)%1400;n.style.transform='translateX('+x+'px)';}requestAnimationFrame(step);})();";
const cardCss = '.cards{display:flex;flex-wrap:wrap;gap:16px}.card{padding:24px;border-radius:12px;background:#f4f3f9;color:#241b38;width:240px;transition:background-color 1.5s ease,color 1.5s ease}.card__label{font-size:20px;font-weight:600;text-transform:uppercase;color:#4963a9;margin:0;transition:color 1.5s ease}.card__title{font-size:32px;font-weight:400;margin:8px 0}.card__text{font-size:16px;margin:0}.card__link{color:inherit}.cta{display:block;margin-top:24px;padding:24px;background:#241b38;color:#fff;text-decoration:none;transition:background-color 1s ease}.cta__eyebrow{font-size:16px;margin:0}.cta__heading{font-size:40px;font-weight:400;margin:8px 0}';
const menuText ='Pizza, pasta and salads, freshly made every day in our kitchen with local ingredients and a lot of care. Order online or call us during opening hours.';

const FIXTURES = {
  'keyboard-bad': page('Keyboard planted', '', `<a href="#a">First link</a>
<div id="widget"><button id="w1">Day 1</button> <button id="w2">Day 2</button></div>
<div id="cart" style="cursor:pointer;padding:8px;background:#eee;width:120px">Add to cart</div>
<a href="#z">Last link</a>
<div id="fav" tabindex="0" style="display:inline-block;padding:8px;background:#eee">Save to favourites</div>
<a href="#help" id="help">Help</a>
<script>
const w1 = document.getElementById('w1'), w2 = document.getElementById('w2');
for (const b of [w1, w2]) b.addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); (document.activeElement === w1 ? w2 : w1).focus(); } });
document.getElementById('cart').addEventListener('click', () => { document.title = 'added'; });
document.getElementById('fav').addEventListener('click', () => { document.title = 'saved'; });
document.getElementById('help').addEventListener('focus', (e) => e.target.blur());
</script>`),
  'keyboard-ok': page('Keyboard clean', '', `<a href="#a">First link</a>
<div><button>Day 1</button> <button>Day 2</button></div>
<button id="cart">Add to cart</button>
<a href="#z">Last link</a>
<div id="fav" tabindex="0" role="button" style="display:inline-block;padding:8px;background:#eee">Save to favourites</div>
<a href="#help">Help</a>
<script>document.getElementById('cart').addEventListener('click', () => { document.title = 'added'; });
const f = document.getElementById('fav'); f.addEventListener('click', () => { document.title = 'saved'; }); f.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') f.click(); });</script>`),
  'focus-bad': page('Focus planted', 'a,button{outline:none!important;color:#036;text-decoration:none} button{border:1px solid #888;background:#fff;padding:6px 10px}',
    '<nav><a href="#1">Home</a> <a href="#2">Products</a> <a href="#3">Contact</a></nav><p><button>Subscribe</button></p>'),
  'focus-ok': page('Focus clean', 'a,button{color:#036} a:focus-visible,button:focus-visible{outline:3px solid #c00;outline-offset:2px} button{border:1px solid #888;background:#fff;padding:6px 10px}',
    '<nav><a href="#1">Home</a> <a href="#2">Products</a> <a href="#3">Contact</a></nav><p><button>Subscribe</button></p>'),
  'obscured-bad': page('Obscured planted', 'body{margin:0} header{position:fixed;top:0;left:0;right:0;height:140px;background:#123;color:#fff;z-index:10} main{padding:160px 20px 20px}',
    `<header><p style="margin:20px">Shop name</p></header><main>${links}</main>`),
  'obscured-ok': page('Obscured clean', 'html{scroll-padding-top:160px} body{margin:0} header{position:fixed;top:0;left:0;right:0;height:140px;background:#123;color:#fff;z-index:10} main{padding:160px 20px 20px}',
    `<header><p style="margin:20px">Shop name</p></header><main>${links}</main>`),
  // A marketing pop-up's transparent full-screen wrapper with a dimming backdrop, and a script-loaded cookie banner
  // (closed by its "Decline" button): neither hides what has focus. The planted page adds a solid bar that does.
  'obscuredoverlay-bad': page('Overlay planted', `html{scroll-padding-top:160px} body{margin:0} header{position:fixed;top:0;left:0;right:0;height:140px;background:#123;color:#fff;z-index:10} main{padding:160px 20px 20px} #anchor{position:fixed;inset:0;pointer-events:none;z-index:9999} #backdrop{position:absolute;inset:0;background:rgba(0,0,0,.7)} .bar{position:fixed;left:0;right:0;bottom:0;height:420px;background:#fff;z-index:20}`,
    `<header><p style="margin:20px">Shop name</p></header><main>${links}</main><div id="anchor"><div id="backdrop"></div></div><div class="bar">Chat with us</div>`),
  'obscuredoverlay-ok': page('Overlay clean', `html{scroll-padding-top:160px;scroll-padding-bottom:160px} body{margin:0} header{position:fixed;top:0;left:0;right:0;height:140px;background:#123;color:#fff;z-index:10} main{padding:160px 20px 20px} #anchor{position:fixed;inset:0;pointer-events:none;z-index:9999} #backdrop{position:absolute;inset:0;background:rgba(0,0,0,.7)} #hs-eu-cookie-confirmation{position:fixed;left:0;right:0;bottom:0;height:136px;background:#fff;z-index:30}`,
    `<header><p style="margin:20px">Shop name</p></header><main>${links}</main><div id="anchor"><div id="backdrop"></div><div id="offer" role="dialog" aria-label="Special offer" style="position:fixed;top:120px;left:200px;width:700px;height:600px;background:#fff;pointer-events:auto;z-index:10000"><p>Sign up for deals</p><button type="button" aria-label="Close" onclick="document.getElementById('anchor').remove()">×</button></div></div>
<div id="hs-eu-cookie-confirmation" class="hs-cookie-notification-position-bottom"><p>This website stores cookies on your computer.</p><a href="#" id="hs-eu-confirmation-button">Accept</a> <a href="#" id="hs-eu-decline-button">Decline</a></div>
<script>document.querySelectorAll('#hs-eu-cookie-confirmation a').forEach((a)=>a.addEventListener('click',(e)=>{e.preventDefault();document.getElementById('hs-eu-cookie-confirmation').remove();}));</script>`),
  // A closed share pop-up kept at opacity 0: its links stay in the Tab order although nobody can see them (2.4.7).
  // The clean page closes it with visibility:hidden, which also takes the links out of the Tab order.
  'obscuredinvisible-bad': page('Invisible focus planted', '.share{position:fixed;top:40px;left:300px;width:300px;padding:20px;background:#fff;border:1px solid #333;opacity:0}',
    `<main><p><a href="#a">First link</a></p><button type="button">Share</button><div class="share"><a href="#mail">Share by email</a> <a href="#copy">Copy the link</a></div><p><a href="#z">Last link</a></p></main>`),
  'obscuredinvisible-ok': page('Invisible focus clean', '.share{position:fixed;top:40px;left:300px;width:300px;padding:20px;background:#fff;border:1px solid #333;opacity:0;visibility:hidden} .arrow{opacity:0;transition:opacity .4s;width:16px;height:12px} .arrow:focus{opacity:1;outline:2px solid #000} .sub{display:inline-block;padding:2px} .sub:focus-within{outline:2px solid #000} .ghost{opacity:0;width:16px;height:12px}',
    `<main><p><a href="#a">First link</a> <button type="button" class="arrow" aria-label="Open submenu"></button> <span class="sub">Colors<button type="button" class="ghost" aria-label="Open Colors submenu"></button></span></p><button type="button">Share</button><div class="share"><a href="#mail">Share by email</a> <a href="#copy">Copy the link</a></div><p><a href="#z">Last link</a></p></main>`),
  'reflow-bad': page('Reflow planted', 'body{margin:8px}.wide{width:1100px;background:#eef}',
    '<h1>Prices</h1><div class="wide"><p>Our prices and the Add to cart button are in this fixed-width column that never wraps on small screens.</p><button>Add to cart</button></div>'),
  'reflow-ok': page('Reflow clean', 'body{margin:8px}.wide{max-width:1100px;background:#eef}',
    '<h1>Prices</h1><div class="wide"><p>Our prices and the Add to cart button are in this column that wraps on small screens.</p><button>Add to cart</button></div><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Basic</td><td>10</td></tr></table>'),
  'spacing-bad': page('Spacing planted', 'body{line-height:1.2}.card{width:300px;height:60px;overflow:hidden;border:1px solid #999;padding:4px}',
    '<div class="card">Free delivery on every order over fifty euros, returns within thirty days.</div>'),
  'spacing-ok': page('Spacing clean', 'body{line-height:1.2}.card{width:300px;min-height:60px;border:1px solid #999;padding:4px}',
    '<div class="card">Free delivery on every order over fifty euros, returns within thirty days.</div>'),
  // Cut off by text-only zoom and by page zoom: the box is a share of the window and never wraps.
  'resize-bad': page('Resize planted', 'body{line-height:20px}.tag{display:block;width:22vw;height:22px;overflow:hidden;white-space:nowrap;background:#eee}',
    '<span class="tag">Delivery in 2 to 3 working days</span>'),
  'zoom-bad': page('Zoom planted', 'h1{font-size:4vw}p{font-size:1.3vw}', `<h1>Fresh pizza every day</h1><p>${menuText}</p>`),
  // Sizes in rem and px grow with text-only zoom, even where a breakpoint makes a heading smaller under page zoom.
  'zoom-ok': page('Zoom clean', 'h1{font-size:2.6rem}p{font-size:1.1rem}small{font-size:13px}@media (max-width:700px){h1{font-size:1.6rem}}', `<h1>Fresh pizza every day</h1><p>${menuText} <small>Prices include tax.</small></p>`),
  'resize-ok': page('Resize clean', '.card{width:300px;min-height:60px;border:1px solid #999;padding:4px}',
    '<div class="card">Free delivery on every order over fifty euros, returns within thirty days.</div>'),
  'hover-bad': page('Hover planted', 'body{margin:40px}.trigger{display:inline-block;padding:4px;border:1px solid #666}.tip{display:none;position:absolute;left:40px;top:120px;width:220px;background:#222;color:#fff;padding:8px}.trigger:hover + .tip{display:block}',
    '<p>Shipping costs <span class="trigger" tabindex="0">?</span><span class="tip" role="tooltip">Shipping is free above 50 euros, otherwise 4.90 euros.</span></p><p>Other text below the tip.</p>'),
  // The same tooltip below a slideshow that moves on while the trigger is pointed at: the slide that appears is not
  // what pointing showed.
  'hoverslide-bad': page('Hover beside a slideshow planted', `${carouselCss}body{margin:40px}.trigger{display:inline-block;padding:4px;border:1px solid #666}.tip{display:none;position:absolute;left:40px;top:320px;width:220px;background:#222;color:#fff;padding:8px}.trigger:hover + .tip{display:block}`,
    `<div class="carousel">${slides}</div><p>Shipping costs <span class="trigger" tabindex="0">?</span><span class="tip" role="tooltip">Shipping is free above 50 euros, otherwise 4.90 euros.</span></p><p>Other text below the tip.</p><script>${carouselJs.replace('1500', '300')}</script>`),
  // A submenu that only the pointer opens.
  'hovermenu-bad': page('Hover menu planted', 'nav ul{list-style:none;margin:0;padding:0}.sub{display:none;padding:8px;background:#eee}.has:hover .sub{display:block}',
    '<nav><ul><li class="has"><a href="#s">Services</a><ul class="sub"><li><a href="#w">Web design</a></li><li><a href="#a">Accessibility audits</a></li></ul></li><li><a href="#c">Contact</a></li></ul></nav><main><p>Welcome.</p></main>'),
  // Hover opens the menu; keyboard users get a separate disclosure button (aria-controls + aria-expanded). The planted
  // page has the same button, but it opens nothing.
  'hovermenubtn-ok': page('Hover menu with button clean', 'nav ul{list-style:none;margin:0;padding:0}.sub{display:none;padding:8px;background:#eee}.has:hover .sub,.sub.open{display:block}',
    `<nav><ul><li class="has"><a href="#s">Services</a><button type="button" aria-expanded="false" aria-controls="sub1" aria-label="Open Services submenu">▾</button><ul class="sub" id="sub1"><li><a href="#w">Web design</a></li><li><a href="#a">Accessibility audits</a></li></ul></li><li><a href="#c">Contact</a></li></ul></nav><main><p>Welcome.</p></main>
<script>document.querySelector('[aria-controls=sub1]').addEventListener('click',(e)=>{const b=e.currentTarget;const o=b.getAttribute('aria-expanded')==='true';b.setAttribute('aria-expanded',String(!o));document.getElementById('sub1').classList.toggle('open',!o);});</script>`),
  'hovermenubtn-bad': page('Hover menu with button planted', 'nav ul{list-style:none;margin:0;padding:0}.sub{display:none;padding:8px;background:#eee}.has:hover .sub{display:block}',
    `<nav><ul><li class="has"><a href="#s">Services</a><button type="button" aria-expanded="false" aria-controls="sub1" aria-label="Open Services submenu">▾</button><ul class="sub" id="sub1"><li><a href="#w">Web design</a></li><li><a href="#a">Accessibility audits</a></li></ul></li><li><a href="#c">Contact</a></li></ul></nav><main><p>Welcome.</p></main>`),
  'hovermenu-ok': page('Hover menu clean', 'nav ul{list-style:none;margin:0;padding:0}.sub{display:none;padding:8px;background:#eee}.has:hover .sub,.has:focus-within .sub{display:block}',
    '<nav><ul><li class="has"><a href="#s">Services</a><ul class="sub"><li><a href="#w">Web design</a></li><li><a href="#a">Accessibility audits</a></li></ul></li><li><a href="#c">Contact</a></li></ul></nav><main><p>Welcome.</p></main>'),
  'hover-ok': page('Hover clean', 'body{margin:40px}.wrap{position:relative;display:inline-block}.trigger{display:inline-block;padding:4px;border:1px solid #666}.tip{display:none;position:absolute;left:0;top:100%;width:220px;background:#222;color:#fff;padding:8px}.wrap:hover .tip,.wrap:focus-within .tip{display:block}.wrap.closed .tip{display:none!important}',
    `<p>Shipping costs <span class="wrap"><span class="trigger" tabindex="0">?</span><span class="tip" role="tooltip">Shipping is free above 50 euros, otherwise 4.90 euros.</span></span></p><p>Other text below the tip.</p>
<script>const w=document.querySelector('.wrap');document.addEventListener('keydown',e=>{if(e.key==='Escape')w.classList.add('closed')});w.addEventListener('mouseleave',()=>w.classList.remove('closed'));</script>`),
  'orientation-bad': page('Orientation planted', '.rotate{display:none}@media (orientation: portrait){main{display:none}.rotate{display:block}}',
    `<p class="rotate">Please rotate your device to landscape to use this site.</p><main><h1>Our menu</h1><p>${menuText}</p><p>${menuText}</p></main>`),
  'orientation-ok': page('Orientation clean', '', `<main><h1>Our menu</h1><p>${menuText}</p><p>${menuText}</p></main>`),
  'motion-bad': page('Motion planted', carouselCss, `<div class="carousel">${slides}</div><p>Text after the slideshow.</p><script>${carouselJs}</script>`),
  // Moved by script frame by frame: no CSS animation and no carousel class to find it by.
  'ticker-bad': page('Ticker planted', tickerCss, `<section><div class="band"><span id="news">${tickerText}</span></div></section><p>Text after the news.</p><script>${tickerJs}</script>`),
  'ticker-ok': page('Ticker clean', tickerCss, `<section><div class="band"><span id="news">${tickerText}</span></div><button id="p">Pause news</button></section><p>Text after the news.</p><script>${tickerJs}document.getElementById('p').onclick=()=>{window.__stop=true};</script>`),
  // Three slides every 2 s: a round of 6 s, so the slideshow is back on its first slide after exactly 6 seconds.
  'motionsix-bad': page('Motion six planted', carouselCss, `<div class="carousel">${slides}</div><p>Text after the slideshow.</p><script>${carouselJs.replace('1500', '2000')}</script>`),
  'motionsix-ok': page('Motion six clean', carouselCss, `<section><div class="carousel">${slides}</div><button id="p">Pause slideshow</button></section><p>Text after the slideshow.</p><script>${carouselJs.replace('1500', '2000')}document.getElementById('p').onclick=()=>clearInterval(window.__t);</script>`),
  // Like a real shop banner: dark text on white, slides switched by class every 2 s. Changing one line of text alters
  // only about 1 % of the pixels, so a pixel count alone misses it.
  'motiontext-bad': page('Motion text planted', textCarouselCss, `<div class="carousel" aria-label="Offers">${textSlides}</div><p>Text after the slideshow.</p><script>${textCarouselJs}</script>`),
  'motiontext-ok': page('Motion text clean', textCarouselCss, `<section><div class="carousel" aria-label="Offers">${textSlides}</div><button id="p">Pause offers</button></section><p>Text after the slideshow.</p><script>${textCarouselJs}document.getElementById('p').onclick=()=>clearInterval(window.__t);</script>`),
  'motion-ok': page('Motion clean', carouselCss, `<section><div class="carousel">${slides}</div><button id="p">Pause slideshow</button></section><p>Text after the slideshow.</p><script>${carouselJs}document.getElementById('p').onclick=()=>clearInterval(window.__t);</script>`),
  'targets-bad': page('Targets planted', '.icons button{width:16px;height:16px;padding:0;margin:0 1px;border:1px solid #333;background:#fff}',
    '<div class="icons"><button aria-label="Share on network A"></button><button aria-label="Share on network B"></button><button aria-label="Share by e-mail"></button></div><p>Read our <a href="#t">terms of service</a> before you order anything from this shop.</p>'),
  'targets-ok': page('Targets clean', '.icons{margin-bottom:24px}.icons button{width:16px;height:16px;padding:0;margin:0 14px;border:1px solid #333;background:#fff}.big button{width:32px;height:32px}',
    '<div class="icons"><button aria-label="Share on network A"></button><button aria-label="Share on network B"></button></div><div class="big"><button aria-label="Menu">≡</button> <button aria-label="Search">⌕</button></div><p>Read our <a href="#t">terms of service</a> before you order anything from this shop. <input type="checkbox" id="c"><label for="c">I agree</label></p>'),
  // Required fields told apart only by a red label; a password field that refuses pasted text.
  'forms-bad': page('Form planted', 'input{border:2px solid #999;display:block;margin:4px 0 12px}input.err{border-color:#d00}label{color:#333}label.req{color:#c00}',
    `<form id="f" novalidate action="/send" method="post" aria-label="Contact"><label class="req" for="n">Name</label><input id="n" name="n" required><label class="req" for="e">E-mail</label><input id="e" name="e" type="email" required><label for="c">Company</label><input id="c" name="company"><label for="pw">Password</label><input id="pw" name="pw" type="password" onpaste="return false"><button>Send</button></form>
<script>document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();for(const i of e.target.querySelectorAll('input'))if(!i.value&&i.required)i.classList.add('err');});</script>`),
  'forms-ok': page('Form clean', 'input{display:block;margin:4px 0 12px}label{color:#333}',
    '<form action="/send" method="post" aria-label="Contact"><label for="n">Name *</label><input id="n" name="n" autocomplete="name" required><label for="e">E-mail *</label><input id="e" name="e" type="email" autocomplete="email" required><label for="c">Company (optional)</label><input id="c" name="company" autocomplete="organization"><label for="pw">Password</label><input id="pw" name="pw" type="password" autocomplete="current-password"><button>Send</button></form>'),
  // A menu that opens at the far end of the page, and one that opens right after its button.
  'toggles-bad': page('Toggles planted', '#m[hidden]{display:none}', `<main><button id="t" aria-expanded="false" aria-controls="m">Menu</button><a href="#1">Next link</a><a href="#2">Another link</a></main><ul id="m" hidden><li><a href="#s">Shop</a></li><li><a href="#c">Contact</a></li></ul>
<script>const t=document.getElementById('t'),m=document.getElementById('m');t.onclick=()=>{const o=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',String(!o));m.hidden=o;};document.addEventListener('keydown',e=>{if(e.key==='Escape'){t.setAttribute('aria-expanded','false');m.hidden=true;}});</script>`),
  'toggles-ok': page('Toggles clean', '#m[hidden]{display:none}', `<main><button id="t" aria-expanded="false" aria-controls="m">Menu</button><ul id="m" hidden><li><a href="#s">Shop</a></li><li><a href="#c">Contact</a></li></ul><a href="#1">Next link</a><a href="#2">Another link</a></main>
<script>const t=document.getElementById('t'),m=document.getElementById('m');t.onclick=()=>{const o=t.getAttribute('aria-expanded')==='true';t.setAttribute('aria-expanded',String(!o));m.hidden=o;};document.addEventListener('keydown',e=>{if(e.key==='Escape'){t.setAttribute('aria-expanded','false');m.hidden=true;}});</script>`),
  // Opening hours dropped from the narrow layout; navigation moved behind a menu button is fine.
  'reflowlost-bad': page('Reflow content planted', '@media (max-width:600px){.extra{display:none}}', `<main><h1>Our kitchen</h1><p>${menuText}</p><p class="extra">Opening hours: Monday to Friday from nine to five, Saturday from ten to two.</p></main>`),
  'reflowlost-ok': page('Reflow content clean', '.burger{display:none}@media (max-width:600px){nav{display:none}.burger{display:inline-block}}', `<header><button class="burger" aria-expanded="false" aria-controls="nav">Menu</button><nav id="nav"><a href="#a">About our kitchen team</a> <a href="#c">Contact and directions</a></nav></header><main><h1>Our kitchen</h1><p>${menuText}</p><p>Opening hours: Monday to Friday from nine to five, Saturday from ten to two.</p></main>`),
  // Text colour set with no background colour anywhere behind it (F24).
  'colour-bad': page('Colour planted', 'body{color:#444}', `<main><h1>Our kitchen</h1><p>${menuText}</p></main>`),
  'colour-ok': page('Colour clean', 'body{color:#444;background:#fff}', `<main><h1>Our kitchen</h1><p>${menuText}</p></main>`),
  // Text that loses contrast only when the pointer is over its card or keyboard focus is inside it, after a 1.5 s fade:
  // white body text on an iris card (its 32 px title is large text and passes), semibold 20 px labels on a lavender card
  // (600 is not bold), a call-to-action eyebrow, and a rule written with CSS nesting.
  'statecontrast-bad': page('State contrast planted', `${cardCss}
@media (hover:hover) and (pointer:fine){.card--iris:hover{background:#8086d4;color:#fff}.card--lav:hover{background:#b9c0ee}}
.card--lav:is(.is-active,:focus-within){background:#b9c0ee}
a.cta:hover{background:#6582d0}
.chip{display:inline-block;padding:8px;background:#fff;color:#555;&:hover{background:#999}}`,
  `<div class="cards"><article class="card card--iris" id="iris"><h3 class="card__title" id="iris-title">Complex cases</h3><p class="card__text" id="iris-text">Serious, high-cost claims handled by field case managers.</p></article>
<article class="card card--lav" id="lav"><p class="card__label" id="lav-label">One</p><h3 class="card__title">People first</h3><p class="card__text">Every decision starts with the person. <a class="card__link" href="#people">Read more</a></p></article></div>
<a class="cta" href="#contact"><p class="cta__eyebrow" id="cta-eyebrow">Let's find the right support</p><h2 class="cta__heading">Move care forward</h2></a>
<p><span class="chip" id="chip">Opening hours</span></p>`),
  // The same cards whose text holds its contrast in every state a visitor can reach. Not reachable, so not tested: a
  // :focus-within style on a card with nothing focusable inside, a print-only hover, a class no visitor can set. Text
  // that already fails at rest is the page's resting problem, not the hover state's. Mid-fade the night card is grey
  // on grey; where the fade ends it is white on dark.
  'statecontrast-ok': page('State contrast clean', `${cardCss}
@media (hover:hover) and (pointer:fine){.card--iris:hover{background:#8086d4}.card--night:hover{background:#241b38;color:#fff}.card--night:hover .card__label{color:#b9c0ee}}
.card--still:focus-within{background:#b9c0ee}
@media print{.card--iris:hover{background:#8086d4;color:#fff}}
.card--iris.is-active{background:#8086d4;color:#fff}
.card--grey:hover{background:#eee}.card--grey .card__text{color:#999}
.card--dark:focus-within{background:#241b38;color:#fff}.card--dark:focus-within .card__label{color:#e6e8f7}
a.cta:hover{background:#4963a9}`,
  `<div class="cards"><article class="card card--iris"><h3 class="card__title">Complex cases</h3><p class="card__text">Serious, high-cost claims handled by field case managers.</p></article>
<article class="card card--night"><p class="card__label">Two</p><p class="card__text">Guidance you can trust when recovery is hard to navigate.</p></article>
<article class="card card--still"><p class="card__label">Three</p><p class="card__text">Better outcomes when care and support work together.</p></article>
<article class="card card--grey"><p class="card__text">Already too faint at rest.</p></article>
<article class="card card--dark"><p class="card__label">Four</p><p class="card__text">Safer workplaces. <a class="card__link" href="#safe">Read more</a></p></article></div>
<a class="cta" href="#contact"><p class="cta__eyebrow">Let's find the right support</p><h2 class="cta__heading">Move care forward</h2></a>`),
  'states-bad': page('States planted', '#menu[hidden]{display:none}#menu li{margin:12px 0}#menu a{display:inline-block;min-height:32px;padding:4px}', menu('')),
  'states-ok': page('States clean', '#menu[hidden]{display:none}#menu li{margin:12px 0}#menu a{display:inline-block;min-height:32px;padding:4px}', menu('alt="Shop"')),
  // A pause button whose state is told only by swapping its hidden name (a clean-up note, not a failure), and the
  // same button with aria-pressed and a fixed name. A form's submit button with "Stop" in it is never pressed.
  'togglename-bad': page('Toggle name planted', '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
    `<div id="anim">Moving logos</div><button id="tg" type="button"><span class="sr-only">Pause the logo animation</span><span aria-hidden="true">⏸</span></button>
<script>const b=document.getElementById('tg'),l=b.querySelector('.sr-only');let p=false;b.onclick=()=>{p=!p;l.textContent=p?'Play the logo animation':'Pause the logo animation';};</script>`),
  'togglename-ok': page('Toggle name clean', '.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
    `<div id="anim">Moving logos</div><button id="tg" type="button" aria-pressed="false"><span class="sr-only">Pause the logo animation</span><span aria-hidden="true">⏸</span></button>
<form><button type="submit" id="sub" onclick="this.textContent='Sent';return false">Stop my subscription</button></form>
<script>const b=document.getElementById('tg');b.onclick=()=>b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));</script>`),
  // Not a check on its own: a skip link whose target is named only by name (<a name>), on a page with no main landmark
  // and no heading after the header. The browser jumps to it, so it works.
  'skipname-ok': page('Skip link by name', '',
    `<a href="#content">Skip to content</a><header><nav><a href="#h">Home</a> <a href="#ab">About</a> <a href="#co">Contact</a></nav></header>
<div><a name="content"></a><p>Welcome to the shop.</p><a href="#more">Read more</a></div>`),
  // The page scrolls sideways at 320 px, but only an empty box sticks out: nothing is shown to be lost.
  'reflowempty-bad': page('Reflow empty box', 'body{margin:8px}.bar{width:900px;height:4px;background:#ccd}', '<p>Short text that fits.</p><div class="bar"></div>'),
  // An order form (a financial commitment) whose script takes the submission and says nothing about a bad e-mail.
  'formsorder-bad': page('Order form', 'input{display:block;margin:4px 0 12px}',
    `<form action="/checkout" method="post" novalidate aria-label="Order"><label for="n">Name</label><input id="n" name="n" autocomplete="name"><label for="e">E-mail</label><input id="e" name="email" type="text" autocomplete="email"><button>Place order</button></form>
<script>document.querySelector('form').addEventListener('submit', (e) => e.preventDefault());</script>`),
  // Not a check: a long page that scrolls smoothly, for the issue crops (an element far down must be cropped where it is).
  'smooth-scroll': page('Smooth scroll', 'html{scroll-behavior:smooth} .spacer{height:4000px} #far{display:inline-block;padding:8px;background:#fc0}',
    '<div class="spacer">Top of the page</div><a id="far" href="#x">Far down link</a><div class="spacer"></div>'),
};

for (const [name, html] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(dir, `${name}.html`), html);
console.log(`wrote ${Object.keys(FIXTURES).length} fixtures`);
