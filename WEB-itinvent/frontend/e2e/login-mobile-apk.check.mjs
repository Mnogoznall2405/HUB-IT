// E2E_LOCAL=1 node e2e/login-mobile-apk.check.mjs
// All browser requests are fulfilled from local build/public fixtures; no live API calls.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

assert.equal(process.env.E2E_LOCAL, '1', 'Set E2E_LOCAL=1; no production browser requests are allowed');
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const buildRoot = path.resolve(process.env.E2E_LOGIN_BUILD_DIR || path.join(repoRoot, 'output/mobile-login-apk'));
const output = path.join(repoRoot, 'artifacts/mobile-login-apk');
const manifest = {
  schema_version: 2, channel: 'preview', version: '1.1.80', version_code: 82,
  published_at: '2026-11-09T18:34:07Z',
  relative_path: 'mobile/preview/1.1.80/HUB-IT-Mobile-Preview-1.1.80.apk',
  size_bytes: 71080953, sha256: '72f393316091f942f40faa93d815f772b25fb5f0a4c1383a0d6445ba3229a6ec',
  package_name: 'ru.zsgp.hubit.mobile',
  min_sdk: 24, min_supported_version_code: 1, changelog: ['Local browser acceptance'],
  signer_sha256: 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c',
};
const desktopManifest = {
  schema_version: 1, channel: 'stable', version: '0.1.12',
  published_at: '2026-08-12T10:00:00Z',
  relative_path: 'stable/0.1.12/HUB-Desktop-Setup-0.1.12-win-x64.exe',
  size_bytes: 413449628, sha256: 'a'.repeat(64), release_notes: ['Local browser acceptance'],
  signature: { algorithm: 'RSA-PSS-SHA256', key_id: 'hub-desktop-update-2026-01', value: 'c2lnbmF0dXJl' },
};
const downloadPath = '/desktop-updates/' + manifest.relative_path;
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true,
  downloadsPath: output, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const contexts = [];

async function openLogin(width, { unavailable = false } = {}) {
  const mobile = width < 768;
  const context = await browser.newContext({ viewport: { width, height: mobile ? 844 : 1000 },
    serviceWorkers: 'block', acceptDownloads: true,
    userAgent: mobile
      ? 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/144.0 Mobile Safari/537.36'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0 Safari/537.36',
  });
  contexts.push(context);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://hubit.zsgp.ru') return route.abort();
    if (url.pathname.endsWith('/auth/login-mode')) return route.fulfill({ json: {
      network_zone: 'internal', biometric_login_enabled: false, windows_sso_enabled: false,
    } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } });
    if (url.pathname === '/desktop-updates/mobile/preview/latest.json') return route.fulfill({
      status: unavailable ? 404 : 200, json: unavailable ? { detail: 'Not found' } : manifest,
    });
    if (url.pathname === '/desktop-updates/stable/latest.json') return route.fulfill({ json: desktopManifest });
    if (url.pathname === downloadPath) return route.abort();
    const relative = url.pathname === '/login' || url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const filename = path.resolve(buildRoot, relative);
    if (!filename.startsWith(buildRoot + path.sep)) return route.abort();
    try {
      return await route.fulfill({ body: await readFile(filename), contentType: mime[path.extname(filename)] || 'application/octet-stream' });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  await page.goto('https://hubit.zsgp.ru/login');
  await page.getByTestId('password-auth-form').waitFor();
  return page;
}

try {
  for (const width of [320, 390, 767]) {
    const page = await openLogin(width);
    const link = page.getByRole('link', { name: 'Скачать для Android', exact: true });
    await link.waitFor({ state: 'visible', timeout: 8000 });
    assert.equal(await link.getAttribute('href'), 'https://hubit.zsgp.ru' + downloadPath);
    assert.equal(await page.locator('[data-testid^="desktop-installer-"]').count(), 0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    await link.scrollIntoViewIfNeeded();
    const bounds = await link.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'APK link must fit the viewport');
    if (width === 390) {
      await page.screenshot({ path: path.join(output, 'mobile-login-390.png'), fullPage: true });
    }
    console.log(`PASS mobile ${width}px: password form, Android link, no overflow`);
  }
  const desktop = await openLogin(1440);
  await desktop.getByRole('link', { name: 'Скачать для Android', exact: true }).waitFor();
  await desktop.getByTestId('desktop-installer-ready').waitFor();
  console.log('PASS desktop: Android and Windows downloads remain available');
  const unavailable = await openLogin(390, { unavailable: true });
  await unavailable.getByTestId('mobile-installer-unavailable').waitFor();
  assert.equal(await unavailable.getByRole('link', { name: 'Скачать для Android', exact: true }).count(), 0);
  assert(await unavailable.getByTestId('password-auth-form').isVisible());
  console.log('PASS missing APK feed: error shown, password sign-in remains available');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
