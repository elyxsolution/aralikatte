// POST /api/contact — Vercel serverless function (Node.js runtime, no deps).
//
// Receives both website enquiry forms (general contact + catering), validates
// and sanitises them server-side, applies basic spam protection, then relays
// the enquiry to the cafe's Google Apps Script web app, which sends the email
// to cafearalikatte@gmail.com with MailApp.
//
//   Browser -> /api/contact (this file) -> Google Apps Script -> MailApp -> Gmail
//
// Configuration (Vercel -> Project -> Settings -> Environment Variables; for
// local testing in .env.local, which is git-ignored):
//   GOOGLE_APPS_SCRIPT_URL     https://script.google.com/macros/s/<deployment-id>/exec
//   GOOGLE_APPS_SCRIPT_SECRET  shared secret, also configured in the Apps Script
// Neither value is ever sent to the browser or written to logs. No Gmail
// password is used anywhere: the Apps Script runs as the cafe's Google account.
'use strict';

const crypto = require('crypto');

const OK_MESSAGE = 'Enquiry submitted successfully.';
const FAIL_MESSAGE = 'Unable to submit your enquiry.';
const MAX_BODY_BYTES = 16 * 1024;
const MIN_FILL_MS = 2000; // a person cannot fill these forms faster than this
const RATE_LIMIT = { max: 8, windowMs: 10 * 60 * 1000 };
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 25000; // the Apps Script typically takes ~15s to answer a POST
const MAX_LINKS = 2;
const ALLOWED_ORIGINS = ['https://www.aralikattecafe.in', 'https://aralikattecafe.in'];
const APPS_SCRIPT_URL_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/;

const FIELDS = {
  name: { max: 100, required: 'Please enter your name.' },
  phone: { max: 20, required: 'Please enter your phone number.' },
  email: { max: 254 },
  eventDate: { max: 10, required: 'Please choose the event date.' },
  guests: { max: 5, required: 'Please enter the number of guests.' },
  eventType: { max: 60, required: 'Please choose the event type.' },
  location: { max: 150, required: 'Please enter the event location.' },
  message: { max: 2000, multiline: true, required: 'Please enter a message.' }
};
const FORMS = {
  general: ['name', 'phone', 'email', 'message'],
  catering: ['name', 'phone', 'email', 'eventDate', 'guests', 'eventType', 'location', 'message']
};
const OPTIONAL = new Set(['email']);

// Best-effort, per-instance memory (serverless instances are short-lived, so
// this throttles bursts and double-submits rather than guaranteeing limits).
const hits = new Map(); // hashed client ip -> [timestamps]
const recent = new Map(); // submission fingerprint -> timestamp

// ------------------------------------------------------------------ helpers
function send(res, status, payload, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(payload));
}
const fail = (message) => ({ success: false, message: message || FAIL_MESSAGE });

// Structured, PII-free logging: outcome + form type only.
function log(event, detail) {
  console.log(JSON.stringify({ scope: 'contact', event, ...(detail || {}) }));
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function clientKey(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
  return sha('ip:' + ip).slice(0, 32); // never keep raw IPs
}

function rateLimited(key, now) {
  const list = (hits.get(key) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > RATE_LIMIT.windowMs) hits.delete(k);
  return list.length > RATE_LIMIT.max;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client; the other checks still apply
  let o;
  try { o = new URL(origin); } catch (e) { return false; }
  if (ALLOWED_ORIGINS.includes(o.origin)) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return !!host && o.host === String(host).split(',')[0].trim(); // same origin: previews, local dev
}

async function readJson(req) {
  let body = req.body; // Vercel pre-parses JSON bodies (accessing it can throw on bad JSON)
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    if (JSON.stringify(body).length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    return body;
  }
  let raw = typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : null;
  if (raw === null) {
    raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
    }
  }
  if (raw.length > MAX_BODY_BYTES) throw Object.assign(new Error('too large'), { status: 413 });
  return JSON.parse(raw);
}

// Sanitise one value: strings/numbers only; drop control, zero-width and
// bidi-override characters; trim; single-line fields collapse whitespace.
// Otherwise the visitor's text is kept exactly as typed.
function clean(value, multiline) {
  if (typeof value === 'number' && Number.isFinite(value)) value = String(value);
  if (typeof value !== 'string') return '';
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[​-‍⁠﻿‪-‮⁦-⁩]/g, '');
  if (multiline) {
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\t/g, ' ').replace(/\n{3,}/g, '\n\n');
  } else {
    s = s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ');
  }
  return s.trim();
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;

// Accepts the browser's YYYY-MM-DD (input type=date) or DD-MM-YYYY / DD/MM/YYYY;
// returns DD-MM-YYYY (the format used in India) or an error message.
function normaliseDate(s) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  let y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return { error: 'Please enter a valid event date.' };
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return { error: 'Please enter a valid event date.' };
  const ist = new Date(Date.now() + 330 * 60000); // today in India
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  if (t < today - 86400000) return { error: 'Please choose an event date that is today or later.' };
  if (y > ist.getUTCFullYear() + 3) return { error: 'Please enter a valid event date.' };
  const pad = (n) => String(n).padStart(2, '0');
  return { value: `${pad(d)}-${pad(mo)}-${y}` };
}

