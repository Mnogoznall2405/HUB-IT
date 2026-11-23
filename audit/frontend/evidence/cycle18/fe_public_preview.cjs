#!/usr/bin/env node
/*
 * Cycle 18 — FE-0326 reproduction: public PNG preview returns a corrupt artifact.
 *
 * PASS means the bug is reproduced: public preview 200 image/* but the bytes
 * cannot be decoded; the original download still works.
 *
 * Run from WEB-itinvent/frontend:
 *   API_URL=http://127.0.0.1:18008/api/v1 BASE_URL=http://127.0.0.1:5228 \
 *   NODE_PATH=<frontend>/node_modules node fe_public_preview.cjs
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const API = process.env.API_URL || 'http://127.0.0.1:18008/api/v1';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5228';
const PYTHON = process.env.PREVIEW_PYTHON || 'C:/Project/HUB-IT-main/.venv/Scripts/python.exe';
const OUT = process.env.SHOT_DIR || process.cwd();
const checks = [];
let failed = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  if (!ok) failed = true;
}

(async () => {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2e_admin', password: 'e2e-local-admin-pass' }),
  });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const list = await (await fetch(`${API}/my-files`, { headers: { Cookie: cookie } })).json();
  const file = (list.items || []).find((i) => /\.png$/i.test(i.original_file_name || '') && i.preview_available === true);
  check('setup.pngWithPreview', Boolean(file), { files: (list.items || []).filter((i) => /\.png$/i.test(i.original_file_name || '')).map((i) => ({ name: i.original_file_name, preview: i.preview_status })) });
  if (!file) { console.log(JSON.stringify({ test: 'FE-0326', pass: false, checks }, null, 2)); process.exit(1); }

  const shareRes = await fetch(`${API}/my-files/${encodeURIComponent(file.id)}/share`, { method: 'POST', headers: { Cookie: cookie } });
  const share = await shareRes.json();
  const token = String(share.token || '');
  check('share.created', shareRes.status === 200 && Boolean(token), { status: shareRes.status });
  if (!token) { console.log(JSON.stringify({ test: 'FE-0326', pass: false, checks }, null, 2)); process.exit(1); }

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/shared-files/${token}`, { waitUntil: 'load' });
  await sleep(2200);
  const imgSrc = await page.locator('img').evaluateAll((ns) => ns.map((n) => n.getAttribute('src') || '').find((s) => s.includes('/preview/content')) || null);
  check('public.previewImageElement', Boolean(imgSrc), { src: imgSrc });

  const preview = await ctx.request.get(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}/preview/content`);
  const previewBody = await preview.body();
  check('public.previewStatus', preview.status() === 200 && String(preview.headers()['content-type'] || '').startsWith('image/'), { status: preview.status(), type: preview.headers()['content-type'], bytes: previewBody.length });
  const previewPath = path.join(OUT, 'fe0326-public-preview.bin');
  fs.writeFileSync(previewPath, previewBody);
  let decodeOk = false;
  let decodeError = '';
  try {
    execFileSync(PYTHON, ['-c', `from PIL import Image; im=Image.open(r"${previewPath.replace(/\\/g, '/')}"); im.load(); print(im.size)`], { encoding: 'utf8' });
    decodeOk = true;
  } catch (error) {
    decodeError = String(error.stderr || error.message).slice(-160);
  }
  check('public.previewCorruptReproduced', decodeOk === false, { decodeOk, decodeError });

  const download = await ctx.request.get(`${BASE}/api/v1/my-files/public/${encodeURIComponent(token)}/download`);
  check('public.originalDownloadWorks', download.status() === 200 && (await download.body()).length > 0, { status: download.status() });
  await page.screenshot({ path: path.join(OUT, 'c18-public-preview.png') }).catch(() => {});
  await browser.close();

  const revoke = await fetch(`${API}/my-files/${encodeURIComponent(file.id)}/share`, { method: 'DELETE', headers: { Cookie: cookie } });
  check('share.revoked', revoke.status === 204, { status: revoke.status });

  console.log(JSON.stringify({ test: 'FE-0326', pass: !failed, file: file.original_file_name, checks }, null, 2));
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(JSON.stringify({ test: 'FE-0326', pass: false, error: String(error && error.stack || error).slice(0, 600), checks }, null, 2));
  process.exit(1);
});
