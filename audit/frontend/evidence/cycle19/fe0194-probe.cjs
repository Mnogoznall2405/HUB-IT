const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5229';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await ctx.route('**/api/v1/monitoring/overview*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      targets: [{ id: 'audit-bad-target', address: '10.0.0.1', summary: null, current: {} }],
      updated_at: new Date().toISOString(),
    }),
  }));
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(400);
  await page.goto('/monitoring', { waitUntil: 'load' });
  await sleep(2500);
  const body = await page.locator('body').innerText();
  const result = {
    test: 'FE-0194',
    url: page.url(),
    pageErrors: errors,
    splitError: errors.some((e) => /split|Cannot read properties of undefined/i.test(e)),
    cards: await page.locator('.monitoring-device-card').count(),
    bodyStart: body.slice(0, 400).replace(/\n+/g, ' | '),
    visualError: /что-то пошло не так|произошла ошибка|unexpected error|error boundary/i.test(body),
  };
  fs.writeFileSync('C:/Users/Администратор/AppData/Local/Temp/2/opencode/hub-audit-publish/audit/frontend/evidence/cycle19/shots/fe0194-probe.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/hub-audit-publish/audit/frontend/evidence/cycle19/shots/fe0194-monitoring.png' }).catch(() => {});
  console.log(JSON.stringify(result));
  await browser.close();
})();
