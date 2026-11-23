import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await c.newPage();
await p.goto('http://127.0.0.1:5174/login');
const f = p.getByTestId('password-auth-form');
await f.locator('input[name="username"]').fill('e2e_admin');
await f.locator('input[name="password"]').fill('e2e-local-admin-pass');
await f.getByRole('button', { name: 'Войти', exact: true }).click();
await p.waitForTimeout(3000);
console.log('after-login url:', p.url());
await p.route('**/api/v1/**', r => r.fulfill({ status: 500, body: '{"detail":"forced"}' }));
for (const r of ['/tasks', '/mail', '/database']) {
  await p.goto('http://127.0.0.1:5174' + r, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.waitForTimeout(3000);
  const el = await p.evaluate(() => {
    const m = document.querySelector('[data-testid="main-layout-content"], main, [role="main"]');
    const al = [...document.querySelectorAll('[role="alert"], .MuiAlert-root')].map(e => e.innerText.slice(0, 80));
    return { main: !!m, bodyLen: document.body.innerText.length, alerts: al.slice(0, 4) };
  });
  console.log(r + ' under-500:', JSON.stringify(el));
  await p.screenshot({ path: 'C:/Project/HUB-IT-main/audit/frontend/evidence/cycle10/err500-' + r.slice(1) + '.png' });
}
await b.close();
