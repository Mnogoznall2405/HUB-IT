import { test, expect } from '@playwright/test';

async function prepare(page) {
  const user = { id: 7, username: 'user-a', role: 'viewer', is_active: true };
  await page.addInitScript((value) => localStorage.setItem('user', JSON.stringify(value)), user);
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: user }));
  await page.goto('/e2e/fixtures/session-cache-harness.html');
  await expect(page.getByLabel('Пользователь', { exact: true })).toHaveText('user-a');
}

async function transfer(page, id = '') {
  return page.evaluateHandle((key) => {
    const data = new DataTransfer();
    data.items.add(new File(['drop'], 'drop.txt'));
    if (key) {
      let sent = false;
      const entry = {
        isDirectory: true, name: key,
        createReader: () => ({ readEntries: (resolve) => {
          if (sent) { resolve([]); return; }
          sent = true;
          window.auditDropReleases ||= {};
          window.auditDropReleases[key] = () => resolve([{
            isFile: true, file: (accept) => accept(new File(['folder'], `${key}.txt`)),
          }]);
        } }),
      };
      Object.defineProperty(data, 'items', { value: [{ kind: 'file', webkitGetAsEntry: () => entry }] });
    }
    return data;
  }, id);
}

async function drop(page, id = '') {
  const data = await transfer(page, id);
  await page.dispatchEvent('body', 'drop', { dataTransfer: data });
  await data.dispose();
  if (id) await expect.poll(() => page.evaluate((key) => Boolean(window.auditDropReleases?.[key]), id)).toBe(true);
}

async function release(page, id) {
  await page.evaluate(async (key) => {
    window.auditDropReleases[key]();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, id);
}

test('ordinary window drop still opens the upload dialog', async ({ page }) => {
  await prepare(page);
  await drop(page);
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('open');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('drop.txt');
});

for (const view of ['Корзина', 'Недавние', 'Избранное']) {
  test(`window drop is disabled in ${view}`, async ({ page }) => {
    await prepare(page);
    await page.getByRole('button', { name: view, exact: true }).click();
    await drop(page);
    await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
    await expect(page.getByLabel('Подготовленные файлы')).toHaveText('empty');
  });
}

test('a pending directory read cannot open upload in a special view', async ({ page }) => {
  await prepare(page);
  await drop(page, 'old-folder');
  await expect(page.getByLabel('Чтение drop')).toHaveText('true');
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await release(page, 'old-folder');
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('empty');
});

test('navigation to another folder cancels a pending drop instead of changing its destination', async ({ page }) => {
  await prepare(page);
  await drop(page, 'folder-a');
  await page.getByRole('button', { name: 'Папка B', exact: true }).click();
  await release(page, 'folder-a');
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('empty');
});

test('entering a special view clears a previously active drop overlay', async ({ page }) => {
  await prepare(page);
  const data = await transfer(page);
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: data });
  await data.dispose();
  await expect(page.getByLabel('Подсветка drop')).toHaveText('true');
  await page.getByRole('button', { name: 'Корзина', exact: true }).click();
  await expect(page.getByLabel('Подсветка drop')).toHaveText('false');
});

test('completion of an old directory read cannot finish the newer drop', async ({ page }) => {
  await prepare(page);
  await drop(page, 'old-read');
  await page.getByRole('button', { name: 'Папка B', exact: true }).click();
  await expect(page.getByLabel('Чтение drop')).toHaveText('false');
  await drop(page, 'new-read');
  await expect(page.getByLabel('Чтение drop')).toHaveText('true');
  await release(page, 'old-read');
  await expect(page.getByLabel('Чтение drop')).toHaveText('true');
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
  await release(page, 'new-read');
  await expect(page.getByLabel('Чтение drop')).toHaveText('false');
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('open');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('new-read.txt');
});

test('navigation cannot retarget files already prepared in an upload dialog', async ({ page }) => {
  await prepare(page);
  await drop(page);
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('open');
  await page.getByRole('button', { name: 'Папка B', exact: true }).click();
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('empty');
});

test('cancelled preparation clears the native file input and permits selecting the same file again', async ({ page }) => {
  await prepare(page);
  const input = page.getByLabel('Файлы для загрузки');
  const file = { name: 'picked.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture') };
  await input.setInputFiles(file);
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('open');
  await page.getByRole('button', { name: 'Папка B', exact: true }).click();
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('closed');
  expect(await input.evaluate((element) => element.files.length)).toBe(0);
  await input.setInputFiles(file);
  await expect(page.getByLabel('Диалог загрузки')).toHaveText('open');
  await expect(page.getByLabel('Подготовленные файлы')).toHaveText('picked.txt');
});
