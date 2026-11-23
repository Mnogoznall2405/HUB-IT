const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const run = String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const bad = [];
  page.on('response', async (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) {
      let b = ''; try { b = (await r.text()).slice(0, 120); } catch {}
      bad.push({ m: r.request().method(), p: u.pathname, s: r.status(), b });
    }
  });
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(500);
  await page.goto('/kb/manage', { waitUntil: 'load' });
  await sleep(2200);
  await page.getByRole('button', { name: 'Создать статью' }).click();
  const dlg = page.getByRole('dialog').first();
  await dlg.waitFor();
  const title = `Audit KB C17 ${run}`;
  const description = `Audit KB description ${run}`;
  await dlg.getByLabel(/^Название/).fill(title);
  await dlg.getByLabel(/^Описание/).fill(description);
  await dlg.getByLabel(/^Категория/).fill('Общее');
  await dlg.getByLabel(/^Ответственный/).fill('E2E Админ');
  await dlg.getByRole('button', { name: 'Создать' }).click();
  await sleep(3000);
  const closed = (await page.getByRole('dialog').count()) === 0;
  const listHas = (await page.locator('body').innerText()).includes(title);
  await page.reload({ waitUntil: 'load' });
  await sleep(2500);
  const afterReload = (await page.locator('body').innerText()).includes(title);
  let reopened = false;
  if (afterReload) {
    await page.getByText(title).first().click().catch(() => {});
    await sleep(1500);
    reopened = (await page.locator('body').innerText()).includes(description);
  }
  console.log('KB_E2E', JSON.stringify({ title, closed, listHas, afterReload, reopened, bad: bad.slice(0, 6) }));
  await page.screenshot({ path: 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-kb.png' }).catch(() => {});
  await browser.close();
})();

