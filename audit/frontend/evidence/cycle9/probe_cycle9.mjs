// Cycle-9 audit probe — local E2E stack (127.0.0.1:5174 + backend 18001).
// Read-only + onboarding completion only on the throwaway seeded user.
import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:5174';
const OUT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHOTS = `${OUT}/shots`;
const report = { checks: [], consoleErrors: [], pageErrors: [], failedReqs: [] };

function rec(kind, data) {
  report.checks.push({ t: Date.now(), kind, ...data });
}

async function login(page, username, password, expectPath) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const form = page.getByTestId('password-auth-form');
  try {
    await form.locator('input[name="username"]').waitFor({ timeout: 15000 });
  } catch (e) {
    const dbg = await page.evaluate(() => ({
      url: location.href,
      ls: Object.fromEntries(Object.keys(localStorage).map((k) => [k, (localStorage.getItem(k) || '').slice(0, 120)])),
      ss: Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, (sessionStorage.getItem(k) || '').slice(0, 120)])),
      cookie: document.cookie,
      text: document.body.innerText.slice(0, 400),
    }));
    console.log('LOGIN-FORM-MISSING', JSON.stringify(dbg, null, 1));
    await page.screenshot({ path: `${SHOTS}/login-missing.png` });
    throw e;
  }
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  if (expectPath) await page.waitForURL(expectPath, { timeout: 30000 });
  return new URL(page.url()).pathname;
}

function wire(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') report.consoleErrors.push({ tag, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => report.pageErrors.push({ tag, text: String(e).slice(0, 300) }));
  page.on('response', (r) => {
    if (r.url().includes('/api/')) report.failedReqs.push({ tag, url: r.url().slice(0, 160), status: r.status() });
  });
  page.on('request', (r) => { const u = r.url(); if (/auth\//.test(u)) console.log(`>>${tag} ${r.method()} ${u.slice(30)}`); });
  page.on('response', (r) => { const u = r.url(); if (/auth\//.test(u)) console.log(`<<${tag} ${r.status()} ${u.slice(30)}`); });
  page.on('requestfinished', async (r) => {
    const u = r.url();
    if (/auth\//.test(u)) {
      try { const resp = await r.response(); const h = resp ? resp.headers()['set-cookie'] : null; if (h) console.log(`COOKIE-SET ${u.slice(30)}: ${h.slice(0, 120)}`); } catch {}
    }
  });
}

const overflow = (page) =>
  page.evaluate(() => ({
    vw: window.innerWidth,
    docW: document.documentElement.scrollWidth,
    bodyW: document.body?.scrollWidth,
    overflowPx: document.documentElement.scrollWidth - window.innerWidth,
  }));

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--disable-dev-shm-usage', '--disable-gpu'],
});
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
wire(page, 'fresh');

// --- 1. /about onboarding gate (e2e_fresh never completed onboarding) ---
const land = await login(page, 'e2e_fresh', 'e2e-local-fresh-pass');
rec('about.landing', { land });
await page.waitForTimeout(1500);
const about = await page.evaluate(() => ({
  url: location.pathname,
  title: document.title,
  h1: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim()).slice(0, 8),
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 15),
  mainRole: !!document.querySelector('main,[role="main"]'),
  ...( (() => ({ vw: innerWidth, docW: document.documentElement.scrollWidth }))() ),
}));
rec('about.dom', about);
await page.screenshot({ path: `${SHOTS}/about-1920.png`, fullPage: true });

// Onboarding gate: try to escape to /dashboard without completing
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
rec('about.gateEscape', { url: new URL(page.url()).pathname });
await page.goto(`${BASE}/about`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);

// Escape/back behaviour on onboarding
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
rec('about.escape', { url: new URL(page.url()).pathname });

// Mobile viewport on /about
await page.setViewportSize({ width: 375, height: 812 });
await page.waitForTimeout(800);
const aboutMob = await page.evaluate(() => ({
  vw: innerWidth, docW: document.documentElement.scrollWidth,
  overflowPx: document.documentElement.scrollWidth - innerWidth,
}));
rec('about.mobile375', aboutMob);
await page.screenshot({ path: `${SHOTS}/about-375.png`, fullPage: true });
await page.setViewportSize({ width: 1920, height: 1080 });

// --- 2. e2e_user: zoom-equivalent overflow checks ---
const page2 = await ctx.newPage();
wire(page2, 'user');
await login(page2, 'e2e_user', 'e2e-local-user-pass');
await page2.waitForTimeout(2000);
rec('user.landing', { url: new URL(page2.url()).pathname });

const zoomPages = ['/dashboard', '/database', '/my-files', '/tasks', '/scan-center', '/mail'];
for (const p of zoomPages) {
  for (const z of [0.8, 1.5]) {
    try {
      await page2.goto(`${BASE}${p}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page2.waitForTimeout(2500);
      await page2.evaluate((zoom) => { document.documentElement.style.zoom = String(zoom); }, z);
      await page2.waitForTimeout(700);
      const m = await overflow(page2);
      const finalUrl = new URL(page2.url()).pathname;
      rec('zoom.check', { page: p, zoom: z, finalUrl, ...m });
      await page2.evaluate(() => { document.documentElement.style.zoom = '1'; });
      if (m.overflowPx > 2) await page2.screenshot({ path: `${SHOTS}/zoom-${p.slice(1)}-${z}.png` });
    } catch (e) {
      rec('zoom.error', { page: p, zoom: z, error: String(e).slice(0, 200) });
    }
  }
}

// --- 3. /mail on local stack (MAIL_MODULE_ENABLED=0): what renders? ---
await page2.goto(`${BASE}/mail`, { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(2500);
const mailDom = await page2.evaluate(() => ({
  url: location.pathname,
  bodyText: document.body.innerText.slice(0, 500),
}));
rec('mail.localState', mailDom);
await page2.screenshot({ path: `${SHOTS}/mail-local.png` });

// --- 4. /my-files editor route with bogus id ---
await page2.goto(`${BASE}/my-files/edit/nonexistent-file-xyz`, { waitUntil: 'domcontentloaded' });
await page2.waitForTimeout(3000);
const edDom = await page2.evaluate(() => ({
  url: location.pathname,
  bodyText: document.body.innerText.slice(0, 600),
}));
rec('editor.bogusId', edDom);
await page2.screenshot({ path: `${SHOTS}/editor-bogus.png` });

fs.writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log('DONE', JSON.stringify(report.checks.length));
