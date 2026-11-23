#!/usr/bin/env node
/*
 * Cycle 18 — FE-0232 regression test with strict verdicts.
 *
 * Bug: a failed bulk delegate load hides the links; saving the user then sends
 * items: [] and erases all assistant/deputy links.
 *
 * Run from WEB-itinvent/frontend:
 *   API_URL=http://127.0.0.1:18008/api/v1 BASE_URL=http://127.0.0.1:5228 \
 *   FIXTURE_FILE=<temp>/c18_admin_fixtures.json \
 *   NODE_PATH=<frontend>/node_modules node fe0232-delegates.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:18008/api/v1';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5228';
const FIXTURE = process.env.FIXTURE_FILE || path.join(process.cwd(), 'c18_admin_fixtures.json');
const FX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const checks = [];
let failed = false;

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

async function bulkCount(cookie) {
  const res = await fetch(`${API}/auth/task-delegates?owner_ids=${FX.created.owner.id}`, { headers: { Cookie: cookie } });
  const json = await res.json().catch(() => ({}));
  const owners = Array.isArray(json.items) ? json.items : [];
  const links = owners.flatMap((o) => (Array.isArray(o.task_delegate_links) ? o.task_delegate_links : []));
  return { status: res.status, links: links.length, owners: owners.length };
}

async function setLinks(cookie, ids) {
  const res = await fetch(`${API}/auth/users/${FX.created.owner.id}/task-delegates`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ items: ids.map((id) => ({ delegate_user_id: id, role_type: 'assistant', is_active: true })) }),
  });
  return res.status;
}

async function openOwner(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.goto('/admin/users', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const search = page.getByLabel('Поиск пользователя').first();
  if (await search.count()) {
    await search.fill(FX.created.owner.username);
    await page.waitForTimeout(1400);
  }
  await page.getByText(FX.created.owner.username).first().click();
  await page.waitForTimeout(1600);
  return page.locator('.MuiDrawer-paper').last();
}

async function runCase({ injectBulk }) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const putBodies = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'PUT' && u.pathname === `/api/v1/auth/users/${FX.created.owner.id}/task-delegates`) {
      putBodies.push(r.postData() || '');
    }
  });
  if (injectBulk) {
    await ctx.route('**/api/v1/auth/task-delegates*', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'cycle18 injected bulk failure' }),
    }));
  }
  const drawer = await openOwner(page);
  const drawerText = await drawer.innerText();
  const drawerHasDelegate = drawerText.includes('Audit Delegate');
  const save = drawer.getByRole('button', { name: 'Сохранить' }).first();
  const saveEnabled = await save.isEnabled();
  if (saveEnabled) await save.click();
  await page.waitForTimeout(2600);
  await browser.close();
  let parsed = null;
  try { parsed = putBodies.length ? JSON.parse(putBodies[0]) : null; } catch (e) {}
  return { drawerHasDelegate, saveEnabled, putBodies: putBodies.length, putItems: parsed && Array.isArray(parsed.items) ? parsed.items.length : null };
}

(async () => {
  const cookie = await apiLogin();
  await setLinks(cookie, []);
  const cleared = await bulkCount(cookie);
  check('seed.clearedToZero', cleared.status === 200 && cleared.links === 0, cleared);
  await setLinks(cookie, [FX.created.delegate.id]);
  const seeded = await bulkCount(cookie);
  check('seed.delegateLinkOne', seeded.status === 200 && seeded.links === 1, seeded);

  const injected = await runCase({ injectBulk: true });
  check('injected.drawerHidesDelegate', injected.drawerHasDelegate === false, injected);
  check('injected.saveEnabled', injected.saveEnabled === true, injected);
  check('injected.emptyPayload', injected.putItems === 0, injected);
  const afterInjected = await bulkCount(cookie);
  check('injected.linkErased', afterInjected.links === 0, afterInjected);

  await setLinks(cookie, [FX.created.delegate.id]);
  const reseeded = await bulkCount(cookie);
  check('control.reseededToOne', reseeded.links === 1, reseeded);
  const control = await runCase({ injectBulk: false });
  check('control.drawerShowsDelegate', control.drawerHasDelegate === true, control);
  check('control.saveEnabled', control.saveEnabled === true, control);
  check('control.nonEmptyPayload', control.putItems === 1, control);
  const afterControl = await bulkCount(cookie);
  check('control.linkPreserved', afterControl.links === 1, afterControl);

  const verdict = { test: 'FE-0232', pass: !failed, checks };
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(JSON.stringify({ test: 'FE-0232', pass: false, error: String(error && error.stack || error).slice(0, 800), checks }, null, 2));
  process.exit(1);
});
