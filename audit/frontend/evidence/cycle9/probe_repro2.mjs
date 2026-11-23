import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const report = { checks: [], consoleErrors: [], pageErrors: [], failedReqs: [] };
function wire(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') report.consoleErrors.push({ tag, text: m.text().slice(0, 300) });
  });
  page.on('pageerror', (e) => report.pageErrors.push({ tag, text: String(e).slice(0, 300) }));
  page.on('response', (r) => {
    if (r.url().includes('/api/')) report.failedReqs.push({ tag, url: r.url().slice(0, 160), status: r.status() });
  });
}

const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
wire(page, 'fresh');
page.on('request', (r) => { const u = r.url(); if (/auth\//.test(u)) console.log(`>> ${r.method()} ${u.slice(30)}`); });
await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
const s = await page.evaluate(() => ({ url: location.href, user: localStorage.getItem('user')?.slice(0, 80) ?? null, ls: Object.keys(localStorage) }));
console.log('FINAL', JSON.stringify(s));
console.log('API CALLS:', JSON.stringify(report.failedReqs, null, 0).slice(0, 3000));
await browser.close();
