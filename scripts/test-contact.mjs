// Tests for the enquiry backend (api/contact.js) and both website forms.
//
//   node scripts/test-contact.mjs          server unit tests + browser form tests,
//                                          against a stubbed Apps Script (no email sent)
//   node scripts/test-contact.mjs --live   additionally sends the two real test
//                                          enquiries through the Apps Script in
//                                          .env.local (emails the cafe inbox)
import fs from 'fs';
import path from 'path';
import http from 'http';
import { Readable } from 'stream';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const LIVE = process.argv.includes('--live');
let failures = 0;
const check = (cond, label) => { if (cond) console.log('  ok  ', label); else { failures++; console.log('  FAIL', label); } };

function loadEnvLocal() {
  const f = path.join(ROOT, '.env.local');
  if (!fs.existsSync(f)) return {};
  return Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => /^\s*[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}

// ----------------------------------------------------------- stubbed upstream
const realFetch = globalThis.fetch;
const upstream = { calls: [], reply: () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } }), delay: 0 };
function stubFetch() {
  globalThis.fetch = async (url, opts) => {
    if (!String(url).startsWith('https://script.google.com/')) return realFetch(url, opts);
    upstream.calls.push(Object.fromEntries(new URLSearchParams(opts.body)));
    if (upstream.delay) await new Promise((r) => setTimeout(r, upstream.delay));
    return upstream.reply();
  };
}
process.env.GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TEST_DEPLOYMENT/exec';
process.env.GOOGLE_APPS_SCRIPT_SECRET = 'test-secret';
stubFetch();
// fresh module per section: the handler keeps per-instance duplicate/rate memory
const freshHandler = () => { const m = require.resolve(path.join(ROOT, 'api/contact.js')); delete require.cache[m]; return require(m); };
let handler = freshHandler();

let ipSeq = 0;
async function call({ method = 'POST', body, headers = {}, raw } = {}) {
  const payload = raw !== undefined ? raw : body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(payload ? [payload] : []);
  req.method = method;
  req.headers = { 'content-type': 'application/json', host: 'www.aralikattecafe.in', 'x-forwarded-for': '10.0.0.' + (++ipSeq % 250), ...headers };
  const res = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } };
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) { /* not json */ }
  return { status: res.statusCode, json, headers: res.headers };
}
const GENERAL = { formType: 'general', name: 'Test User', phone: '+91 9999999999', email: 'test@example.com', message: 'This is a test contact submission.', website: '', elapsedMs: 5000 };
const CATERING = { formType: 'catering', name: 'Test User', phone: '+91 9999999999', email: 'test@example.com', eventDate: '15-11-2026', guests: '100', eventType: 'Wedding', location: 'Bengaluru', message: 'This is a test catering enquiry.', website: '', elapsedMs: 5000 };

