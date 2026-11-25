// SW regression probe: prod build + ENABLED service worker.
// Covers: cold start, authed navigation, SW version update, offline/reconnect,
// stale-cache survival, missing-chunk recovery. Fails on renderer crash.
// Usage: node e2e/runtime/sw-prod-repro.cjs <baseURL> [swPathForVersionBump]
const { chromium } = require('playwright');
const fs = require('node:fs');

const BASE = process.argv[2] || 'http://127.0.0.1:5210';
const BACKEND = 'http://127.0.0.1:18002';
const SW_FILE = process.argv[3] || null; // dist/sw.js — bumped for the update test
const USER = { user: 'e2e_calls', pass: 'e2e-local-calls-pass' };

const totp = (secret) => {
  const crypto = require('node:crypto');
  const base32Decode = (s) => {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
    for (const c of s.toUpperCase().replace(/=+$/, '')) { const v = a.indexOf(c); if (v < 0) throw new Error('bad b32'); bits += v.toString(2).padStart(5, '0'); }
    const out = Buffer.alloc(Math.floor(bits.length / 8));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
    return out;
  };
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(ctr).digest();
  const o = h[19] & 0xf;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
};

let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
};

(async () => {
  const browser = await chromium.launch();
  // NO serviceWorkers:'block' — the whole point is a live SW.
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  let crashed = false;
  page.on('crash', () => { crashed = true; });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // ---- 1) cold start: /login loads, SW registers and activates
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  const swReady = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'no-api';
    const reg = await navigator.serviceWorker.ready;
    return reg?.active ? `active:${reg.active.state}` : 'pending';
  });
  check('cold start: /login renders under live SW', !crashed && swReady.startsWith('active'), swReady);

  // ---- 2) authed session via API (full 2FA enroll → cookies land in context jar)
  const api = context.request;
  const login = await api.post(`${BACKEND}/api/v1/auth/login`, { data: { username: USER.user, password: USER.pass } });
  const loginBody = await login.json();
  check('api login returns challenge', loginBody.status === '2fa_required' || loginBody.status === '2fa_setup_required' || loginBody.status === 'authenticated', loginBody.status);
  let authed = loginBody.status === 'authenticated';
  if (!authed) {
    const ch = loginBody.login_challenge_id;
    if (loginBody.status === '2fa_setup_required') {
      const setup = await api.post(`${BACKEND}/api/v1/auth/enable-2fa`, { data: { login_challenge_id: ch } });
      const setupBody = await setup.json();
      const verify = await api.post(`${BACKEND}/api/v1/auth/verify-2fa`, { data: { login_challenge_id: ch, totp_code: totp(setupBody.manual_entry_key) } });
      authed = (await verify.json()).status === 'authenticated';
    } else {
      check('e2e_calls already enrolled — needs secret', false, 'unexpected for fresh seed');
    }
  }
  check('authenticated session established', authed);

  // ---- 3) authed pages under live SW — the original crash locus
  for (const route of ['/dashboard', '/networks', '/about']) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    check(`navigation ${route}: no renderer crash`, !crashed, `url=${page.url()}`);
  }
  const controlledBySw = await page.evaluate(() => Boolean(navigator.serviceWorker?.controller));
  check('page is SW-controlled after activate', controlledBySw);

  // ---- 4) SW version update: bump stamp, update(), skip-waiting → controllerchange
  if (SW_FILE && fs.existsSync(SW_FILE)) {
    const src = fs.readFileSync(SW_FILE, 'utf8');
    const bumped = src
      .replace(/const SW_VERSION = '[^']+'/, `const SW_VERSION = '${new Date().toISOString()}'`)
      .replace(/hubit-app-shell-v[^']+'/, `hubit-app-shell-vtest${Date.now()}'`)
      .replace(/hubit-app-assets-v[^']+'/, `hubit-app-assets-vtest${Date.now()}'`);
    fs.writeFileSync(SW_FILE, bumped);
    const updated = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
      for (let i = 0; i < 40 && !reg.waiting; i++) await new Promise((r) => setTimeout(r, 250));
      if (!reg.waiting) return 'no-waiting-worker';
      const changed = new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve('controllerchange'), { once: true });
        setTimeout(() => resolve('timeout'), 15000);
      });
      reg.waiting.postMessage({ type: 'itinvent:skip-waiting' });
      return changed;
    });
    check('SW update: new version activates on skip-waiting', updated === 'controllerchange', updated);
    await page.waitForTimeout(1500);
    check('SW update: page alive after controllerchange', !crashed);
  } else {
    console.log('SKIP SW update test — no sw.js path provided');
  }

  // ---- 5) offline → cached shell; reconnect → live
  await context.setOffline(true);
  let offlineServed = 'error';
  try {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 15000 });
    offlineServed = await page.evaluate(() => document.title || document.body?.innerText?.slice(0, 80) || 'empty');
  } catch (e) { offlineServed = `nav-failed:${String(e).slice(0, 120)}`; }
  check('offline: navigation served from SW cache (no crash)', !crashed && !String(offlineServed).startsWith('nav-failed'), String(offlineServed).slice(0, 80));
  await context.setOffline(false);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('reconnect: live navigation works', !crashed && /dashboard/.test(page.url()));

  // ---- 6) stale-cache survival: request a chunk that never existed on disk —
  // SPA fallback would serve HTML-as-JS; SW must surface an app error, not crash.
  const staleResult = await page.evaluate(async () => {
    try {
      await import('/assets/definitely-not-a-real-chunk-zzzz.js');
      return 'imported?!';
    } catch (e) { return `err:${String(e && e.message || e).slice(0, 100)}`; }
  });
  check('missing chunk: import fails cleanly (no renderer crash)', !crashed && staleResult.startsWith('err:'), staleResult);

  await page.waitForTimeout(2000);
  check('final: renderer never crashed', !crashed, pageErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failures === 0 ? 'SW-REPRO: ALL GREEN' : `SW-REPRO: ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('SW-REPRO FATAL', e); process.exit(2); });
