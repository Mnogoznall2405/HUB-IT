const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const API = process.env.API_URL || 'http://127.0.0.1:18007/api/v1';
const SHOT = 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-fe0259.png';
const run = String(Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function createObject(cookie) {
  const guid = '22222222-3333-4444-8555-' + run.slice(-12).padStart(12, '0');
  const res = await fetch(`${API}/construction/management/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: `Audit Construction C17 ${run}`,
      groups: [{ group_ref: guid, group_name: `Audit Direction C17 ${run}` }],
    }),
  });
  const body = await res.json();
  return { status: res.status, body, guid };
}

(async () => {
  const cookie = await apiLogin();
  const created = await createObject(cookie);
  console.log('OBJECT', JSON.stringify({ status: created.status, id: created.body.id, guid: created.guid }));
  if (created.status !== 201) return;

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.type()); await d.dismiss().catch(() => {}); });
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(400);
  const url = `/construction/objects/${created.body.id}/directions/${created.guid}`;
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2200);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1500);
  await page.getByRole('button', { name: 'Добавить работу' }).click();
  await sleep(900);
  const dlg = page.getByRole('dialog').first();
  const workName = `Audit Work C17 ${run}`;
  await dlg.getByLabel(/^Раздел/).fill('Audit Section C17');
  await dlg.getByLabel(/^Работа/).fill(workName);
  await dlg.getByLabel(/^Ед\. изм\./).fill('шт');
  await dlg.getByLabel(/^Плановый объём/).fill('100');
  await dlg.getByRole('button', { name: 'Сохранить план' }).click();
  await sleep(3000);
  const afterSave = await page.locator('body').innerText();
  console.log('WORK_SAVED', JSON.stringify({
    dialogClosed: (await page.getByRole('dialog').count()) === 0,
    workVisible: afterSave.includes(workName),
    error: /не удалось|ошибка/i.test(afterSave.slice(-600)),
  }));

  // switch to day summary and create an unsaved draft
  await page.getByRole('button', { name: 'Сводка за день' }).click().catch(async () => {
    await page.getByText('Сводка за день', { exact: true }).first().click();
  });
  await sleep(1800);
  const dayInput = page.getByLabel(/^За день:/).first();
  const inputCount = await dayInput.count();
  let draftEntered = false;
  if (inputCount) {
    await dayInput.fill('5');
    draftEntered = true;
    await page.waitForTimeout(500);
  }
  const dirtyText = await page.locator('body').innerText();
  const dirtyUi = /Сохранить сводку/.test(dirtyText);
  console.log('DRAFT', JSON.stringify({ inputCount, draftEntered, dirtyUi }));

  // in-app navigation should be guarded
  await page.getByRole('tab', { name: 'Заявки' }).click().catch(() => {});
  await sleep(1200);
  const guardText = await page.locator('body').innerText();
  const inAppGuard = /несохран|не сохран|отменить|продолжить/i.test(guardText);
  console.log('IN_APP_GUARD', JSON.stringify({ dialogVisible: await page.getByRole('dialog').count(), inAppGuard, dialogs }));
  // cancel the guard and return to work tab
  const cancel = page.getByRole('button', { name: /Продолжить|Отмена|Остаться/i }).first();
  if (await cancel.count()) await cancel.click().catch(() => {});
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1200);
  const dayInput2 = page.getByLabel(/^За день:/).first();
  if (await dayInput2.count()) await dayInput2.fill('5');
  await sleep(400);

  // F5 / reload while dirty
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await sleep(2500);
  const reloadDialogs = [...dialogs];
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(2000);
  await page.getByRole('button', { name: 'Сводка за день' }).click().catch(() => {});
  await sleep(1600);
  const inputAfter = page.getByLabel(/^За день:/).first();
  const valueAfter = (await inputAfter.count()) ? await inputAfter.inputValue() : null;
  const bodyAfter = await page.locator('body').innerText();
  await page.screenshot({ path: SHOT }).catch(() => {});
  console.log('AFTER_RELOAD', JSON.stringify({
    beforeUnloadDialog: reloadDialogs.includes('beforeunload'),
    dialogs: reloadDialogs,
    valueAfter,
    dirtyUiAfter: /Сохранить сводку/.test(bodyAfter),
    url: page.url(),
  }));
  await browser.close();
})();
