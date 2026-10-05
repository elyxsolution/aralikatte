// Post-build checks. Usage: npm run verify [-- --shots]
//  - static: placeholders, <head> tags, JSON-LD, sitemap, robots, internal links
//  - browser: every route x width (with and without JS): overflow, images, boot,
//    console errors, heading structure, alt text
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.argv.includes('--shots');
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, '.shots');
const ROUTES = ['/', '/menu/', '/our-story/', '/gallery/', '/catering/', '/contact/'];
const WIDTHS = [320, 360, 375, 390, 412, 768, 1024, 1280, 1440];
const SITE = 'https://www.aralikattecafe.in';
let failures = 0;
const fail = (m) => { failures++; console.log('  FAIL', m); };
const ok = (m) => console.log('  ok  ', m);

// ------------------------------------------------------------ static checks
console.log('# static');
const pageFile = (r) => path.join(ROOT, r === '/' ? '' : r, 'index.html');
for (const r of ROUTES) {
  const html = fs.readFileSync(pageFile(r), 'utf8');
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  console.log(r);
  if (/\{\{|\}\}/.test(visible)) fail('unresolved {{ }} in crawlable HTML'); else ok('no {{ }} placeholders outside inert <script> blocks');
  const canon = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]);
  const want = SITE + r;
  if (canon.length === 1 && canon[0] === want) ok('canonical ' + want); else fail('canonical ' + JSON.stringify(canon) + ' expected ' + want);
  for (const tag of ['<title>', 'name="description"', 'property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:url"', 'property="og:type"', 'name="twitter:card"', 'name="twitter:title"', 'name="twitter:description"', 'name="twitter:image"'])
    if (!html.includes(tag)) fail('missing ' + tag);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (ld.length !== 1) fail('expected 1 JSON-LD block, found ' + ld.length);
  else {
    try {
      const j = JSON.parse(ld[0][1]);
      const types = j['@graph'].map((g) => g['@type']);
      const rest = j['@graph'].find((g) => g['@type'] === 'Restaurant');
      if (rest.aggregateRating || rest.review) fail('rating/review present');
      if (rest.openingHoursSpecification) fail('opening hours present but unconfirmed');
      ok('JSON-LD valid JSON: ' + types.join(', '));
    } catch (e) { fail('JSON-LD parse: ' + e.message); }
  }
  const h1 = (visible.match(/<h1[\s>]/g) || []).length;
  if (h1 === 1) ok('exactly one <h1> in static HTML'); else fail('h1 count ' + h1);
  const imgs = [...visible.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  const noAlt = imgs.filter((t) => !/\balt="/.test(t));
  if (noAlt.length) fail(noAlt.length + ' <img> without alt'); else ok(imgs.length + ' static <img>, all with alt');
  for (const t of imgs) {
    for (const m of t.matchAll(/(?:src|srcset)="([^"]+)"/g)) for (const u of m[1].split(',').map((x) => x.trim().split(' ')[0])) {
      if (u.startsWith('/') && !fs.existsSync(path.join(ROOT, u))) fail('missing image file ' + u);
    }
  }
  const links = [...visible.matchAll(/<a\b[^>]*href="([^"#?]*)[^"]*"/g)].map((m) => m[1]).filter((h) => h.startsWith('/'));
  for (const l of new Set(links)) if (!fs.existsSync(path.join(ROOT, l, l.endsWith('/') ? 'index.html' : ''))) fail('broken internal link ' + l);
  ok(new Set(links).size + ' distinct internal links resolve');
}
console.log('sitemap.xml / robots.txt');
const sm = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (JSON.stringify(locs) === JSON.stringify(ROUTES.map((r) => SITE + r))) ok('sitemap lists exactly the 6 canonical URLs, no params'); else fail('sitemap URLs ' + locs.join(' '));
const robots = fs.readFileSync(path.join(ROOT, 'robots.txt'), 'utf8');
if (/User-agent: \*\s+Allow: \/\s+Sitemap: https:\/\/www\.aralikattecafe\.in\/sitemap\.xml/.test(robots) && !/Disallow/i.test(robots)) ok('robots.txt allows all and points at sitemap'); else fail('robots.txt unexpected');

// ------------------------------------------------------------ browser checks
console.log('\n# browser');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
const EXTERNAL = /fonts\.(googleapis|gstatic)\.com|google\.com\/maps|gstatic|googleusercontent/;

for (const r of ROUTES) {
  console.log(r);
  for (const w of WIDTHS) {
    for (const js of [false, true]) {
      const page = await browser.newPage();
      // "nojs" = the app never boots (support.js blocked), i.e. what a crawler/no-JS visitor gets: the prerendered snapshot.
      if (!js) { await page.setRequestInterception(true); page.on('request', (q) => (/\/support\.js$/.test(q.url()) ? q.abort() : q.continue())); }
      await page.setViewport({ width: w, height: 800, isMobile: w < 800, hasTouch: w < 800 });
      const problems = [];
      page.on('pageerror', (e) => problems.push('pageerror: ' + e.message.slice(0, 120)));
      page.on('console', (m) => { if (m.type() === 'error' && !EXTERNAL.test(m.text()) && !/Failed to load resource.*(ERR_|40[34])/.test(m.text())) problems.push('console: ' + m.text().slice(0, 120)); });
      page.on('requestfailed', (q) => { if (!EXTERNAL.test(q.url()) && !/support\.js$/.test(q.url())) problems.push('request failed: ' + q.url().slice(0, 100)); });
      page.on('response', (q) => { if (q.status() >= 400 && !EXTERNAL.test(q.url())) problems.push(q.status() + ' ' + q.url().slice(0, 100)); });
      await page.goto(base + r, { waitUntil: 'load' });
      if (js) { await page.waitForSelector('#dc-root main', { timeout: 20000 }).catch(() => problems.push('app did not boot')); await new Promise((x) => setTimeout(x, 500)); }
      // scroll through the page so lazy images load
      await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise((x) => setTimeout(x, 40)); } window.scrollTo(0, 0); });
      // force-load lazy images (carousel items sit off-screen horizontally) so broken paths surface
      await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.closest('x-dc')).map((i) => { i.loading = 'eager'; return i.complete ? 0 : new Promise((res) => { i.onload = i.onerror = res; setTimeout(res, 5000); }); })));
      await new Promise((x) => setTimeout(x, 300));
      const info = await page.evaluate(() => {
        const de = document.documentElement;
        const vw = window.innerWidth;
        const offenders = [];
        document.querySelectorAll('body *').forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width && b.right > vw + 1 && !el.closest('[data-parallax]') && getComputedStyle(el).position !== 'fixed' && !el.closest('.mc-track') && !el.closest('.snap-wide[style*="none"]')) {
            let p = el, clipped = false;
            while ((p = p.parentElement)) { const o = getComputedStyle(p).overflowX; if (o === 'hidden' || o === 'auto' || o === 'scroll' || o === 'clip') { clipped = true; break; } }
            if (!clipped && b.height) offenders.push(el.tagName + '.' + String(el.className).slice(0, 20) + ' r=' + Math.round(b.right));
          }
        });
        const imgs = [...document.images].filter((i) => !i.closest('x-dc')).filter((i) => i.offsetParent !== null || getComputedStyle(i).position === 'fixed');
        return {
          scrollW: de.scrollWidth, vw,
          offenders: offenders.slice(0, 4),
          snap: !!document.getElementById('snap'),
          h1: [...document.querySelectorAll('h1')].filter((h) => !h.closest('x-dc')).length,
          badImgs: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => (i.currentSrc || i.src).slice(-50)),
          noAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
          emptyAltOnContent: imgs.filter((i) => i.getAttribute('alt') === '' && !i.closest('a[aria-label],button[aria-label]')).length,
          placeholders: /\{\{|\}\}/.test(document.body.innerText),
          shadowImgs: [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length
        };
      });
      const tag = `${w}px ${js ? 'app ' : 'snapshot-only'}`;
      const errs = [...problems];
      if (info.scrollW > info.vw) errs.push(`horizontal overflow ${info.scrollW}>${info.vw} ${info.offenders.join(' | ')}`);
      if (info.h1 !== 1) errs.push('h1 count ' + info.h1);
      if (info.badImgs.length) errs.push('images not loaded: ' + info.badImgs.join(', '));
      if (info.noAlt) errs.push(info.noAlt + ' img without alt');
      if (info.placeholders) errs.push('{{ }} visible');
      if (js && info.snap) errs.push('snapshot still present after boot');
      if (js && info.shadowImgs) errs.push('shadow-DOM widgets present');
      if (errs.length) fail(`${tag}: ${errs.join('; ')}`);
      if (SHOTS && (w === 375 || w === 1440 || w === 320 || w === 768) && js) await page.screenshot({ path: path.join(SHOT_DIR, `${r === '/' ? 'home' : r.replace(/\//g, '')}-${w}.png`), fullPage: true });
      await page.close();
    }
  }
  if (!failures) ok('all widths, with and without JS');
}
await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
