import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
const BASE = 'http://127.0.0.1:5174';
const ROUTES = ['/dashboard', '/tasks', '/mail', '/my-files', '/scan-center', '/help', '/networks', '/chat', '/database', '/monitoring', '/voice-video', '/address-book', '/company-structure', '/vcs', '/mfu', '/passwords', '/groups-access', '/it/requests', '/construction-objects', '/feed', '/docflow', '/kb', '/computers', '/statistics'];
const b = await chromium.launch({ channel: 'chrome' });
const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await c.newPage();
await p.goto(BASE + '/login');
const f = p.getByTestId('password-auth-form');
await f.locator('input[name="username"]').fill('e2e_admin');
await f.locator('input[name="password"]').fill('e2e-local-admin-pass');
await f.getByRole('button', { name: 'Войти', exact: true }).click();
await p.waitForTimeout(2500);
for (const r of ROUTES) {
  const errs = [];
  const h1 = m => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 120)); };
  const h2 = e => errs.push('P:' + String(e).slice(0, 120));
  p.on('console', h1); p.on('pageerror', h2);
  await p.goto(BASE + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(1400);
  p.off('console', h1); p.off('pageerror', h2);
  const uniq = [...new Set(errs.filter(e => !e.includes('hubit://') && !e.includes('401')))];
  console.log(r + ' => ' + (uniq.length ? JSON.stringify(uniq.slice(0, 6)) : 'clean'));
}
await b.close();
