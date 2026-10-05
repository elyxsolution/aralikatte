// Aralikatte Cafe — static build.
//
//   npm run images   (only when photos change)  -> assets/img/*.webp
//   npm run build                               -> index.html, menu/, our-story/, ...
//
// The site is a client-rendered "dc" app (src/app.src.html + support.js). On its
// own, the HTML a crawler downloads is an unrendered template full of {{ }}
// placeholders and an empty <head>. This script fixes that without touching the
// design: it renders every route in headless Chrome, captures the finished DOM
// as a static snapshot, and writes one complete HTML file per route with a real
// <head> (title, description, canonical, Open Graph, JSON-LD). The app still
// boots on top of the snapshot exactly as before and replaces it.
//
// Requires: Node 18+, `npm i`, and a local Chrome/Chromium (set CHROME_PATH if
// it is not in a standard location).
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://www.aralikattecafe.in';
const OG_IMAGE = `${SITE}/assets/og-aralikatte-cafe.jpg`;
const OG_ALT = 'Aralikatte Cafe — pure vegetarian South Indian cafe in Subramanyapura, Bengaluru';
const MAPS_URL = 'https://maps.app.goo.gl/4aAoSGyCKxMjMUbf7';

// ---------------------------------------------------------------------------
// Business facts (single source for <head>, JSON-LD and sitemap). These mirror
// the visible copy; change them in both places together.
//
// OPENING HOURS — DELIBERATELY NOT EMITTED IN STRUCTURED DATA.
// The site says 6:00 AM – 1:00 AM daily; external business data reports
// 6:30 AM – 11:00 PM. Until the owner confirms which is right, hours are left
// out of JSON-LD and the meta descriptions. Once confirmed, add to RESTAURANT:
//   openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification',
//     dayOfWeek: [...7 days], opens: 'HH:MM', closes: 'HH:MM' }]
// and update the visible copy (grep "6:00 AM" in src/app.src.html).
// ---------------------------------------------------------------------------
const RESTAURANT = {
  '@type': 'Restaurant',
  '@id': `${SITE}/#restaurant`,
  name: 'Aralikatte Cafe',
  url: `${SITE}/`,
  logo: `${SITE}/assets/aralikatte-logo.jpg`,
  image: [OG_IMAGE, `${SITE}/assets/aralikatte-hero-thali.jpg`],
  description: 'Pure vegetarian South Indian cafe on 80 Feet Road, Subramanyapura, Bengaluru, serving dosa, idli, Karnataka meals and filter coffee, with catering for events.',
  telephone: '+91 78995 42233',
  servesCuisine: ['South Indian', 'Karnataka'],
  suitableForDiet: 'https://schema.org/VegetarianDiet',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '75, 80 Feet Rd, Banashankari 6th Stage 1st Block, Jayanagar Housing Society Layout, Subramanyapura',
    addressLocality: 'Bengaluru',
    addressRegion: 'Karnataka',
    postalCode: '560061',
    addressCountry: 'IN'
  },
  geo: { '@type': 'GeoCoordinates', latitude: 12.8908174, longitude: 77.5342263 },
  hasMap: MAPS_URL,
  sameAs: ['https://www.instagram.com/aralikattecafe/', 'https://www.facebook.com/share/1EnuhBUWmh/?mibextid=wwXIfr']
  // No aggregateRating / review: none are held on the site and none may be invented.
};

