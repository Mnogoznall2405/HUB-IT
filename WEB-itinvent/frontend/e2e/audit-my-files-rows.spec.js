import { test, expect } from '@playwright/test';

const harness = '/e2e/fixtures/my-files-row-harness.html';
const fileName = 'Договор поставки 2026 год подробное наименование.pdf';
const sharedName = 'Общий документ с длинным именем.docx';
const folderName = 'Документы и отчёты за год';

for (const width of [360, 390, 430]) {
  test(`mobile ${width}px: file name keeps readable width, icons collapse into one overflow button`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(harness);
    await expect(page.getByRole('button', { name: `Действия с файлом ${fileName}` })).toBeVisible();
    await expect(page.getByTestId('my-files-download-file-a')).toBeHidden();
    await expect(page.getByTestId('my-files-preview-file-a')).toBeHidden();
    await expect(page.getByTestId('my-files-share-file-a')).toBeHidden();
    const box = await page.locator(`[title="${fileName}"]`).boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(120);
  });
}

test('tapping file overflow opens the actions menu without opening the file', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  await page.getByRole('button', { name: `Действия с файлом ${fileName}` }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Скачать' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Просмотр' })).toBeVisible();
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.fileMenu).toEqual(['file-a']);
  expect(calls.preview).toBe(0);
});

test('shared-with-me file overflow exposes open and download through the menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  await expect(page.getByTestId('my-files-shared-edit-shared-1')).toBeHidden();
  await page.getByRole('button', { name: `Действия с файлом ${sharedName}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Редактировать' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Скачать' })).toBeVisible();
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.shared).toBe(0);
  expect(calls.fileMenu).toEqual(['shared-1']);
});

test('tapping folder overflow opens the folder menu without navigating', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(harness);
  await page.getByRole('button', { name: `Действия с папкой ${folderName}` }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Открыть' })).toBeVisible();
  const calls = await page.evaluate(() => window.__calls);
  expect(calls.folderMenu).toEqual(['folder-a']);
  expect(calls.navigate).toBe(0);
});

test('desktop keeps the overflow button visible and reveals quick actions on row hover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(harness);
  // ⋮ доступен на всех ширинах; быстрые действия — плавающая пилюля, появляется при наведении.
  await expect(page.getByRole('button', { name: `Действия с файлом ${fileName}` })).toBeVisible();
  await expect(page.getByTestId('my-files-download-file-a')).toBeHidden();
  await expect(page.getByTestId('my-files-share-file-a')).toBeHidden();
  await page.getByTitle(fileName).hover();
  await expect(page.getByTestId('my-files-download-file-a')).toBeVisible();
  await expect(page.getByTestId('my-files-share-file-a')).toBeVisible();
  await expect(page.getByTestId('my-files-preview-file-a')).toBeVisible();
});
