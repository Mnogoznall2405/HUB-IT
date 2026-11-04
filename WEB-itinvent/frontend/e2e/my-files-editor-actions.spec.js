import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = '/e2e/fixtures/my-files-editor-recovery-harness.html';
const sdkPath = fileURLToPath(new URL('./fixtures/my-files-office-sdk.fixture.js', import.meta.url));
const frameOf = (page) => page.frameLocator('iframe[title="Документ для проверки восстановления"]');
const contentsOf = (page) => frameOf(page).getByRole('textbox', { name: 'Содержимое документа' });
const configFor = (state) => ({
  role: state.owner === false ? 'edit' : 'owner', public_path: '/e2e/fixtures/office-sdk',
  can_rename: state.owner !== false, can_manage_access: state.owner !== false && !state.library,
  config: {
    documentType: 'word', document: { key: 'same-session-key', fileType: 'docx', title: state.title || 'План.docx', url: '/fixture.docx', permissions: { edit: true } },
    editorConfig: { user: { id: String(state.user || 1) }, mode: 'edit' }, token: 'local-fixture-only',
  },
});

async function openEditor(page, state = {}, query = '') {
  state.calls = [];
  await page.route('**/e2e/fixtures/office-sdk/web-apps/apps/api/documents/api.js', (route) => route.fulfill({ path: sdkPath, contentType: 'text/javascript' }));
  await page.route('**/my-files/recovery-file/office/config', (route) => {
    const config = configFor(state);
    if (state.legacy) { delete config.can_rename; delete config.can_manage_access; }
    return route.fulfill({ json: config });
  });
  await page.route('**/my-files/recovery-file/office/rename', async (route) => {
    state.calls.push(route.request().postDataJSON());
    if (state.rename) return state.rename(route);
    state.title = `${route.request().postDataJSON().name}.docx`;
    return route.fulfill({ json: { file: { id: 'recovery-file', original_file_name: state.title }, editor_notified: state.notified !== false } });
  });
  await page.goto(fixture + query);
  await expect(contentsOf(page)).toBeVisible();
  return state;
}

test('the owner renames in HUB without replacing the frame or losing unsent text', async ({ page }, testInfo) => {
  const state = await openEditor(page);
  await contentsOf(page).fill('Неотправленный текст');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').fill('Рабочий план');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Рабочий план.docx', { exact: true })).toBeVisible();
  await expect(contentsOf(page)).toHaveText('Неотправленный текст');
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  expect(state.calls).toEqual([{ name: 'Рабочий план' }]);
  await expect(page.getByText('Есть неотправленные правки', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('editor-desktop.png'), animations: 'disabled' });
});

test('a slow rename is submitted once and cannot be dismissed before the response', async ({ page }) => {
  let release;
  const state = await openEditor(page, { rename: async (route) => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { file: { id: 'recovery-file', original_file_name: 'Итог.docx' }, editor_notified: true } });
  } });
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').fill('Итог');
  await page.getByLabel('Имя файла').press('Enter');
  await expect.poll(() => state.calls.length).toBe(1);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
  release();
  await expect(page.getByText('Итог.docx', { exact: true })).toBeVisible();
  expect(state.calls).toHaveLength(1);
});