const ROUTES = [
  {
    key: 'home', dir: '', url: `${SITE}/`, changefreq: 'weekly', priority: '1.0',
    title: 'Aralikatte Cafe | South Indian Vegetarian Cafe in Subramanyapura, Bengaluru',
    description: 'Aralikatte Cafe is a pure vegetarian South Indian cafe on 80 Feet Road, Subramanyapura, Bengaluru. Enjoy dosa, idli, Karnataka meals, filter coffee and catering.',
    lcp: 'aralikatte-hero-thali', lcpSizes: '100vw'
  },
  {
    key: 'menu', dir: 'menu', url: `${SITE}/menu/`, changefreq: 'weekly', priority: '0.9',
    title: 'South Indian Vegetarian Menu | Aralikatte Cafe, Subramanyapura, Bengaluru',
    description: 'Browse the Aralikatte Cafe menu — breakfast tiffins, dosa, idli, rice items, South, Mudde and Arogya meals, snacks, filter coffee and tea. Pure vegetarian, on 80 Feet Road, Subramanyapura, Bengaluru.'
  },
  {
    key: 'story', dir: 'our-story', url: `${SITE}/our-story/`, changefreq: 'monthly', priority: '0.6',
    title: 'Our Story | Aralikatte Cafe, South Indian Vegetarian Cafe in Bengaluru',
    description: 'The story of Aralikatte Cafe — a pure vegetarian South Indian cafe in Subramanyapura, Bengaluru, built around Karnataka food, Katte culture, music and togetherness.',
    lcp: 'aralikatte-cafe-exterior', lcpSizes: '(max-width:768px) 100vw, 1240px'
  },
  {
    key: 'gallery', dir: 'gallery', url: `${SITE}/gallery/`, changefreq: 'monthly', priority: '0.6',
    title: 'Gallery | Aralikatte Cafe, South Indian Food in Subramanyapura, Bengaluru',
    description: 'Photos from Aralikatte Cafe — idli, meals, puliyogare and filter coffee on banana leaves, and the cafe on 80 Feet Road, Subramanyapura, Bengaluru.'
  },
  {
    key: 'catering', dir: 'catering', url: `${SITE}/catering/`, changefreq: 'monthly', priority: '0.7',
    title: 'South Indian Catering in Bengaluru | Aralikatte Cafe',
    description: 'Vegetarian South Indian catering in Bengaluru from Aralikatte Cafe — for corporate events, office gatherings, family functions, celebrations and community events. Call +91 78995 42233 to plan yours.',
    lcp: 'aralikatte-hero-breakfast', lcpSizes: '100vw'
  },
  {
    key: 'contact', dir: 'contact', url: `${SITE}/contact/`, changefreq: 'monthly', priority: '0.5',
    title: 'Contact & Location | Aralikatte Cafe, 80 Feet Road, Subramanyapura',
    description: 'Find Aralikatte Cafe at 75, 80 Feet Rd, Banashankari 6th Stage 1st Block, Subramanyapura, Bengaluru 560061. Call +91 78995 42233 for orders, enquiries and catering.'
  }
];

const REACT_CDN = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': '/vendor/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': '/vendor/react-dom.production.min.js'
};

// ------------------------------------------------------------------ source
const src = fs.readFileSync(path.join(ROOT, 'src/app.src.html'), 'utf8');
const IMG = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/img/manifest.json'), 'utf8'));

const tplStart = src.indexOf('<x-dc>') + '<x-dc>'.length;
const tplEnd = src.lastIndexOf('</x-dc>');
let template = src.slice(tplStart, tplEnd);
const logicMatch = /<script type="text\/x-dc" data-dc-script[\s\S]*<\/script>/.exec(src.slice(tplEnd));
if (!logicMatch) throw new Error('logic <script type="text/x-dc"> not found');
let logic = logicMatch[0];

// <helmet><style>…</style></helmet> -> goes in the static <head> instead.
const styleMatch = /<helmet>\s*(<style>[\s\S]*?<\/style>)\s*<\/helmet>/.exec(template);
if (!styleMatch) throw new Error('helmet style block not found');
const appCss = styleMatch[1];
template = template.replace(styleMatch[0], '');
template = template.replace(/<!--[\s\S]*?-->/g, ''); // dev comments: not shipped, and unsafe inside <script>

const picAttrs = (name) => {
  const m = IMG[name];
  if (!m) throw new Error('no optimised image for ' + name + ' — run npm run images');
  const f = (w) => `/assets/img/${name}-${w}.webp`;
  const mid = m.variants.includes(960) ? 960 : m.variants[m.variants.length - 1];
  return { src: f(mid), set: m.variants.map((w) => `${f(w)} ${w}w`).join(', '), w: m.width, h: m.height };
};
template = template.replace(/data-pic="([^"]+)"/g, (_, name) => {
  const p = picAttrs(name);
  return `src="${p.src}" srcSet="${p.set}" width="${p.w}" height="${p.h}"`;
});
if (/\{\{[^}]*\}\}\s*<\/?image-slot/.test(template) || template.includes('image-slot')) throw new Error('image-slot still referenced');

const routeMeta = Object.fromEntries(ROUTES.map((r) => [r.key, { title: r.title, description: r.description, url: r.url }]));
const slimImg = Object.fromEntries(Object.entries(IMG).map(([k, v]) => [k, { width: v.width, height: v.height, variants: v.variants }]));
logic = logic.replace('/*__IMG_MANIFEST__*/{}', JSON.stringify(slimImg)).replace('/*__ROUTE_META__*/{}', JSON.stringify(routeMeta));
if (logic.includes('__IMG_MANIFEST__') || logic.includes('__ROUTE_META__')) throw new Error('logic placeholders not replaced');

