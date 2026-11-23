import { chromium } from 'file:///C:/Project/HUB-IT-main/WEB-itinvent/frontend/node_modules/playwright/index.mjs';

const mode = process.argv[2] || 'check';
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

if (mode === 'login') {
  await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill('e2e_user');
  await form.locator('input[name="password"]').fill('e2e-local-user-pass');
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  console.log('LOGGED IN at', page.url());
  await page.waitForTimeout(2000);
} else {
  await page.goto('http://127.0.0.1:5174/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
}
const s = await page.evaluate(() => ({
  url: location.href,
  ls: Object.keys(localStorage),
  user: localStorage.getItem('user')?.slice(0, 120) ?? null,
}));
console.log('STATE', JSON.stringify(s));
await browser.close();
