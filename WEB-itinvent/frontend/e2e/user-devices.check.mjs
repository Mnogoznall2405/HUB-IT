// Local-only browser acceptance. Start e2e/stack/local_backend.py and Vite first.
// E2E_DEVICES_URL=http://127.0.0.1:5179 node e2e/user-devices.check.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.E2E_DEVICES_URL || 'http://127.0.0.1:5179';
assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Only the isolated local stack is allowed');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', headless: true,
  args: ['--disable-dev-shm-usage', '--disable-gpu'] });
const contexts = [];
const artifacts = new URL('../../../output/devices-browser/', import.meta.url);
await mkdir(artifacts, { recursive: true });

async function login() {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill('e2e_user');
  await form.locator('input[name="password"]').fill('e2e-local-user-pass');
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 45_000 });
  await page.goto('/settings/security');
  await page.getByText('Мои устройства', { exact: true }).waitFor();
  await page.getByTestId('my-device-card').first().waitFor();
  return { context, page };
}

async function waitForCount(page, count) {
  await page.waitForFunction(expected => document.querySelectorAll('[data-testid="my-device-card"]').length === expected, count);
}

try {
  const first = await login();
  const second = await login();
  await first.page.getByRole('button', { name: 'Обновить устройства', exact: true }).click();
  await waitForCount(first.page, 2);
  await first.page.route('**/auth/my-devices', route => route.abort('failed'));
  await first.page.getByRole('button', { name: 'Обновить устройства', exact: true }).click();
  await first.page.getByText('Не удалось загрузить устройства. Повторите попытку.', { exact: true }).waitFor();
  assert.equal(await first.page.getByRole('button', { name: 'Удалить устройство', exact: true }).first().isDisabled(), true);
  await first.page.unroute('**/auth/my-devices');
  await first.page.getByRole('button', { name: 'Обновить устройства', exact: true }).click();
  await first.page.getByText('Не удалось загрузить устройства. Повторите попытку.', { exact: true }).waitFor({ state: 'hidden' });
  await first.page.getByRole('button', { name: 'Удалить устройство', exact: true }).first().waitFor();
  await first.page.waitForFunction(() => !document.querySelector('[data-testid="my-device-card"] button[disabled]'));
  const other = first.page.getByTestId('my-device-card').filter({ hasNotText: 'Это устройство' });
  await other.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  await first.page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await first.page.getByTestId('my-device-card').count(), 2);
  await other.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  await first.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await waitForCount(first.page, 1);
  assert.equal((await second.context.request.get('/api/v1/auth/me')).status(), 401);
  assert.equal((await first.context.request.get('/api/v1/auth/me')).status(), 200);

  const third = await login();
  await first.page.getByRole('button', { name: 'Обновить устройства', exact: true }).click();
  await waitForCount(first.page, 2);
  await first.page.getByRole('button', { name: 'Завершить все остальные', exact: true }).click();
  await first.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await waitForCount(first.page, 1);
  assert.equal((await third.context.request.get('/api/v1/auth/me')).status(), 401);
  await first.page.getByTestId('my-device-card').first().scrollIntoViewIfNeeded();
  await first.page.screenshot({ path: new URL('desktop.png', artifacts).pathname.replace(/^\/([A-Za-z]:)/, '$1') });

  await first.page.setViewportSize({ width: 390, height: 844 });
  const card = first.page.getByTestId('my-device-card').first();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  assert(box && box.x >= 0 && box.x + box.width <= 391, 'Device card exceeds mobile viewport');
  await first.page.screenshot({ path: new URL('mobile.png', artifacts).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await card.getByRole('button', { name: 'Удалить устройство', exact: true }).click();
  await first.page.getByText('Вы выйдете из аккаунта на этом устройстве.', { exact: true }).waitFor();
  await first.page.getByRole('dialog').getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await first.page.waitForURL(url => url.pathname.startsWith('/login'), { timeout: 30_000 });
  assert.equal((await first.context.request.get('/api/v1/auth/me')).status(), 401);
  console.log('PASS: load error/retry, cancellation, remote deletion, terminate others, current-device logout, desktop and 390px layout');
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();
}
