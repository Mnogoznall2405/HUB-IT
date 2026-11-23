const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const API = process.env.API_URL || 'http://127.0.0.1:18007/api/v1';
const SHOT = 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-public-share.png';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

(async () => {
  const cookie = await apiLogin();
  const listRes = await fetch(`${API}/my-files?limit=100`, { headers: { Cookie: cookie } });
  const list = await listRes.json();
  const items = (list.items || []).filter((i) => /^audit-c17-.*\.txt$/.test(i.original_file_name || ''));
  console.log('FILES', JSON.stringify(items.map((i) => ({ id: i.id, name: i.original_file_name, expires_at: i.expires_at }))));
  if (!items.length) { console.log('NO_FILES'); return; }
  const fileA = items[0];

  const shareRes = await fetch(`${API}/my-files/${encodeURIComponent(fileA.id)}/share`, { method: 'POST', headers: { Cookie: cookie } });
  const share = await shareRes.json().catch(() => ({}));
  console.log('SHARE_CREATE', JSON.stringify({ status: shareRes.status, keys: Object.keys(share), tokenLength: String(share.token || '').length, hasUrl: Boolean(share.url) }));
  const token = String(share.token || '');
  if (!token) return;

  const pub = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await pub.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const url = `${BASE}/shared-files/${token}`;
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2500);
  const body = await page.locator('body').innerText();
  const downloadHref = await page.locator('a[download], a[href*="/download"]').first().getAttribute('href').catch(() => null);
  console.log('PUBLIC_PAGE', JSON.stringify({
    status: 'loaded',
    hasFileName: body.includes(fileA.original_file_name),
    hasDownload: /Скачать|download/i.test(body),
    downloadHrefPath: downloadHref ? new URL(downloadHref, url).pathname.replace(token, '<token>') : null,
    bodyStart: body.slice(0, 220).replace(/\n+/g, ' | '),
  }));
  const dl = await ctx.request.get(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}/download`);
  const dlText = await dl.text().catch(() => '');
  console.log('PUBLIC_DOWNLOAD', JSON.stringify({ status: dl.status(), bytes: dlText.length, hasContent: /cycle17 upload/.test(dlText) }));
  await page.screenshot({ path: SHOT }).catch(() => {});

  const revoke = await fetch(`${API}/my-files/${encodeURIComponent(fileA.id)}/share`, { method: 'DELETE', headers: { Cookie: cookie } });
  console.log('REVOKE', revoke.status);
  const dlAfter = await ctx.request.get(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}/download`);
  const pubAfter = await ctx.request.get(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}`);
  await page.reload({ waitUntil: 'load' });
  await sleep(2000);
  const bodyAfter = await page.locator('body').innerText();
  console.log('AFTER_REVOKE', JSON.stringify({
    downloadStatus: dlAfter.status(),
    publicStatus: pubAfter.status(),
    pageShowsError: /недоступ|не найд|ошиб|истек|отозван/i.test(bodyAfter),
    bodyStart: bodyAfter.slice(0, 200).replace(/\n+/g, ' | '),
  }));
  await pub.close();
})();

