import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const c = await b.newContext({ viewport: { width: 1920, height: 1080 } });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push('P:' + String(e).slice(0, 100)));
await p.goto('http://127.0.0.1:5174/login');
const f = p.getByTestId('password-auth-form');
await f.locator('input[name="username"]').fill('e2e_admin');
await f.locator('input[name="password"]').fill('e2e-local-admin-pass');
await f.getByRole('button', { name: 'Войти', exact: true }).click();
await p.waitForTimeout(3000);
await p.goto('http://127.0.0.1:5174/tasks', { waitUntil: 'domcontentloaded' }).catch(() => {});
await p.waitForTimeout(2000);
console.log('== going offline ==');
await c.setOffline(true);
await p.waitForTimeout(4000);
const offState = await p.evaluate(() => ({
  text: document.body.innerText.slice(0, 250),
  online: navigator.onLine,
}));
console.log('offline UI:', JSON.stringify(offState).slice(0, 350));
// try a navigation while offline
await p.goto('http://127.0.0.1:5174/mail', { waitUntil: 'domcontentloaded' }).catch(e => console.log('offline nav err:', String(e).slice(0, 80)));
await p.waitForTimeout(1500);
console.log('== back online ==');
await c.setOffline(false);
await p.waitForTimeout(4000);
const onState = await p.evaluate(() => ({
  url: location.pathname,
  text: document.body.innerText.slice(0, 200),
}));
console.log('online UI:', JSON.stringify(onState).slice(0, 300));
console.log('pageerrors:', errs.slice(0, 8));
await b.close();
