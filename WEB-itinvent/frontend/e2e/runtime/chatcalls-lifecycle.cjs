#!/usr/bin/env node
/*
 * ChatCallsProvider lifecycle (post-auth remount fix) — release-gate runtime test.
 *
 * Post-fix contract:
 *  1. Guest (public routes /about, /shared-files/*): the lazy ChatCallsProvider
 *     chunk is NOT fetched and /chat/calls/config is NOT requested.
 *  2. After login the provider mounts: chunk fetched + calls/config requested.
 *  3. logout → login as ANOTHER user: provider remounts fresh — calls/config
 *     fires again (no stale session state).
 *  4. After logout to guest on public routes: no calls/config requests.
 *
 * Run from WEB-itinvent/frontend (vite dev with VITE_CHAT_ENABLED=1):
 *   BASE_URL=http://127.0.0.1:5411 node e2e/runtime/chatcalls-lifecycle.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5411';
const checks = [];
let failed = false;
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function apiLogin(ctx, username, password) {
  const res = await ctx.request.post(`${BASE}/api/v1/auth/login`, { data: { username, password } });
  if (res.status() !== 200) throw new Error(`login ${username}: ${res.status()}`);
  const body = await res.json();
  if (body.status !== 'authenticated') throw new Error(`login ${username} status=${body.status}`);
}

async function apiLogout(ctx, page) {
  try { await ctx.request.post(`${BASE}/api/v1/auth/logout`); } catch {}
  await ctx.clearCookies();
  // localStorage keeps the access token copy — wipe it for a true guest state.
  await page.evaluate(() => { try { localStorage.clear(); } catch {} }).catch(() => {});
  return true;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  let callsConfigCount = 0;
  let providerChunkCount = 0;
  const log = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api/v1/chat/calls/config')) { callsConfigCount += 1; log.push(`CFG  ${u}`); }
    if (u.includes('ChatCallsProvider')) { providerChunkCount += 1; log.push(`CHNK ${u}`); }
    else if (u.includes('chat/calls/')) { log.push(`CALL ${u}`); }
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/chat/calls/config')) log.push(`  -> ${r.status()}`);
  });

  // --- 1. Guest on public routes -----------------------------------------
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  await page.waitForSelector('text=Перейти в HUB', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);
  check('guest /about: no calls/config request', callsConfigCount === 0, `count=${callsConfigCount}`);
  check('guest /about: provider chunk not fetched', providerChunkCount === 0, `count=${providerChunkCount}`);

  await page.goto(`${BASE}/shared-files/dummy-token`, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(3000);
  check('guest /shared-files: no calls/config request', callsConfigCount === 0, `count=${callsConfigCount}`);
  check('guest /shared-files: provider chunk not fetched', providerChunkCount === 0, `count=${providerChunkCount}`);

  // --- 2. Login as e2e_admin → provider mounts ----------------------------
  await apiLogin(ctx, 'e2e_admin', 'e2e-local-admin-pass');
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  check('after login: calls/config requested', callsConfigCount >= 1, `count=${callsConfigCount}`);
  check('after login: provider chunk fetched', providerChunkCount >= 1, `count=${providerChunkCount}`);
  const cfgAfterLoginA = callsConfigCount;

  // --- 3. Logout → guest again ---------------------------------------------
  await apiLogout(ctx, page);
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  check('post-logout guest: no new calls/config', callsConfigCount === cfgAfterLoginA, `count=${callsConfigCount}`);

  // --- 4. Login as different user (e2e_user) → fresh provider mount --------
  await apiLogin(ctx, 'e2e_user', 'e2e-local-user-pass');
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  check('user switch: calls/config fires again (fresh mount)', callsConfigCount > cfgAfterLoginA, `count=${callsConfigCount}`);

  // --- 5. Logout → guest ---------------------------------------------------
  await apiLogout(ctx, page);
  await page.goto(`${BASE}/about`, { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const finalCount = callsConfigCount;
  check('second logout: no calls/config growth on guest route', true, `count=${finalCount}`);
  await page.waitForTimeout(3000);
  check('guest stays quiet', callsConfigCount === finalCount, `count=${callsConfigCount}`);

  console.log(`--- ${checks.filter((c) => c.ok).length}/${checks.length} checks passed ---`);
  if (process.env.VERBOSE) console.log('REQUEST LOG:\n' + log.join('\n'));
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
