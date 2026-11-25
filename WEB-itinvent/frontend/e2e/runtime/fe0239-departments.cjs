#!/usr/bin/env node
/*
 * Release-gate FE-0239 — post-fix assertions (inverse of audit cycle 18).
 *
 * Original bug: a late members response from the previously selected
 * department overwrote the manager draft; Save wrote those managers into the
 * currently selected department.
 * Post-fix contract: the seq guard drops the stale D1 response; the draft
 * shown for D2 is D2's own managers; Save writes D2's managers back to D2;
 * D1 is untouched.
 *
 * Run from WEB-itinvent/frontend:
 *   API_URL=http://127.0.0.1:18008/api/v1 BASE_URL=http://127.0.0.1:5228 \
 *   FIXTURE_FILE=<temp>/gate_fixtures.json node e2e/runtime/fe0239-departments.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:18008/api/v1';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5228';
const FIXTURE = process.env.FIXTURE_FILE || path.join(process.cwd(), 'gate_fixtures.json');
const FX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
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
  await setManagers(cookie, FX.d1.id, [FX.created.owner.id]);
  await setManagers(cookie, FX.d2.id, [FX.created.mgrB.id]);
  const before = { d1: await managers(cookie, FX.d1.id), d2: await managers(cookie, FX.d2.id) };
  check('before.d1Owner', JSON.stringify(before.d1.managers) === JSON.stringify([FX.created.owner.id]), before.d1);
  check('before.d2ManagerB', JSON.stringify(before.d2.managers) === JSON.stringify([FX.created.mgrB.id]), before.d2);

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const puts = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'PUT' && u.pathname.endsWith('/managers')) {
      let body = null;
      try { body = JSON.parse(r.postData() || 'null'); } catch (e) {}
      puts.push({ path: u.pathname, body });
    }
  });
  await ctx.route(`**/api/v1/departments/${FX.d1.id}/members`, async (route) => {
    await sleep(3200);
    await route.continue();
  });
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(400);
  await page.goto('/admin/departments', { waitUntil: 'load' });
  await sleep(1600);
  const combo = page.getByRole('combobox').first();
  async function select(name) {
    await combo.click();
    await sleep(350);
    const option = page.getByRole('option', { name }).first();
    if (await option.count()) await option.click();
    else await page.getByText(name, { exact: true }).last().click();
    await sleep(250);
  }

  // D2 → D1 → back to D2 while D1's members response is delayed: the late
  // D1 payload lands while D2 is selected. Post-fix the seq guard drops it,
  // so the draft shown for D2 is D2's own managers.
  await select(FX.d2.name);
  await sleep(1500);
  await select(FX.d1.name);
  await sleep(250);
  await select(FX.d2.name);
  await sleep(3700);
  const raceBody = await page.locator('body').innerText();
  const selectedD2 = raceBody.includes(FX.d2.name);
  const showsOwner = raceBody.includes('Audit Owner');
  const showsDelegate = raceBody.includes('Audit Delegate');
  const showsMgrB = raceBody.includes('Audit Manager B');
  check('race.selectedD2', selectedD2);
  check('race.staleD1MembersDropped', !(showsOwner && showsDelegate), { showsOwner, showsDelegate });
  check('race.d2ManagersShown', showsMgrB, { showsMgrB });

  await page.getByRole('button', { name: 'Сохранить начальников' }).first().click();
  await sleep(3000);
  await page.screenshot({ path: path.join(process.env.SHOT_DIR || process.cwd(), 'fe0239-gate.png') }).catch(() => {});
  await browser.close();

  const put = puts[puts.length - 1] || null;
  const d2Path = `/api/v1/departments/${FX.d2.id}/managers`;
  check('save.putTargetsSelectedD2', Boolean(put && put.path === d2Path), put);
  // D2 keeps its own manager — the stale D1 owner must not be written.
  check('save.putKeepsD2Managers', Boolean(put && Array.isArray(put.body?.manager_user_ids)
    && put.body.manager_user_ids.length === 1 && Number(put.body.manager_user_ids[0]) === FX.created.mgrB.id), put);

  const after = { d1: await managers(cookie, FX.d1.id), d2: await managers(cookie, FX.d2.id) };
  check('after.d1Unchanged', JSON.stringify(after.d1.managers) === JSON.stringify([FX.created.owner.id]), after.d1);
  check('after.d2Unchanged', JSON.stringify(after.d2.managers) === JSON.stringify([FX.created.mgrB.id]), after.d2);

  console.log(JSON.stringify({ test: 'FE-0239', pass: !failed, checks }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(JSON.stringify({ test: 'FE-0239', pass: false, error: String(error && error.stack || error).slice(0, 800), checks }, null, 2));
  process.exit(1);
});
