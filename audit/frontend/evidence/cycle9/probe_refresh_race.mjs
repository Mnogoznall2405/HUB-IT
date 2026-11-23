// FE-0083 verification: cross-tab refresh race on the local stack.
// Simulates N tabs waking simultaneously: parallel POST /auth/refresh with the
// SAME refresh cookie. Backend grace (MAX_HITS=1, 15s TTL) should serve the
// first grace hit and revoke the family on the second.
import { createRequire } from 'node:module';
const require = createRequire('C:/Project/HUB-IT-main/WEB-itinvent/frontend/package.json');
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'chrome', args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('input[name="username"]', { timeout: 30000 });
await page.fill('input[name="username"]', 'e2e_admin');
await page.fill('input[type="password"]', 'e2e-local-admin-pass');
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard|about/, { timeout: 30000 });
console.log('LOGGED IN:', page.url());
await page.waitForTimeout(2000);

const me = async (p, tag) => {
  const r = await p.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'include' })).status);
  console.log(`  ${tag} /auth/me -> ${r}`);
  return r;
};

await me(page, 'baseline');

// Two "tabs" in the same context share the cookie jar.
const page2 = await ctx.newPage();
await page2.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page2.waitForTimeout(1500);

const REFRESH = `fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.status)`;

console.log('\n=== TEST 1: 3 parallel refreshes in ONE page (same cookie, uncoordinated) ===');
let res = await page.evaluate(async () => Promise.all([
  fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.status),
  fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.status),
  fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include' }).then(r => r.status),
]));
console.log('  statuses:', JSON.stringify(res));
await me(page, 'post-race');
await me(page2, 'other-tab');

if (res.every(s => s === 200)) {
  console.log('\n=== TEST 2: re-login, then staggered parallel refresh across TWO pages ===');
  // re-login fresh session
  const p3 = await ctx.newPage();
  await p3.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  const hasForm = await p3.$('input[name="username"]');
  if (hasForm) {
    await p3.fill('input[name="username"]', 'e2e_admin');
    await p3.fill('input[type="password"]', 'e2e-local-admin-pass');
    await p3.click('button[type="submit"]');
    await p3.waitForURL(/dashboard|about/, { timeout: 30000 });
    await p3.waitForTimeout(1500);
  }
  const t1 = p3.evaluate(REFRESH);           // fires ~immediately
  const t2 = p3.evaluate(REFRESH);           // same tick — uncoordinated like a 2nd tab
  const t3 = p3.evaluate(REFRESH);
  const t4 = p3.evaluate(REFRESH);
  const out = await Promise.all([t1, t2, t3, t4]);
  console.log('  4x parallel statuses:', JSON.stringify(out));
  await me(p3, 'after-4x');
}

console.log('\n=== TEST 3: sequential refresh (sanity — should stay logged in) ===');
const p4 = await ctx.newPage();
await p4.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
if (await p4.$('input[name="username"]')) {
  await p4.fill('input[name="username"]', 'e2e_admin');
  await p4.fill('input[type="password"]', 'e2e-local-admin-pass');
  await p4.click('button[type="submit"]');
  await p4.waitForURL(/dashboard|about/, { timeout: 30000 });
  await p4.waitForTimeout(1000);
}
const seq = [];
seq.push(await p4.evaluate(REFRESH));
await p4.waitForTimeout(600);
seq.push(await p4.evaluate(REFRESH));
console.log('  sequential statuses:', JSON.stringify(seq));
await me(p4, 'after-sequential');

await browser.close();
console.log('DONE');