// ----------------------------------------------------------- 1. server tests
console.log('# server (api/contact.js) — stubbed Apps Script');
{
  let r = await call({ method: 'GET' });
  check(r.status === 405 && r.json.success === false && r.headers.allow === 'POST', 'GET -> 405');
  r = await call({ body: GENERAL, headers: { 'content-type': 'text/plain' } });
  check(r.status === 415, 'non-JSON content type -> 415');
  r = await call({ body: GENERAL, headers: { origin: 'https://evil.example' } });
  check(r.status === 403, 'foreign Origin -> 403');
  r = await call({ raw: '{not json' });
  check(r.status === 400 && r.json.success === false, 'malformed JSON -> 400');
  r = await call({ raw: JSON.stringify({ ...GENERAL, message: 'x'.repeat(20000) }) });
  check(r.status === 413, 'oversized body -> 413');
  r = await call({ body: { ...GENERAL, formType: 'other' } });
  check(r.status === 400, 'unknown formType -> 400');

  upstream.calls = [];
  r = await call({ body: { ...GENERAL, website: 'http://spam.example' } });
  check(r.status === 200 && r.json.success === true && upstream.calls.length === 0, 'honeypot filled -> fake success, nothing sent');
  r = await call({ body: { ...GENERAL, elapsedMs: 300 } });
  check(r.status === 400 && upstream.calls.length === 0, 'submitted too fast -> 400, nothing sent');
  r = await call({ body: { ...GENERAL, elapsedMs: undefined } });
  check(r.status === 400, 'missing timing field -> 400');

  r = await call({ body: { ...GENERAL, name: '   ', phone: '', message: '\n\t ' } });
  check(r.status === 400 && r.json.errors && r.json.errors.name && r.json.errors.phone && r.json.errors.message && !r.json.errors.email, 'general: empty/whitespace required fields rejected, email optional');
  r = await call({ body: { ...GENERAL, email: 'not-an-email' } });
  check(r.status === 400 && r.json.errors.email, 'invalid email rejected');
  r = await call({ body: { ...GENERAL, phone: 'call me' } });
  check(r.status === 400 && r.json.errors.phone, 'invalid phone rejected');
  r = await call({ body: { ...GENERAL, name: 'x'.repeat(101) } });
  check(r.status === 400 && r.json.errors.name, 'over-long name rejected');
  r = await call({ body: { formType: 'catering', name: 'A', phone: '9999999999', website: '', elapsedMs: 5000 } });
  check(r.status === 400 && ['eventDate', 'guests', 'eventType', 'location', 'message'].every((k) => r.json.errors[k]), 'catering: all event fields required');
  r = await call({ body: { ...CATERING, eventDate: '2020-01-01' } });
  check(r.status === 400 && /today or later/.test(r.json.errors.eventDate), 'past event date rejected');
  r = await call({ body: { ...CATERING, eventDate: '31-02-2027' } });
  check(r.status === 400 && r.json.errors.eventDate, 'impossible date rejected');
  r = await call({ body: { ...CATERING, guests: '0' } });
  check(r.status === 400 && r.json.errors.guests, 'guests must be >= 1');
  r = await call({ body: { ...CATERING, guests: '12abc' } });
  check(r.status === 400 && r.json.errors.guests, 'non-numeric guests rejected');
  r = await call({ body: { ...GENERAL, message: 'see http://a.example http://b.example http://c.example' } });
  check(r.status === 400 && upstream.calls.length === 0, 'more than 2 links -> rejected as spam');

  upstream.calls = [];
  r = await call({ body: GENERAL });
  const g = upstream.calls[0] || {};
  check(r.status === 200 && r.json.success === true && r.json.message === 'Enquiry submitted successfully.', 'general: valid -> 200 {success:true}');
  check(g.formType === 'general' && g.name === 'Test User' && g.phone === '+91 9999999999' && g.email === 'test@example.com' && g.message === 'This is a test contact submission.' && g.secret === 'test-secret', 'general: exact values + secret forwarded (form-urlencoded)');
  check(!('eventDate' in g) && !('guests' in g) && !('eventType' in g) && !('location' in g), 'general: event fields omitted');
  r = await call({ body: GENERAL });
  check(r.status === 200 && upstream.calls.length === 1, 'identical resubmission -> confirmed, not emailed twice');

  upstream.calls = [];
  r = await call({ body: CATERING });
  const c = upstream.calls[0] || {};
  check(r.status === 200 && r.json.success === true, 'catering: valid -> 200 {success:true}');
  check(c.formType === 'catering' && c.eventDate === '15-11-2026' && c.guests === '100' && c.eventType === 'Wedding' && c.location === 'Bengaluru' && c.message === 'This is a test catering enquiry.', 'catering: values preserved, date as DD-MM-YYYY');
  upstream.calls = [];
  await call({ body: { ...CATERING, eventDate: '2026-12-01', message: 'ISO date from the date picker.' } });
  check((upstream.calls[0] || {}).eventDate === '01-12-2026', 'catering: browser date 2026-12-01 -> 01-12-2026');
  upstream.calls = [];
  await call({ body: { ...GENERAL, name: '  Test\u200B   User \u0007', message: 'Line one\r\nLine two\u0000', phone: '+91 98450 00001' } });
  const sc = upstream.calls[0] || {};
  check(sc.name === 'Test User' && sc.message === 'Line one\nLine two', 'sanitising: control/zero-width chars stripped, whitespace tidied, line breaks kept');

  upstream.reply = () => new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 200 });
  r = await call({ body: { ...GENERAL, message: 'Upstream says no.' } });
  check(r.status === 502 && r.json.success === false && r.json.message === 'Unable to submit your enquiry.', 'Apps Script reports failure -> 502, no success shown');
  upstream.reply = () => new Response('<html><title>Error</title>TypeError: x</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  r = await call({ body: { ...GENERAL, message: 'Upstream HTML error page.' } });
  check(r.status === 502, 'Apps Script HTML error page -> 502');
  upstream.reply = () => new Response('Server error', { status: 500 });
  r = await call({ body: { ...GENERAL, message: 'Upstream 500.' } });
  check(r.status === 502, 'Apps Script HTTP 500 -> 502');
  upstream.reply = () => new Response('OK', { status: 200 });
  r = await call({ body: { ...GENERAL, message: 'Upstream plain OK.' } });
  check(r.status === 200, 'Apps Script plain "OK" -> success');
  upstream.reply = () => new Response(JSON.stringify({ success: true }), { status: 200 });

  const saved = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  delete process.env.GOOGLE_APPS_SCRIPT_SECRET;
  r = await call({ body: { ...GENERAL, message: 'No secret configured.' } });
  check(r.status === 500 && r.json.success === false, 'missing env config -> 500, no success');
  process.env.GOOGLE_APPS_SCRIPT_SECRET = saved;

  let last;
  for (let i = 0; i < 9; i++) last = await call({ body: { ...GENERAL, message: 'rate ' + i }, headers: { 'x-forwarded-for': '203.0.113.9' } });
  check(last.status === 429 && last.headers['retry-after'], 'burst from one IP -> 429 after 8 requests');
  check(!JSON.stringify(r.json).includes('test-secret') && !JSON.stringify(last.json).includes('script.google.com'), 'responses never leak the secret or Apps Script URL');
}

