#!/usr/bin/env node
/*
 * Release-gate FE-0259 — post-fix assertions (inverse of audit cycle 18).
 *
 * Original bug: ConstructionWorkWorkspace guarded SPA navigation but had no
 * beforeunload listener, so F5/tab close silently discarded daily-summary
 * and weekly-plan drafts.
 * Post-fix contract:
 *   - dirty daily/weekly drafts trigger a beforeunload warning on F5 and on
 *     tab close (runBeforeUnload);
 *   - SPA transitions while dirty show the leave-confirm dialog
 *     ("Есть несохранённая сводка или план") — cancel stays, discard leaves;
 *   - a clean workspace emits no beforeunload warning.
 *
 * Run from WEB-itinvent/frontend:
 *   API_URL=http://127.0.0.1:18008/api/v1 BASE_URL=http://127.0.0.1:5228 \
 *   node e2e/runtime/fe0259-construction.cjs
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
      name: `Audit Construction Gate ${RUN}`,
      groups: [{ group_ref: guid, group_name: `Audit Direction Gate ${RUN}` }],
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

async function uiLogin(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(400);
}

async function openDirection(page, object) {
  const url = `/construction/objects/${object.id}/directions/${object.guid}`;
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2200);
}

(async () => {
  const cookie = await apiLogin();
  const object = await createObject(cookie);
  check('setup.objectCreated', object.status === 201 && Boolean(object.id), { status: object.status, id: object.id });
  if (!object.id) throw new Error('object creation failed');

  const workName = `Audit Work Gate ${RUN}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const dialogs = [];
  // beforeunload semantics: accept() = leave the page, dismiss() = stay.
  // We record the dialog type and leave so the navigation can proceed.
  page.on('dialog', async (d) => {
    dialogs.push(d.type());
    await (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {});
  });
  await uiLogin(page);
  await openDirection(page, object);
  await page.getByRole('tab', { name: 'Ход работ' }).click();
  await sleep(1500);
  await page.getByRole('button', { name: 'Добавить работу' }).click();
  await sleep(900);
  const dlg = page.getByRole('dialog').first();
  await dlg.getByLabel(/^Раздел/).fill('Audit Section Gate');
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

  // ── Clean state: F5 must NOT warn. ──────────────────────────────────────
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await sleep(2400);
  check('clean.noBeforeUnload', !dialogs.includes('beforeunload'), [...dialogs]);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1600);
  check('plan.workAfterReload', (await page.locator('body').innerText()).includes(workName));
  const planData = await planning(page, object.id, object.guid);
  const planItems = Array.isArray(planData.json?.items) ? planData.json.items : [];
  check('plan.persistedInApi', planData.status === 200 && planItems.some((i) => i?.plan?.name === workName), { status: planData.status, count: planItems.length });

  // ── Daily summary draft: F5 warns via beforeunload. ─────────────────────
  await page.getByRole('button', { name: 'Сводка за день' }).click();
  await sleep(1600);
  const dailyInput = page.getByLabel(/^За день:/).first();
  await dailyInput.waitFor({ timeout: 10000 });
  await dailyInput.fill('5');
  await sleep(500);
  check('daily.dirtyState', /Сохранить сводку/.test(await page.locator('body').innerText()));
  dialogs.length = 0;
  await page.reload({ waitUntil: 'load' });
  await sleep(2400);
  check('daily.beforeUnloadOnF5', dialogs.includes('beforeunload'), [...dialogs]);
  await page.getByRole('tab', { name: 'Ход работ' }).click().catch(() => {});
  await sleep(1500);

  // ── Daily summary draft: SPA transition shows the leave dialog. ─────────
  // The breadcrumb is a react-router Link → navigator.push → the workspace
  // leave guard intercepts and shows its MUI dialog.
  await page.getByRole('button', { name: 'Сводка за день' }).click();
  await sleep(1600);
  await page.getByLabel(/^За день:/).first().fill('6');
  await sleep(500);
  await page.getByRole('link', { name: 'Объекты строительства' }).first().click();
  await sleep(1200);
  const leaveDialog = page.getByText('Есть несохранённая сводка или план');
  const leaveShown = await leaveDialog.first().isVisible({ timeout: 4000 }).catch(() => false);
  check('daily.spaLeaveGuard', leaveShown, { url: page.url() });
  if (leaveShown) {
    // "Продолжить ввод" keeps the user on the page with the draft intact.
    await page.getByRole('button', { name: 'Продолжить ввод' }).click();
    await sleep(800);
    check('daily.stayKeepsUrl', page.url().includes('/construction/objects/'), page.url());
    check('daily.stayKeepsDraft', (await page.getByLabel(/^За день:/).first().inputValue().catch(() => '')) === '6');
    // Second attempt → "Отменить изменения" → actually leaves.
    await page.getByRole('link', { name: 'Объекты строительства' }).first().click();
    await sleep(1000);
    await page.getByRole('button', { name: 'Отменить изменения' }).click();
    await sleep(1500);
    check('daily.discardLeaves', page.url().includes('/construction') && !page.url().includes('/directions/'), page.url());
    // Return to the direction for the weekly-plan close check.
    await openDirection(page, object);
    await page.getByRole('tab', { name: 'Ход работ' }).click();
    await sleep(1600);
  }

  // ── Weekly plan draft: dirty → close() triggers beforeunload. ────────────
  await page.getByRole('button', { name: 'Планирование' }).click().catch(() => {});
  await sleep(1600);
  const weeklyInput = page.getByLabel(/^План недели:/).first();
  const weeklyPresent = (await weeklyInput.count()) > 0;
  check('weekly.inputPresent', weeklyPresent);
  if (weeklyPresent) {
    await weeklyInput.fill('7');
    await sleep(500);
    check('weekly.dirtyState', /Сохранить план недели/.test(await page.locator('body').innerText()));
    dialogs.length = 0;
    // Headless close() does not surface the native prompt — prove the
    // beforeunload handler is installed and armed instead: a synthetic event
    // must come back defaultPrevented (same handler that fired on real F5).
    const armed = await page.evaluate(() => {
      const evt = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(evt);
      return evt.defaultPrevented;
    });
    check('weekly.beforeUnloadOnClose', armed === true, { armed });
    await page.close();
  } else {
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify({
    test: 'FE-0259',
    pass: !failed,
    draftKinds: ['daily-summary', 'weekly-plan'],
    checks,
  }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(JSON.stringify({ test: 'FE-0259', pass: false, error: String(error && error.stack || error).slice(0, 800), checks }, null, 2));
  process.exit(1);
});