test('a command failure reports that only the HUB name is confirmed', async ({ page }) => {
  await openEditor(page, { notified: false });
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').fill('Новое имя');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText(/Имя сохранено в HUB/)).toBeVisible();
  await expect(page.getByText('Имя файла обновлено.', { exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
});

test('a title broadcast by Document Server updates the HUB header without touching unsent text', async ({ page }) => {
  await openEditor(page);
  await contentsOf(page).fill('Не терять при смене имени');
  await frameOf(page).getByRole('button', { name: 'Переименовано соавтором' }).click();
  await expect(page.getByText('Имя от соавтора.docx', { exact: true })).toBeVisible();
  await expect(contentsOf(page)).toHaveText('Не терять при смене имени');
});

test('a denied rename retains the dialog, previous name and document', async ({ page }) => {
  await openEditor(page, { rename: route => route.fulfill({ status: 403, json: { detail: 'Нет права переименования' } }) });
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').fill('Нельзя');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Нет права переименования', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Имя файла')).toBeFocused();
  await expect(page.getByText('План.docx', { exact: true })).toBeVisible();
  await expect(contentsOf(page)).toBeVisible();
});

test('coauthors cannot manage names or access and library managers use library access', async ({ page }) => {
  await openEditor(page, { owner: false });
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toHaveCount(0);
  await openEditor(page, { library: true });
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toHaveCount(0);
});

test('global HUB permissions are also required for editor actions', async ({ page }) => {
  await openEditor(page, {}, '?deny-my_files.write=1&deny-my_files.share=1');
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toHaveCount(0);
});

test('an older backend without capabilities opens the document and keeps new actions hidden', async ({ page }) => {
  await openEditor(page, { legacy: true });
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toHaveCount(0);
  await expect(contentsOf(page)).toBeVisible();
});

test('a rename response from the previous account never changes the next document', async ({ page }) => {
  let release;
  const state = await openEditor(page, { rename: async (route) => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { file: { id: 'recovery-file', original_file_name: 'Чужой ответ.docx' }, editor_notified: true } });
  } });
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').fill('Старый аккаунт');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  state.user = 2; state.owner = false; state.title = 'Другой аккаунт.docx';
  // This harness-only account switch represents AuthContext changing under a pending HTTP response.
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Сменить пользователя').click());
  await expect(frameOf(page).getByLabel('Пользователь документа')).toHaveText('2');
  release();
  await expect(page.getByText('Другой аккаунт.docx', { exact: true })).toBeVisible();
  await expect(page.getByText('Чужой ответ.docx', { exact: true })).toHaveCount(0);
});

test('revoked management rights with the same key hide actions without recreating the frame', async ({ page }) => {
  const state = await openEditor(page);
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  state.owner = false;
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect(page.getByRole('button', { name: 'Переименовать файл', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
});

test('shared access uses the existing HUB role editor and preserves the live document', async ({ page }) => {
  let saved;
  await page.route('**/my-files/office/groups', route => route.fulfill({ json: { items: [] } }));
  await page.route('**/my-files/recovery-file/office/collaborators', route => {
    if (route.request().method() === 'PUT') {
      saved = route.request().postDataJSON();
      return route.fulfill({ json: { items: [] } });
    }
    return route.fulfill({ json: { items: [{ user_id: 9, username: 'petrov', full_name: 'Петров', role: 'edit' }] } });
  });
  await openEditor(page);
  await contentsOf(page).fill('Работа продолжается');
  await page.getByRole('button', { name: 'Совместный доступ', exact: true }).click();
  await page.getByRole('combobox', { name: 'Роль: Петров (petrov)' }).click();
  await page.getByRole('option', { name: /Комментарии/ }).click();
  await page.getByTestId('my-files-collaborators-save').click();
  await expect(page.getByText('Совместный доступ обновлён в HUB.', { exact: true })).toBeVisible();
  expect(saved).toEqual({ members: [{ user_id: 9, role: 'comment' }] });
  await expect(contentsOf(page)).toHaveText('Работа продолжается');
});

test('failed access loading cannot overwrite the unknown member list', async ({ page }) => {
  await page.route('**/my-files/office/groups', route => route.fulfill({ json: { items: [] } }));
  let writes = 0;
  await page.route('**/my-files/recovery-file/office/collaborators', route => {
    if (route.request().method() === 'PUT') writes += 1;
    return route.fulfill({ status: 503, json: { detail: 'Список доступа временно недоступен' } });
  });
  await openEditor(page);
  await page.getByRole('button', { name: 'Совместный доступ', exact: true }).click();
  await expect(page.getByText('Список доступа временно недоступен', { exact: true })).toBeVisible();
  await expect(page.getByTestId('my-files-collaborators-save')).toBeDisabled();
  await expect(page.getByText('Пока доступ есть только у вас.', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

test('the editor toolbar fits a narrow screen and cancelling a rename preserves unsent text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openEditor(page, { title: 'Очень длинное название документа для работы всей команды.docx' });
  await contentsOf(page).fill('Локальные правки');
  await page.getByRole('button', { name: 'Переименовать файл', exact: true }).click();
  await page.getByLabel('Имя файла').press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(contentsOf(page)).toHaveText('Локальные правки');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Совместный доступ', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Скачать копию', exact: true })).toBeVisible();
  await contentsOf(page).click();
  await page.screenshot({ path: testInfo.outputPath('editor-mobile.png'), animations: 'disabled' });
});