function validate(formType, data) {
  const fields = {};
  const errors = {};
  for (const key of FORMS[formType]) {
    const spec = FIELDS[key];
    const v = clean(data[key], spec.multiline);
    fields[key] = v;
    if (!v) { if (!OPTIONAL.has(key)) errors[key] = spec.required; continue; }
    if (v.length > spec.max) { errors[key] = `Please keep this under ${spec.max} characters.`; continue; }
  }
  if (fields.phone && !errors.phone) {
    const digits = (fields.phone.match(/\d/g) || []).length;
    if (!/^\+?[\d\s\-().]+$/.test(fields.phone) || digits < 7 || digits > 15) errors.phone = 'Please enter a valid phone number.';
  }
  if (fields.email && !errors.email && !EMAIL_RE.test(fields.email)) errors.email = 'Please enter a valid email address.';
  if (formType === 'catering') {
    if (fields.eventDate && !errors.eventDate) {
      const r = normaliseDate(fields.eventDate);
      if (r.error) errors.eventDate = r.error; else fields.eventDate = r.value;
    }
    if (fields.guests && !errors.guests) {
      const n = /^\d+$/.test(fields.guests) ? parseInt(fields.guests, 10) : NaN;
      if (!(n >= 1 && n <= 10000)) errors.guests = 'Please enter the number of guests (1 to 10,000).';
      else fields.guests = String(n);
    }
  }
  return { fields, errors };
}

const linkCount = (fields) => Object.values(fields).join(' ').match(/https?:\/\/|www\./gi)?.length || 0;

// How the Apps Script reports success is up to that script; accept the usual
// shapes ({success:true}, {status|result:"success"}, plain "OK") and treat
// anything else — including Google's HTML error/login pages — as failure.
function upstreamSucceeded(text) {
  const t = String(text || '').trim();
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object') {
      if (j.success === true || j.ok === true) return true;
      const s = String(j.status || j.result || '').toLowerCase();
      return s === 'success' || s === 'ok' || s === 'sent';
    }
    return j === true;
  } catch (e) {
    return /^(ok|success|sent)\b/i.test(t);
  }
}

async function relay(formType, fields) {
  const url = String(process.env.GOOGLE_APPS_SCRIPT_URL || '').trim();
  const secret = String(process.env.GOOGLE_APPS_SCRIPT_SECRET || '').trim();
  if (!APPS_SCRIPT_URL_RE.test(url) || !secret) return { ok: false, reason: 'config' };
  const params = new URLSearchParams();
  params.set('formType', formType);
  for (const key of FORMS[formType]) params.set(key, fields[key] || '');
  params.set('secret', secret);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json, text/plain;q=0.9, */*;q=0.1' },
      body: params.toString(),
      redirect: 'follow', // Apps Script answers via a 302 to script.googleusercontent.com
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (e) {
    return { ok: false, reason: e && e.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) return { ok: false, reason: 'http_' + response.status };
  return upstreamSucceeded(text) ? { ok: true } : { ok: false, reason: 'rejected' };
}

// ------------------------------------------------------------------ handler
async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, fail(), { Allow: 'POST' });
  if (!originAllowed(req)) { log('blocked_origin'); return send(res, 403, fail()); }
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return send(res, 415, fail());

  const now = Date.now();
  if (rateLimited(clientKey(req), now)) {
    log('rate_limited');
    return send(res, 429, fail('Too many submissions. Please try again in a few minutes, or call us on +91 78995 42233.'), { 'Retry-After': '600' });
  }

  let data;
  try { data = await readJson(req); } catch (e) { return send(res, e && e.status === 413 ? 413 : 400, fail()); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return send(res, 400, fail());

  const formType = data.formType === 'catering' || data.formType === 'general' ? data.formType : null;
  if (!formType) return send(res, 400, fail());

  // Honeypot: the hidden "website" field is invisible to people; bots fill it.
  // Answer as if accepted so the bot learns nothing, but send nothing.
  if (clean(data.website, false)) { log('spam_honeypot', { formType }); return send(res, 200, { success: true, message: OK_MESSAGE }); }
  const elapsed = Number(data.elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) { log('spam_too_fast', { formType }); return send(res, 400, fail('Please wait a moment and try again.')); }

  const { fields, errors } = validate(formType, data);
  const errorKeys = Object.keys(errors);
  if (errorKeys.length) return send(res, 400, { success: false, message: errorKeys.map((k) => errors[k]).join(' '), errors });
  if (linkCount(fields) > MAX_LINKS) { log('spam_links', { formType }); return send(res, 400, fail('Please remove the links from your message and try again.')); }

  // Same enquiry again within a few minutes (double click, retry after a slow
  // response): confirm without emailing the cafe twice.
  const fp = sha([formType, fields.name, fields.phone, fields.message].join('\u0000').toLowerCase());
  for (const [k, t] of recent) if (now - t > DUPLICATE_WINDOW_MS) recent.delete(k);
  if (recent.has(fp)) { log('duplicate', { formType }); return send(res, 200, { success: true, message: OK_MESSAGE }); }

  const result = await relay(formType, fields);
  if (!result.ok) {
    log('relay_failed', { formType, reason: result.reason });
    return send(res, result.reason === 'config' ? 500 : 502, fail());
  }
  recent.set(fp, Date.now());
  log('sent', { formType });
  return send(res, 200, { success: true, message: OK_MESSAGE });
}

module.exports = handler;
module.exports._test = { validate, clean, normaliseDate, upstreamSucceeded, originAllowed };
