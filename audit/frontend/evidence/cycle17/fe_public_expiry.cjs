const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('child_process');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const API = process.env.API_URL || 'http://127.0.0.1:18007/api/v1';
const DB = process.env.APP_DB || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-stand/WEB-itinvent/frontend/e2e/stack/.state-cycle17/app.sqlite3';
const PY = process.env.PYTHON || 'C:/Project/HUB-IT-main/.venv/Scripts/python.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const list = await (await fetch(`${API}/my-files`, { headers: { Cookie: cookie } })).json();
  const file = (list.items || []).find((i) => /^audit-c17-.*\.txt$/.test(i.original_file_name || ''));
  if (!file) { console.log('NO_FILE'); return; }
  const shareRes = await fetch(`${API}/my-files/${encodeURIComponent(file.id)}/share`, { method: 'POST', headers: { Cookie: cookie } });
  const share = await shareRes.json();
  console.log('SHARE_BEFORE_EXPIRY', JSON.stringify({ status: shareRes.status, tokenLength: String(share.token || '').length, expires_at: share.expires_at }));
  const token = String(share.token || '');
  if (!token) return;

  const before = await fetch(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}`);
  console.log('PUBLIC_BEFORE', before.status);

  const py = `import sqlite3; c=sqlite3.connect(r"${DB}"); c.execute("update my_files set expires_at=? where id=?", ("2020-01-01 00:00:00.000000", "${file.id}")); c.commit(); c.close(); print("updated")`;
  const out = execFileSync(PY, ['-c', py], { encoding: 'utf8' }).trim();
  console.log('DB_UPDATE', out);

  const pub = await fetch(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}`);
  const dl = await fetch(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}/download`);
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/shared-files/${token}`, { waitUntil: 'load' });
  await sleep(2200);
  const body = await page.locator('body').innerText();
  console.log('AFTER_EXPIRY', JSON.stringify({
    publicStatus: pub.status,
    downloadStatus: dl.status,
    pageShowsExpired: /недоступ|истек|срок/i.test(body),
    bodyStart: body.slice(0, 220).replace(/\n+/g, ' | '),
  }));
  await page.screenshot({ path: 'C:/Users/Администратор/AppData/Local/Temp/2/opencode/c17-public-expired.png' }).catch(() => {});
  await browser.close();
})();

