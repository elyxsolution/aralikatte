// Renders the 1200x630 social-preview image (assets/og-aralikatte-cafe.jpg)
// from the site's own photo, logo and fonts. Needs network for Google Fonts.
// Deliberately carries no opening hours (unconfirmed).  Usage: node scripts/make-og.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b64 = (f, mime) => `data:${mime};base64,${fs.readFileSync(path.join(ROOT, f)).toString('base64')}`;
const html = `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Manrope:wght@500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:#0D0D0F;color:#fff;font-family:Manrope,sans-serif;display:flex;overflow:hidden;position:relative}
.l{width:640px;padding:56px 56px 52px 64px;display:flex;flex-direction:column;justify-content:space-between;position:relative;z-index:2}
.brand{display:flex;align-items:center;gap:18px}.brand img{width:76px;height:76px;border-radius:16px}
.brand b{font:400 40px/1 'DM Serif Display',serif}.brand i{display:block;font:600 12px/1 Manrope;letter-spacing:.32em;text-transform:uppercase;color:#F2564A;margin-top:8px;font-style:normal}
h1{font:400 66px/1.04 'DM Serif Display',serif;letter-spacing:-.02em}
p{font:500 22px/1.5 Manrope;color:#C4C4CC;margin-top:18px}
.tag{display:inline-block;background:#D42A20;color:#fff;font:700 15px/1 Manrope;letter-spacing:.16em;text-transform:uppercase;padding:13px 22px;border-radius:999px}
.r{position:absolute;right:0;top:0;width:620px;height:630px}.r img{width:100%;height:100%;object-fit:cover}
.r:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#0D0D0F 0%,rgba(13,13,15,.15) 45%,rgba(13,13,15,0) 100%)}
</style><div class="l"><div class="brand"><img src="${b64('assets/aralikatte-logo.jpg', 'image/jpeg')}"><div><b>Aralikatte</b><i>Cafe · Bengaluru</i></div></div>
<div><h1>South Indian comfort, served fresh.</h1><p>Pure vegetarian · 80 Feet Road, Subramanyapura</p></div><div><span class="tag">100% Vegetarian</span></div></div>
<div class="r"><img src="${b64('assets/aralikatte-hero-thali.jpg', 'image/jpeg')}"></div>`;
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630 });
await page.setContent(html, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ROOT, 'assets/og-aralikatte-cafe.jpg'), type: 'jpeg', quality: 86 });
await browser.close();
console.log('wrote assets/og-aralikatte-cafe.jpg');
