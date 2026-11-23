import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const c = await b.newContext();
const p = await c.newPage();
const hits = [];
p.on('response', r => { if (r.status() >= 400 && r.status() !== 401) hits.push(r.status() + ' ' + r.url().replace(/^.*5174/, '')); });
await p.goto('http://127.0.0.1:5174/login');
const f = p.getByTestId('password-auth-form');
await f.locator('input[name="username"]').fill('e2e_admin');
await f.locator('input[name="password"]').fill('e2e-local-admin-pass');
await f.getByRole('button', { name: 'Войти', exact: true }).click();
await p.waitForTimeout(2500);
for (const r of ['/dashboard', '/voice-video', '/address-book', '/construction-objects']) {
  await p.goto('http://127.0.0.1:5174' + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1800);
}
console.log(JSON.stringify(hits, null, 0));
await b.close();