// ----------------------------------------------------------- 2. browser tests
console.log('\n# browser — real forms -> /api/contact -> stubbed Apps Script');
handler = freshHandler();
{
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/contact') return handler(req, res);
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });

  async function open(route, width = 390) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, isMobile: width < 800, hasTouch: width < 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + route, { waitUntil: 'load' });
    await page.waitForSelector('#dc-root main form');
    await new Promise((r) => setTimeout(r, 2200)); // a person takes longer than the 2s bot threshold
    return { page, errors };
  }
  const fill = (page, values) => page.evaluate((values) => {
    const form = document.querySelector('#dc-root main form');
    for (const [k, v] of Object.entries(values)) { const el = form.elements[k]; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
  }, values);
  const formState = (page) => page.evaluate(() => {
    const form = document.querySelector('#dc-root main form');
    const btn = form && form.querySelector('button[type="submit"]');
    const live = [...document.querySelectorAll('#dc-root [aria-live]')].map((e) => e.textContent).join('|');
    return {
      hasForm: !!form, btnText: btn && btn.textContent.trim(), btnDisabled: btn && btn.disabled,
      alert: (document.querySelector('#dc-root [role="alert"]') || {}).textContent || '',
      success: (document.querySelector('#contact-success, #catering-success') || {}).textContent || '',
      focusedId: document.activeElement && document.activeElement.id, live,
      values: form ? Object.fromEntries([...form.elements].filter((e) => e.name).map((e) => [e.name, e.value])) : null,
      invalid: form ? [...form.querySelectorAll('[aria-invalid="true"]')].map((e) => e.name) : []
    };
  });
  const submit = (page) => page.click('#dc-root main form button[type="submit"]');

  // TEST 1 — general contact form
  {
    upstream.calls = []; upstream.delay = 900;
    const { page, errors } = await open('/contact/');
    await fill(page, { name: 'Test User', phone: '+91 9999999999', email: 'test@example.com', message: 'This is a test contact submission.' });
    await submit(page);
    await submit(page).catch(() => {}); // double click
    await new Promise((r) => setTimeout(r, 250));
    const mid = await formState(page);
    check(mid.btnDisabled === true && mid.btnText === 'Sending…' && /Sending/.test(mid.live), 'general: button disabled + "Sending…" + live status while waiting');
    await page.waitForSelector('#contact-success', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 150));
    const done = await formState(page);
    const sent = upstream.calls[0] || {};
    check(upstream.calls.length === 1, 'general: double click sent exactly one request');
    check(sent.formType === 'general' && sent.name === 'Test User' && sent.phone === '+91 9999999999' && sent.email === 'test@example.com' && sent.message === 'This is a test contact submission.', 'general: exact values reached Apps Script');
    check(/Thank you — your message is noted/.test(done.success) && done.focusedId === 'contact-success' && /has been sent/.test(done.live), 'general: existing thank-you shown, focused, announced');
    check(errors.length === 0, 'general: no page errors' + (errors.length ? ' ' + errors.join('; ') : ''));
    await page.close();
  }
  // TEST 2 — catering form (UI offers no "Wedding"; the API test above covers it)
  {
    upstream.calls = []; upstream.delay = 300;
    const { page, errors } = await open('/catering/');
    const st0 = await formState(page);
    check(st0.btnText === 'Send Catering Enquiry', 'catering: button label unchanged at rest');
    await fill(page, { name: 'Test User', phone: '+91 9999999999', email: 'test@example.com', eventDate: '2026-11-15', guests: '100', eventType: 'Celebration', location: 'Bengaluru', message: 'This is a test catering enquiry.' });
    await submit(page);
    await page.waitForSelector('#catering-success', { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 150)); // focus moves on the next animation frame
    const c = upstream.calls[0] || {};
    check(c.formType === 'catering' && c.eventDate === '15-11-2026' && c.guests === '100' && c.eventType === 'Celebration' && c.location === 'Bengaluru' && c.message === 'This is a test catering enquiry.', 'catering: values preserved (date 15-11-2026, guests 100, type, location)');
    const done = await formState(page);
    check(/catering enquiry is noted/.test(done.success) && done.focusedId === 'catering-success', 'catering: existing thank-you shown and focused');
    check(errors.length === 0, 'catering: no page errors');
    await page.close();
  }
  // failure path: Apps Script down -> error shown, values kept, button re-enabled
  {
    upstream.calls = []; upstream.delay = 0;
    upstream.reply = () => new Response('Service unavailable', { status: 503 });
    const { page } = await open('/catering/');
    await fill(page, { name: 'Keep Me', phone: '+91 98450 00002', email: '', eventDate: '2026-12-20', guests: '40', eventType: 'Birthday', location: 'Jayanagar', message: 'Failure path test.' });
    await submit(page);
    await page.waitForSelector('#dc-root [role="alert"]', { timeout: 10000 });
    const st = await formState(page);
    check(/Unable to submit your enquiry\. Please try again, or call us on \+91 78995 42233\./.test(st.alert), 'failure: clear error message (role=alert)');
    check(st.values.name === 'Keep Me' && st.values.guests === '40' && st.values.eventType === 'Birthday' && st.values.message === 'Failure path test.', 'failure: entered values preserved');
    check(st.btnDisabled === false && st.btnText === 'Send Catering Enquiry' && !st.success, 'failure: button re-enabled, no success shown');
    upstream.reply = () => new Response(JSON.stringify({ success: true }), { status: 200 });
    await submit(page);
    await page.waitForSelector('#catering-success', { timeout: 10000 });
    check(true, 'failure: retry after recovery succeeds');
    await page.close();
  }
  // server-side validation surfaced in the UI (passes the browser's own checks)
  {
    upstream.calls = [];
    const { page } = await open('/contact/');
    await fill(page, { name: 'Test User', phone: '+91 9999999999', email: 'test@localhost', message: 'Validation test.' });
    await submit(page);
    await page.waitForSelector('#dc-root [role="alert"]', { timeout: 10000 });
    const st = await formState(page);
    check(/valid email/.test(st.alert) && st.invalid.includes('email') && upstream.calls.length === 0, 'validation: server error shown, field marked aria-invalid, nothing sent');
    await page.close();
  }
  // browser-side required fields block submission (keyboard Enter submits)
  {
    upstream.calls = [];
    const { page } = await open('/contact/');
    await page.focus('#dc-root main form input[name="name"]');
    await page.keyboard.type('Only Name');
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 600));
    const st = await formState(page);
    check(upstream.calls.length === 0 && st.hasForm && !st.success, 'required fields enforced before sending (Enter key submit)');
    await page.close();
  }
  // honeypot from the real form
  {
    upstream.calls = [];
    const { page } = await open('/contact/');
    const hp = await page.evaluate(() => { const el = document.querySelector('#dc-root .hp-field'); const r = el.getBoundingClientRect(); return r.right < 0 && el.getAttribute('aria-hidden') === 'true' && el.querySelector('input').tabIndex === -1; });
    check(hp, 'honeypot: field is off-screen, hidden from screen readers, not tabbable');
    await fill(page, { name: 'Bot', phone: '+91 9000000000', message: 'Buy now', website: 'http://spam.example' });
    await submit(page);
    await page.waitForSelector('#contact-success', { timeout: 10000 });
    check(upstream.calls.length === 0, 'honeypot: bot submission not forwarded');
    await page.close();
  }
  await browser.close();
  server.close();
}

