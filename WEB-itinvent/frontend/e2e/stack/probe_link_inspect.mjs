import { chromium } from 'playwright';

const base = process.env.PROBE_BASE || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.goto(`${base}/login`);
const form = page.getByTestId('password-auth-form');
const methodBtn = page.getByRole('button', { name: /логином и паролем/i }).first();
if (await methodBtn.isVisible().catch(() => false)) await methodBtn.click();
await form.waitFor({ state: 'visible', timeout: 15000 });
await form.locator('input[name="username"]').fill('e2e_admin');
await form.locator('input[name="password"]').fill('e2e-local-admin-pass');
await form.getByRole('button', { name: 'Войти', exact: true }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 20000 }).catch(() => {});
await page.goto(`${base}/`).catch(() => {});
await page.getByTestId('main-layout-content').waitFor({ state: 'visible' });
await page.waitForURL((u) => u.pathname !== '/', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const link = document.querySelector('[data-testid="main-layout-sidebar-my-files"]');
  if (!link) return { found: false };
  const chain = [];
  let n = link;
  while (n && n !== document.body && chain.length < 10) {
    const cs = getComputedStyle(n);
    chain.push({
      tag: n.tagName,
      testid: n.getAttribute('data-testid') || '',
      cls: (n.className || '').toString().slice(0, 60),
      inert: n.inert,
      pe: cs.pointerEvents,
      disabled: n.getAttribute('aria-disabled'),
      role: n.getAttribute('role'),
    });
    n = n.parentElement;
  }
  // React fiber — find props.onClick on the element and ancestors.
  const fiberKey = Object.keys(link).find((k) => k.startsWith('__reactFiber'));
  const props = [];
  let f = fiberKey ? link[fiberKey] : null;
  while (f && props.length < 8) {
    const p = f.memoizedProps || {};
    const handlers = Object.keys(p).filter((k) => k.startsWith('on') && typeof p[k] === 'function');
    props.push({ type: typeof f.type === 'string' ? f.type : (f.type?.displayName || f.type?.name || 'fn'), handlers });
    f = f.return;
  }
  return { found: true, chain, props };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