// MENU data (for Menu JSON-LD) — evaluated straight from the app logic so the
// structured data can never drift from what the page shows.
const menuSrc = logic.slice(logic.indexOf('function riceItem'), logic.indexOf('// ----', logic.indexOf('const MENU = [')));
const MENU = new Function(`const ALL_CATEGORY_ID='all'; ${menuSrc}; return MENU;`)();

// ------------------------------------------------------------------ helpers
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jsonLd = (obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 1).replace(/</g, '\\u003c')}\n</script>`;

function menuNode() {
  const item = (i) => {
    const o = { '@type': 'MenuItem', name: i.n, suitableForDiet: 'https://schema.org/VegetarianDiet' };
    if (i.d) o.description = i.d;
    return o;
  };
  const sections = MENU.filter((c) => c.items.length).map((c) => {
    const sec = { '@type': 'MenuSection', name: c.name };
    const grouped = c.items.some((i) => i.group);
    if (grouped) {
      const groups = [];
      for (const i of c.items) {
        let g = groups.find((x) => x.name === i.group);
        if (!g) { g = { '@type': 'MenuSection', name: i.group, hasMenuItem: [] }; groups.push(g); }
        g.hasMenuItem.push(item(i));
      }
      sec.hasMenuSection = groups;
    } else sec.hasMenuItem = c.items.map(item);
    return sec;
  });
  return { '@type': 'Menu', '@id': `${SITE}/menu/#menu`, name: 'Aralikatte Cafe menu', url: `${SITE}/menu/`, inLanguage: 'en', hasMenuSection: sections };
}

function structuredData(r) {
  const restaurant = { ...RESTAURANT };
  const graph = [restaurant];
  if (r.key === 'menu') { restaurant.hasMenu = { '@id': `${SITE}/menu/#menu` }; graph.push(menuNode()); }
  else restaurant.hasMenu = `${SITE}/menu/`;
  restaurant.menu = `${SITE}/menu/`;
  graph.push({ '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: 'Aralikatte Cafe', inLanguage: 'en-IN', publisher: { '@id': `${SITE}/#restaurant` } });
  const page = { '@type': r.key === 'contact' ? 'ContactPage' : 'WebPage', '@id': `${r.url}#webpage`, url: r.url, name: r.title, description: r.description, inLanguage: 'en-IN', isPartOf: { '@id': `${SITE}/#website` }, about: { '@id': `${SITE}/#restaurant` }, primaryImageOfPage: { '@type': 'ImageObject', url: OG_IMAGE } };
  graph.push(page);
  if (r.key !== 'home') graph.push({ '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Aralikatte Cafe', item: `${SITE}/` },
    { '@type': 'ListItem', position: 2, name: r.title.split(' | ')[0], item: r.url }
  ] });
  return jsonLd({ '@context': 'https://schema.org', '@graph': graph });
}

const LEGACY_REDIRECT = `<script>(function(){var s=location.search;if(location.pathname!=='/'||!s)return;var m=/[?&]page=(menu|story|gallery|catering|contact)(?:&|$)/.exec(s),c=/[?&]category=([a-z-]+)/.exec(s);var p=m?{menu:'menu',story:'our-story',gallery:'gallery',catering:'catering',contact:'contact'}[m[1]]:(c?'menu':null);if(p)location.replace('/'+p+'/'+(c?'?category='+c[1]:'')+location.hash)})();</script>`;

function head(r) {
  const lcp = r.lcp ? picAttrs(r.lcp) : null;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)}</title>
<meta name="description" content="${esc(r.description)}">
<link rel="canonical" href="${r.url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0D0D0F">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Aralikatte Cafe">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(r.title)}">
<meta property="og:description" content="${esc(r.description)}">
<meta property="og:url" content="${r.url}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(OG_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(r.title)}">
<meta name="twitter:description" content="${esc(r.description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta name="twitter:image:alt" content="${esc(OG_ALT)}">
<link rel="icon" href="/assets/aralikatte-logo.jpg">
<link rel="apple-touch-icon" href="/assets/aralikatte-logo.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
${lcp ? `<link rel="preload" as="image" href="${lcp.src}" imagesrcset="${lcp.set}" imagesizes="${esc(r.lcpSizes)}" fetchpriority="high">\n` : ''}<link rel="preload" as="script" href="/vendor/react.production.min.js">
<link rel="preload" as="script" href="/vendor/react-dom.production.min.js">
${structuredData(r)}
${r.key === 'home' ? LEGACY_REDIRECT + '\n' : ''}${appCss}
<style>
/* the raw template host must never show, even if the runtime fails to load */
x-dc{display:none!important}
/* prerendered snapshot only: pick the header that matches the viewport */
.snap-wide,.snap-narrow{display:contents}.snap-narrow,.snap-sticky{display:none}
@media (max-width:1119px){.snap-wide{display:none}.snap-narrow{display:contents}}
@media (max-width:759px){.snap-sticky{display:contents}}
</style>`;
}

const SNAP_REMOVER = `<script>(function(){var s=document.getElementById('snap');if(!s)return;window.__snapshotBoot=true;var mo=new MutationObserver(function(){var r=document.getElementById('dc-root');if(r&&r.querySelector('main')){mo.disconnect();if(s.parentNode)s.parentNode.removeChild(s);window.dispatchEvent(new Event('scroll'))}});mo.observe(document.body,{childList:true,subtree:true})})();</script>`;

function assemble(r, snapshot) {
  // The template is shipped inside an inert <script> so crawlers never see
  // {{ }} placeholders as page text; a tiny shim rebuilds <x-dc> from it before
  // the runtime boots.
  return `<!DOCTYPE html>
