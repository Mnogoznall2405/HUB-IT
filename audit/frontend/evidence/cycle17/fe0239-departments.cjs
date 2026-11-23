const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const fx = JSON.parse(fs.readFileSync(process.env.FIXTURE_FILE || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17_admin_fixtures.json', 'utf8'));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const API = process.env.API_URL || 'http://127.0.0.1:18007/api/v1';
const SHOT = 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-fe0239.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function managers(cookie, deptId) {
  const res = await fetch(`${API}/departments/${encodeURIComponent(deptId)}/members`, { headers: { Cookie: cookie } });
  const json = await res.json().catch(() => ({}));
  const items = Array.isArray(json.items) ? json.items : [];
  return {
    status: res.status,
    managers: items.filter((i) => String(i.role) === 'manager' && i.is_active !== false).map((i) => Number(i.user_id)).sort((a, b) => a - b),
    members: items.length,
  };
}

async function setManagers(cookie, deptId, ids) {
  const res = await fetch(`${API}/departments/${encodeURIComponent(deptId)}/managers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ manager_user_ids: ids }),
  });
  return res.status;
}

(async () => {
  const cookie = await apiLogin();
  await setManagers(cookie, fx.d1.id, [fx.created.owner.id]);
  await setManagers(cookie, fx.d2.id, [fx.created.mgrB.id]);
  const before = {
    d1: await managers(cookie, fx.d1.id),
    d2: await managers(cookie, fx.d2.id),
  };
  console.log('BEFORE', JSON.stringify(before));

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const net = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.includes('/departments/') && (u.pathname.endsWith('/members') || u.pathname.endsWith('/managers'))) {
      net.push({ m: r.method(), p: u.pathname, body: (r.postData() || '').slice(0, 160) });
    }
  });
  await ctx.route(`**/api/v1/departments/${fx.d1.id}/members`, async (route) => {
    await sleep(3200);
    await route.continue();
  });
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(500);
  await page.goto('/admin/departments', { waitUntil: 'load' });
  await sleep(1800);

  const combo = page.getByRole('combobox').first();
  async function select(name) {
    await combo.click();
    await sleep(400);
    const opt = page.getByRole('option', { name }).first();
    if (await opt.count()) await opt.click();
    else await page.getByText(name, { exact: true }).last().click();
    await sleep(300);
  }

  await select(fx.d2.name);
  await sleep(1600); // D2 fast load -> draft = mgrB
  const d2Text = await page.locator('body').innerText();
  console.log('D2_UI', JSON.stringify({
    hasMgrB: d2Text.includes('Audit Manager B'),
    managerChip: /Начальников: \d+/.exec(d2Text)?.[0] || '',
  }));

  // select D1 (delayed), then quickly D2 again while D1 response is in flight
  await select(fx.d1.name);
  await sleep(250);
  await select(fx.d2.name);
  await sleep(3800); // late D1 response lands

  const raceText = await page.locator('body').innerText();
  console.log('RACE_UI', JSON.stringify({
    selectedD2: raceText.includes(fx.d2.name),
    showsOwner: raceText.includes('Audit Owner'),
    showsDelegate: raceText.includes('Audit Delegate'),
    managerChip: /Начальников: \d+/.exec(raceText)?.[0] || '',
  }));

  const save = page.getByRole('button', { name: 'Сохранить начальников' }).first();
  await save.click().catch(() => {});
  await sleep(3500);
  await page.screenshot({ path: SHOT }).catch(() => {});
  await browser.close();

  const after = {
    d1: await managers(cookie, fx.d1.id),
    d2: await managers(cookie, fx.d2.id),
  };
  console.log('NET', JSON.stringify(net.filter((n) => n.p.includes('/managers'))));
  console.log('AFTER', JSON.stringify(after));
  console.log('VERDICT', JSON.stringify({
    d2WasMgrB: before.d2.managers.join(',') === String(fx.created.mgrB.id),
    d2NowOwner: after.d2.managers.join(',') === String(fx.created.owner.id),
  }));
})();
