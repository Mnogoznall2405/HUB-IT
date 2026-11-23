#!/usr/bin/env node
/*
 * Cycle 18 — FE-0259 regression test with strict verdicts.
 *
 * Checks the saved work plan, the dirty state of the daily summary and the
 * weekly plan, the absence of a beforeunload warning, and draft loss after F5.
 * The record title says "weekly summary"; the test records which drafts are
 * actually affected (daily summary and weekly plan).
 *
 * Run from WEB-itinvent/frontend:
 *   API_URL=http://127.0.0.1:18008/api/v1 BASE_URL=http://127.0.0.1:5228 \
 *   NODE_PATH=<frontend>/node_modules node fe0259-construction.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:18008/api/v1';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5228';
const SHOT_DIR = process.env.SHOT_DIR || process.cwd();
const RUN = String(Date.now());
const HIGH = String(Date.now()).slice(-12).padStart(12, '0');
const checks = [];
let failed = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) failed = true;
}

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

async function createObject(cookie) {
  const guid = `33333333-4444-4555-8666-${HIGH}`;
  const res = await fetch(`${API}/construction/management/objects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: `Audit Construction C18 ${RUN}`,
      groups: [{ group_ref: guid, group_name: `Audit Direction C18 ${RUN}` }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, id: body.id, guid, body };
}

async function planning(page, objectId, groupRef) {
  return page.evaluate(async ({ id, group }) => {
    const res = await fetch(`/api/v1/construction/objects/${encodeURIComponent(id)}/directions/${encodeURIComponent(group)}/planning`, { credentials: 'include' });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  }, { id: objectId, group: groupRef });
}

(async () => {
  const cookie = await apiLogin();
  const object = await createObject(cookie);
  check('setup.objectCreated', object.status === 201 && Boolean(object.id), { status: object.status, id: object.id });
  if (!object.id) throw new Error('object creation failed');

  const workName = `Audit Work C18 ${RUN}`;
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
  const url = `/construction/objects/${object.id}/directions/${object.guid}`;
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2200);
  await page.getByRole('tab', { name: 'Ход работ' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Добавить работу' }).click();
  await sleep(900);
  const dlg = page.getByRole('dialog').first();
  await dlg.getByLabel(/^Раздел/).fill('Audit Section C18');
  await dlg.getByLabel(/^Работа/).fill(workName);
  await dlg.getByLabel(/^Ед\. изм\./).fill('шт');
  await dlg.getByLabel(/^Плановый объём/).fill('100');
  const savePlanResponse = page.waitForResponse((r) => {
    if (r.request().method() !== 'PUT') return false;
    const p = new URL(r.url()).pathname;
    return p.endsWith('/planning') || p.endsWith('/work-plan');
  }, { timeout: 20000 }).catch(() => null);
  await dlg.getByRole('button', { name: 'Сохранить план' }).click();
  const planResponse = await savePlanResponse;
  await page.waitForTimeout(2500);
  check('plan.saveResponse', Boolean(planResponse && planResponse.status() === 200), { status: planResponse ? planResponse.status() : null });
  check('plan.workVisible', (await page.locator('body').innerText()).includes(workName));

  await page.reload({ waitUntil: 'load' });
  await sleep(2200);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1600);
  check('plan.workAfterReload', (await page.locator('body').innerText()).includes(workName));
  const planData = await planning(page, object.id, object.guid);
  const planItems = Array.isArray(planData.json?.items) ? planData.json.items : [];
  check('plan.persistedInApi', planData.status === 200 && planItems.some((i) => i?.plan?.name === workName), { status: planData.status, count: planItems.length });

  // Daily summary draft
  await page.getByRole('button', { name: 'Сводка за день' }).click();
  await sleep(1600);
  const dailyInput = page.getByLabel(/^За день:/).first();
  await dailyInput.waitFor({ timeout: 10000 });
  await dailyInput.fill('5');
  await sleep(500);
  const dailyBody = await page.locator('body').innerText();
  check('daily.dirtyState', /Сохранить сводку/.test(dailyBody));
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await sleep(2400);
  check('daily.noBeforeUnload', !dialogs.includes('beforeunload'), [...dialogs]);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1500);
  await page.getByRole('button', { name: 'Сводка за день' }).click().catch(() => {});
  await sleep(1500);
  const dailyAfter = page.getByLabel(/^За день:/).first();
  const dailyValue = (await dailyAfter.count()) ? await dailyAfter.inputValue() : null;
  const dailyAfterBody = await page.locator('body').innerText();
  check('daily.draftLostAfterF5', dailyValue === '' && !/Сохранить сводку/.test(dailyAfterBody), { value: dailyValue });

  // Weekly plan draft
  await page.getByRole('button', { name: 'Планирование' }).click();
  await sleep(1600);
  const weeklyInput = page.getByLabel(/^План недели:/).first();
  await weeklyInput.waitFor({ timeout: 10000 });
  await weeklyInput.fill('7');
  await sleep(500);
  const weeklyBody = await page.locator('body').innerText();
  check('weekly.dirtyState', /Сохранить план недели/.test(weeklyBody));
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await sleep(2400);
  check('weekly.noBeforeUnload', !dialogs.includes('beforeunload'), [...dialogs]);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1500);
  await page.getByRole('button', { name: 'Планирование' }).click().catch(() => {});
  await sleep(1500);
  const weeklyAfter = page.getByLabel(/^План недели:/).first();
  const weeklyValue = (await weeklyAfter.count()) ? await weeklyAfter.inputValue() : null;
  const weeklyAfterBody = await page.locator('body').innerText();
  check('weekly.draftLostAfterF5', weeklyValue === '' && !/Сохранить план недели/.test(weeklyAfterBody), { value: weeklyValue });

  await page.screenshot({ path: path.join(SHOT_DIR, 'fe0259-after.png') }).catch(() => {});
  await browser.close();
  console.log(JSON.stringify({
    test: 'FE-0259',
    pass: !failed,
    draftKinds: ['daily-summary', 'weekly-plan'],
    titleNote: 'The tested drafts are the daily summary and the weekly plan; no separate "weekly summary" control exists.',
    checks,
  }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(JSON.stringify({ test: 'FE-0259', pass: false, error: String(error && error.stack || error).slice(0, 800), checks }, null, 2));
  process.exit(1);
});

