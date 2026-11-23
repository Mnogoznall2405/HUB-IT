#!/usr/bin/env node
/*
 * Cycle 19 — FE-0326 matrix: small / medium / large PNG through upload,
 * preview worker, private and public preview, Pillow/browser checks.
 *
 * Run from WEB-itinvent/frontend:
 *   BASE_URL=http://127.0.0.1:5229 API_URL=http://127.0.0.1:18009/api/v1 \
 *   NODE_PATH=<frontend>/node_modules node fe0326-matrix.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5229';
const API = process.env.API_URL || 'http://127.0.0.1:18009/api/v1';
const OUT = process.env.SHOT_DIR || process.cwd();
const SRC = process.env.PNG_DIR || 'C:/Users/Администратор/AppData/Local/Temp/2/opencode';
const files = [
  { key: 'small', name: 'c19-png-small.png' },
  { key: 'medium', name: 'c19-png-medium.png' },
  { key: 'large', name: 'c19-png-large.png' },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function login(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username');
  await page.fill('#login-username', 'e2e_admin');
  await page.fill('#login-password', 'e2e-local-admin-pass');
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await sleep(500);
}

async function upload(page, filePath, name) {
  await page.goto('/my-files', { waitUntil: 'load' });
  await sleep(1800);
  await page.locator('input[type=file]').first().setInputFiles(filePath);
  await sleep(900);
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 15000 });
  await dialog.getByRole('button', { name: 'Загрузить' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 120000 });
  const started = Date.now();
  let item = null;
  while (Date.now() - started < 120000) {
    const res = await page.evaluate(async () => (await fetch('/api/v1/my-files', { credentials: 'include' })).json());
    item = (res.items || []).find((i) => i.original_file_name === name);
    if (item && item.preview_available) break;
    await sleep(700);
  }
  return item;
}

async function privatePreview(page, itemId) {
  const res = await page.request.get(`${BASE}/api/v1/my-files/${encodeURIComponent(itemId)}/preview/content`);
  const body = await res.body();
  return { status: res.status(), type: res.headers()['content-type'] || '', bytes: body.length, sha256: sha(body) };
}

async function openPrivateDialog(page, itemId) {
  await page.goto('/my-files', { waitUntil: 'load' });
  await sleep(1800);
  const item = await page.evaluate(async () => (await fetch('/api/v1/my-files', { credentials: 'include' })).json());
  const found = (item.items || []).find((i) => i.id === itemId);
  if (!found) return { opened: false };
  const search = page.getByLabel(/Поиск файла или папки по всему диску/).first();
  await search.fill(found.original_file_name);
  await sleep(1400);
  await page.getByTestId(`my-files-menu-file-${itemId}`).click({ force: true });
  await sleep(400);
  await page.getByRole('menuitem', { name: 'Просмотр' }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const img = dialog.locator('img').first();
  const metrics = await img.evaluate((node) => ({
    complete: node.complete,
    naturalWidth: node.naturalWidth,
    naturalHeight: node.naturalHeight,
    alt: node.alt,
    src: (node.getAttribute('src') || '').slice(0, 40),
  })).catch(() => null);
  return { opened: true, metrics };
}

async function publicShare(page, itemId) {
  const shareRes = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/my-files/${id}/share`, { method: 'POST', credentials: 'include' });
    return { status: res.status, json: await res.json().catch(() => null) };
  }, itemId);
  return shareRes;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page);
  const report = { base: BASE, files: [] };
  for (const file of files) {
    const filePath = path.join(SRC, file.name);
    const original = fs.readFileSync(filePath);
    const record = {
      key: file.key,
      name: file.name,
      originalBytes: original.length,
      originalSha256: sha(original),
    };
    const item = await upload(page, filePath, file.name);
    if (!item) {
      record.error = 'upload/preview did not become ready';
      report.files.push(record);
      continue;
    }
    record.item = {
      id: item.id,
      status: item.preview_status,
      available: item.preview_available,
      kind: item.preview_kind,
      size: item.original_size_bytes,
    };
    record.privatePreview = await privatePreview(page, item.id);
    const dialog = await openPrivateDialog(page, item.id);
    record.privateDialog = dialog;
    await page.screenshot({ path: path.join(OUT, `fe0326-${file.key}-private.png`) }).catch(() => {});

    const share = await publicShare(page, item.id);
    record.share = { status: share.status, tokenLength: String(share.json?.token || '').length };
    if (share.json?.token) {
      const publicCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pub = await publicCtx.newPage();
      await pub.goto(`${BASE}/shared-files/${share.json.token}`, { waitUntil: 'load' });
      await sleep(2500);
      const img = pub.locator('img').evaluateAll((nodes) => nodes
        .filter((n) => (n.getAttribute('src') || '').includes('/preview/content'))
        .map((n) => ({ complete: n.complete, naturalWidth: n.naturalWidth, naturalHeight: n.naturalHeight, alt: n.alt }))[0] || null);
      const publicImg = await img;
      const publicPreviewRes = await publicCtx.request.get(`${BASE}/api/v1/my-files/public/${share.json.token}/preview/content`);
      const publicPreviewBody = await publicPreviewRes.body();
      const publicDownloadRes = await publicCtx.request.get(`${BASE}/api/v1/my-files/public/${share.json.token}/download`);
      const publicDownloadBody = await publicDownloadRes.body();
      record.public = {
        page: publicImg,
        visualError: Boolean(publicImg && publicImg.complete && publicImg.naturalWidth === 0),
        preview: { status: publicPreviewRes.status(), type: publicPreviewRes.headers()['content-type'] || '', bytes: publicPreviewBody.length, sha256: sha(publicPreviewBody) },
        download: { status: publicDownloadRes.status(), bytes: publicDownloadBody.length, sha256: sha(publicDownloadBody), matchesOriginal: sha(publicDownloadBody) === record.originalSha256 },
      };
      await pub.screenshot({ path: path.join(OUT, `fe0326-${file.key}-public.png`) }).catch(() => {});
      await publicCtx.close();
    }
    const privateDownload = await page.request.get(`${BASE}/api/v1/my-files/${encodeURIComponent(item.id)}/download`);
    const privateDownloadBody = await privateDownload.body();
    record.privateDownload = { status: privateDownload.status(), bytes: privateDownloadBody.length, sha256: sha(privateDownloadBody), matchesOriginal: sha(privateDownloadBody) === record.originalSha256 };
    if (share.json?.token) {
      await page.evaluate(async (id) => { await fetch(`/api/v1/my-files/${id}/share`, { method: 'DELETE', credentials: 'include' }); }, item.id);
    }
    report.files.push(record);
    console.log(JSON.stringify({ key: file.key, itemId: item.id, private: record.privatePreview, public: record.public?.preview, publicVisualError: record.public?.visualError, dialog: record.privateDialog }));
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'fe0326-matrix.json'), JSON.stringify(report, null, 2));
  console.log('WROTE', path.join(OUT, 'fe0326-matrix.json'));
})();