// ----------------------------------------------------------- 3. live
if (LIVE) {
  console.log('\n# live — real Google Apps Script from .env.local (sends 2 emails)');
  globalThis.fetch = realFetch;
  handler = freshHandler();
  const env = loadEnvLocal();
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) { failures++; console.log('  FAIL .env.local is missing GOOGLE_APPS_SCRIPT_URL / GOOGLE_APPS_SCRIPT_SECRET'); }
  else {
    process.env.GOOGLE_APPS_SCRIPT_URL = env.GOOGLE_APPS_SCRIPT_URL;
    process.env.GOOGLE_APPS_SCRIPT_SECRET = env.GOOGLE_APPS_SCRIPT_SECRET;
    const t1 = await call({ body: GENERAL, headers: { 'x-forwarded-for': '198.51.100.1' } });
    console.log('  TEST 1 general  ->', t1.status, JSON.stringify(t1.json));
    check(t1.status === 200 && t1.json.success === true, 'TEST 1 general enquiry accepted by Apps Script');
    const t2 = await call({ body: CATERING, headers: { 'x-forwarded-for': '198.51.100.2' } });
    console.log('  TEST 2 catering ->', t2.status, JSON.stringify(t2.json));
    check(t2.status === 200 && t2.json.success === true, 'TEST 2 catering enquiry accepted by Apps Script');
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL CONTACT TESTS PASSED');
process.exit(failures ? 1 : 0);