<html lang="en-IN">
<head>
${head(r)}
</head>
<body>
${snapshot ? `<div id="snap">${snapshot}</div>\n${SNAP_REMOVER}\n` : ''}<script type="text/x-dc-template" id="dc-template">${template}</script>
<script>(function(){var t=document.getElementById('dc-template'),x=document.createElement('x-dc');x.innerHTML=t.textContent;document.body.appendChild(x)})();window.__resources=${JSON.stringify(REACT_CDN)};</script>
<script src="/support.js" defer></script>
${logic}
</body>
</html>
`;
}

// ------------------------------------------------------------------ prerender
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain' };
function startServer() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.searchParams.has('__nosnap')) {
      const r = ROUTES.find((x) => '/' + (x.dir ? x.dir + '/' : '') === u.pathname);
      if (r) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(assemble(r, null)); }
    }
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || /[\\/](src|scripts|node_modules)[\\/]/.test(f)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

function findChrome() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const found = c.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found — set CHROME_PATH');
  return found;
}

async function render(browser, port, r, width) {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900, isMobile: width < 800, hasTouch: width < 800 });
  await page.goto(`http://localhost:${port}/${r.dir ? r.dir + '/' : ''}?__nosnap=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dc-root main', { timeout: 30000 });
  await new Promise((res) => setTimeout(res, 400));
  return page;
}

async function snapshotFor(browser, port, r) {
  // narrow render supplies the mobile header + sticky bar; wide render is the base.
  const pn = await render(browser, port, r, 390);
  const narrow = await pn.evaluate(() => {
    const root = document.getElementById('dc-root');
    const header = root.querySelector('header');
    const fixed = [...root.querySelectorAll('div')].find((d) => d.style.position === 'fixed' && d.style.bottom === '0px');
    return { header: header ? header.outerHTML : '', sticky: fixed ? fixed.outerHTML + (fixed.nextElementSibling ? fixed.nextElementSibling.outerHTML : '') : '' };
  });
  await pn.close();
  const pw = await render(browser, port, r, 1440);
  const html = await pw.evaluate((narrow) => {
    const clone = document.getElementById('dc-root').cloneNode(true);
    // content is shown fully in the snapshot: drop the entrance-animation start state
    clone.querySelectorAll('[data-reveal]').forEach((el) => {
      ['opacity', 'transform', 'transition'].forEach((p) => el.style.removeProperty(p));
      el.removeAttribute('data-revealed');
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    const header = clone.querySelector('header');
    const wrap = (cls, inner) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = inner; return d; };
    if (header) {
      const w = wrap('snap-wide', ''); header.replaceWith(w); w.appendChild(header);
      w.insertAdjacentElement('afterend', wrap('snap-narrow', narrow.header));
    }
    const host = clone.firstElementChild;
    if (narrow.sticky) host.firstElementChild.appendChild(wrap('snap-sticky', narrow.sticky));
    return clone.innerHTML.replace(/ data-dc-tpl="\d+"/g, '');
  }, narrow);
  await pw.close();
  return html;
}

// ------------------------------------------------------------------ run
const server = await startServer();
const port = server.address().port;
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: 'new' });
try {
  for (const r of ROUTES) {
    const snap = await snapshotFor(browser, port, r);
    if (/\{\{|sc-placeholder|sc-missing/.test(snap)) throw new Error(`unresolved template content in snapshot for ${r.key}`);
    const dir = path.join(ROOT, r.dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), assemble(r, snap));
    console.log('built', '/' + (r.dir ? r.dir + '/' : ''), `(${(snap.length / 1024).toFixed(0)} KB snapshot)`);
  }
} finally {
  await browser.close();
  server.close();
}

const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ROUTES.map((r) => `  <url>\n    <loc>${r.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`);
console.log('wrote sitemap.xml, robots.txt');
