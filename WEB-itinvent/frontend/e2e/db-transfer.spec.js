import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('retry retains operation key and persistent target PDF can be downloaded and emailed', async ({ page }, testInfo) => {
  const requests = [];
  const pdf = Buffer.from('%PDF-1.7\nfixture-download\n%%EOF');
  const emailed = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/equipment/transfer/to-db') && request.method() === 'POST') {
      requests.push(request.postDataJSON());
      if (requests.length === 1) {
        return route.fulfill({ status: 503, json: { detail: 'Новый PDF акта не создан; исходные данные сохранены' } });
      }
      return route.fulfill({ json: {
        target_db: 'target', summary: { total: 1, ok: 1, failed: 0 }, act_doc_no: 200,
        items: [{ inv_no_old: '1001', inv_no_new: '50', status: 'ok' }],
        verification: { documents: 1, original_files: 2, generated_files: 1 },
        acts: [{ act_id: 'persistent-act', db_id: 'target', file_no: 300, file_name: 'receipt.pdf' }],
      } });
    }
    if (path.endsWith('/equipment/transfer/to-db/target/files/300/email')) {
      emailed.push(request.postDataJSON());
      return route.fulfill({ json: { sent: true } });
    }
    if (path.endsWith('/equipment/transfer/to-db/target/files/300')) {
      return route.fulfill({ contentType: 'application/pdf', body: pdf });
    }
    if (path.includes('/owners/search')) return route.fulfill({ json: { owners: [] } });
    if (path.includes('/assignees')) return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: [] });
  });
  await page.goto('/e2e/fixtures/db-transfer-harness.html');
  await page.getByRole('button', { name: 'Открыть перенос' }).click();
  await page.getByRole('combobox', { name: 'Сотрудник в целевой базе' }).fill('Получатель');
  await page.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByText('Новый PDF акта не создан; исходные данные сохранены')).toBeVisible();
  await page.getByRole('button', { name: 'Перенести', exact: true }).click();
  await expect(page.getByText('Перенос завершён:', { exact: false })).toBeVisible();
  await expect(page.getByText('Перенесено документов: 1; исходных файлов: 2.', { exact: false })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1].operation_id).toBe(requests[0].operation_id);
  expect(requests[1].target_db).toBe('target');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать акт (receipt.pdf)' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('receipt.pdf');
  const output = testInfo.outputPath('receipt.pdf');
  await download.saveAs(output);
  expect(await readFile(output)).toEqual(pdf);
  await page.getByRole('textbox', { name: 'Отправить акт на email' }).fill('test@example.com');
  await page.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(page.getByText('Акт отправлен.')).toBeVisible();
  expect(emailed).toEqual([{ recipient_email: 'test@example.com' }]);
});
