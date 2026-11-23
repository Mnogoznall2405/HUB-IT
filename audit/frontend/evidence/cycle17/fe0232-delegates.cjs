const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const fx = JSON.parse(fs.readFileSync(process.env.FIXTURE_FILE || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17_admin_fixtures.json', 'utf8'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const API = process.env.API_URL || 'http://127.0.0.1:18007/api/v1';
const SHOT = 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-fe0232.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function apiBulk(cookie) {
  const res = await fetch(`${API}/auth/task-delegates?owner_ids=${fx.created.owner.id}`, { headers: { Cookie: cookie } });
  const json = await res.json().catch(() => ({}));
  const owners = Array.isArray(json.items) ? json.items : []; const links = owners.flatMap((item) => Array.isArray(item.task_delegate_links) ? item.task_delegate_links : []); return { status: res.status, owners: owners.length, links: links.length };
}

async function apiSeed(cookie) {
  const res = await fetch(`${API}/auth/users/${fx.created.owner.id}/task-delegates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ items: [{ delegate_user_id: fx.created.delegate.id, role_type: 'assistant', is_active: true }] }),
  });
  return res.status;
}

async function login(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(600);
}

async function runCase({ interceptBulk }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (interceptBulk) {
    await ctx.route('**/api/v1/auth/task-delegates*', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'cycle17 injected bulk failure' }),
    }));
  }
  await login(page);
  await page.goto('/admin/users', { waitUntil: 'load' });
  await sleep(2200);
  const search = page.getByLabel('Поиск пользователя').first();
  if (await search.count()) {
    await search.fill(fx.created.owner.username);
    await sleep(1500);
  }
  const row = page.getByText(fx.created.owner.username).first();
  const rowFound = await row.count();
  let drawerHasDelegate = null;
  let saved = false;
  if (rowFound) {
    await row.click();
    await sleep(1800);
    const drawer = page.locator('.MuiDrawer-paper').last();
    const text = await drawer.innerText().catch(() => '');
    drawerHasDelegate = text.includes('Audit Delegate');
    const save = drawer.getByRole('button', { name: 'Сохранить' }).first();
    saved = await save.isEnabled().catch(() => false);
    if (saved) await save.click();
    await sleep(2800);
  }
  await page.screenshot({ path: SHOT }).catch(() => {});
  await browser.close();
  return { rowFound, drawerHasDelegate, saved };
}

(async () => {
  const cookie = await apiLogin();
  await apiSeed(cookie);
  console.log('SEEDED_BEFORE_INJECTION', JSON.stringify(await apiBulk(cookie)));

  const injected = await runCase({ interceptBulk: true });
  const afterInjected = await apiBulk(cookie);
  console.log('INJECTED_BULK_FAILURE', JSON.stringify({ ...injected, bulkAfter: afterInjected }));

  await apiSeed(cookie);
  const beforeControl = await apiBulk(cookie);
  const control = await runCase({ interceptBulk: false });
  const afterControl = await apiBulk(cookie);
  console.log('CONTROL_NO_INJECTION', JSON.stringify({ ...control, bulkBefore: beforeControl, bulkAfter: afterControl }));
})();

