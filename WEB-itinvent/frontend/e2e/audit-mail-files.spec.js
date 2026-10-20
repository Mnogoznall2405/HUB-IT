import { test, expect } from '@playwright/test';

const harness = '/e2e/fixtures/mail-file-actions-harness.html';

test('print popup receives the message and has no opener', async ({ page, context }) => {
  await context.addInitScript(() => { window.print = () => { window.auditPrintCalled = true; }; });
  await page.goto(harness);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Печать письма', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByText('Содержимое письма', { exact: true })).toBeVisible();
  await expect.poll(() => popup.evaluate(() => window.auditPrintCalled)).toBe(true);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(popup.locator('img, script, [onerror]')).toHaveCount(0);
  await expect(popup.locator('h1')).toContainText('<img');
  await expect(page.getByRole('alert')).toBeEmpty();
});

test('mobile print payload keeps metadata as text', async ({ page }) => {
  await page.goto(harness);
  await page.getByRole('button', { name: 'Печать через приложение', exact: true }).click();
  const payload = await page.evaluate(() => {
    const message = window.auditMobilePrint;
    const document = new DOMParser().parseFromString(message.html, 'text/html');
    return { type: message.type, unsafeNodes: document.querySelectorAll('img, script, [onerror]').length,
      title: document.title, heading: document.querySelector('h1').textContent,
      meta: document.querySelector('.meta').textContent, body: document.body.textContent };
  });
  expect(payload.type).toBe('hubit.portal.print');
  expect(payload.unsafeNodes).toBe(0);
  expect(payload.title).toContain('</title><img');
  expect(payload.heading).toContain('</title><img');
  expect(payload.meta).toContain('Отправитель <img');
  expect(payload.meta).toContain('Дата <img');
  expect(payload.body).toContain('Содержимое письма');
});

test('standalone blob open does not also trigger a download', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await page.goto(harness);
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Открыть вложение', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('body')).toContainText('Тестовое вложение');
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  expect(downloads).toHaveLength(0);
});

test('blocked popups report a print error and fall back to a file download', async ({ page }) => {
  await page.addInitScript(() => {
    window.open = () => null;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  });
  await page.goto(harness);
  await page.getByRole('button', { name: 'Печать письма', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть окно печати');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Открыть вложение', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('audit.txt');
  expect(await download.failure()).toBeNull();
});
