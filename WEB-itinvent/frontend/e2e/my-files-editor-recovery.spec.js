import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = '/e2e/fixtures/my-files-editor-recovery-harness.html';
const sdkPath = fileURLToPath(new URL('./fixtures/my-files-office-sdk.fixture.js', import.meta.url));
const frameOf = (page) => page.frameLocator('iframe[title="Документ для проверки восстановления"]');
const contentsOf = (page) => frameOf(page).getByRole('textbox', { name: 'Содержимое документа' });
const configFor = (key, user = 1) => ({
  role: 'edit', public_path: '/e2e/fixtures/office-sdk',
  config: {
    documentType: 'word', document: { key, fileType: 'docx', title: 'План.docx', url: '/fixture.docx', permissions: { edit: true } },
    editorConfig: { user: { id: String(user), name: `editor-${user}` }, mode: 'edit', customization: { autosave: true, forcesave: false } },
    token: `test-only-${key}-${user}`,
  },
});

async function openEditor(page, state = {}, waitForDocument = true) {
  state.calls = 0;
  state.key ||= 'version-one';
  state.user ||= 1;
  await page.route('**/e2e/fixtures/office-sdk/web-apps/apps/api/documents/api.js', (route) => route.fulfill({ path: sdkPath, contentType: 'text/javascript' }));
  await page.route('**/my-files/recovery-file/office/config', async (route) => {
    state.calls += 1;
    if (state.handler) return state.handler(route, state);
    if (state.status) return route.fulfill({ status: state.status, json: { detail: 'Доступ изменён' } });
    return route.fulfill({ json: configFor(state.key, state.user) });
  });
  await page.goto(fixture + (state.dialog ? '?dialog=1' : ''));
  if (waitForDocument) await expect(contentsOf(page)).toBeVisible();
  return state;
}

test('a brief network outage keeps the same editor and local text', async ({ page, context }) => {
  const state = await openEditor(page);
  await contentsOf(page).fill('Важные неотправленные правки');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await context.setOffline(true);
  await expect(page.getByText(/Нет сети/)).toBeVisible();
  await expect(contentsOf(page)).toHaveText('Важные неотправленные правки');
  await context.setOffline(false);
  await expect(page.getByText(/Нет сети/)).toBeHidden();
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(contentsOf(page)).toHaveText('Важные неотправленные правки');
  expect(state.calls).toBe(1);
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  await expect(page.getByTestId('my-files-office-save-state')).toHaveText('Правки на сервере редактора');
  await expect(page.getByText('Сохранено в HUB', { exact: true })).toHaveCount(0);
});

test('a refresh after reconnect retries HUB and updates the version without replacing the iframe', async ({ page }) => {
  const state = await openEditor(page);
  await contentsOf(page).fill('Отправленный текст');
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await page.clock.install();
  state.key = 'version-two';
  state.handler = async (route) => {
    if (state.calls === 2) return route.fulfill({ status: 503, json: { detail: 'Временно недоступно' } });
    if (state.calls === 3) return route.fulfill({ json: configFor('version-one') });
    return route.fulfill({ json: configFor(state.key) });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect.poll(() => state.calls).toBe(2);
  await expect(page.getByText(/Повторим автоматически/)).toBeVisible();
  await page.clock.runFor(6000);
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-two');
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(contentsOf(page)).toHaveText('Отправленный текст');
  await expect(page.getByText('Загружаем документ', { exact: true })).toHaveCount(0);
  expect(state.calls).toBe(4);
});

test('a requested refresh waits for unsent changes instead of discarding them', async ({ page }) => {
  const state = await openEditor(page);
  await contentsOf(page).fill('Правки нельзя потерять');
  state.key = 'version-two';
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect(page.getByText(/Есть неотправленные изменения/)).toBeVisible();
  expect(state.calls).toBe(1);
  await expect(contentsOf(page)).toHaveText('Правки нельзя потерять');
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-two');
  await expect(contentsOf(page)).toHaveText('Правки нельзя потерять');
});

test('access revoked in HUB stops automatic recovery and makes the existing document read-only', async ({ page }) => {
  const state = await openEditor(page);
  await page.clock.install();
  state.status = 403;
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect(page.getByText(/Доступ к документу изменён/)).toBeVisible();
  await expect(contentsOf(page)).toHaveAttribute('contenteditable', 'false');
  await page.clock.runFor(60000);
  expect(state.calls).toBe(2);
});

for (const nextKey of ['version-one', 'version-two']) {
test(`a downgrade to viewing is applied safely with key ${nextKey}`, async ({ page }) => {
  const state = await openEditor(page);
  await page.clock.install();
  state.handler = (route) => {
    const response = configFor(nextKey);
    response.role = 'view';
    response.config.editorConfig.mode = 'view';
    response.config.document.permissions = { edit: false, comment: false };
    return route.fulfill({ json: response });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect(page.getByText(/Права редактирования изменились/)).toBeVisible();
  await expect(contentsOf(page)).toHaveAttribute('contenteditable', 'false');
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-one');
  await page.clock.runFor(60000);
  expect(state.calls).toBe(2);
});
}

test('an incomplete refreshed config stops recovery without replacing the document', async ({ page }) => {
  const state = await openEditor(page);
  await page.clock.install();
  state.handler = (route) => {
    const response = configFor('version-two');
    delete response.config.token;
    return route.fulfill({ json: response });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect(page.getByText(/HUB не передал полную конфигурацию/)).toBeVisible();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-one');
  await page.clock.runFor(60000);
  expect(state.calls).toBe(2);
});

test('a late refresh from the previous account cannot replace the next account document', async ({ page }) => {
  const state = await openEditor(page);
  let release;
  state.handler = async (route) => {
    if (state.calls === 2) {
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ json: configFor('previous-account-version', 1) }).catch(() => {});
      return;
    }
    return route.fulfill({ json: configFor('account-two-version', 2) });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect.poll(() => state.calls).toBe(2);
  await page.getByRole('button', { name: 'Сменить пользователя' }).click();
  await expect(frameOf(page).getByLabel('Пользователь документа')).toHaveText('2');
  release();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('account-two-version');
});

test('closing through HUB checks unsent edits in the editor before removing it', async ({ page }) => {
  await openEditor(page);
  await contentsOf(page).fill('Ещё не отправлено');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await expect(contentsOf(page)).toHaveText('Ещё не отправлено');
  await expect(page.getByText('Редактор закрыт', { exact: true })).toHaveCount(0);
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
  await expect(page.getByText('Редактор закрыт', { exact: true })).toBeVisible();
});

test('fatal editor errors do not silently reload or discard local text', async ({ page }) => {
  const state = await openEditor(page);
  await contentsOf(page).fill('Правки перед ошибкой');
  await frameOf(page).getByRole('button', { name: 'Ошибка редактора' }).click();
  await expect(page.getByText(/Не удалось продолжить работу/)).toBeVisible();
  await page.getByRole('button', { name: 'Переоткрыть документ' }).click();
  await expect(page.getByRole('dialog', { name: 'Переоткрыть документ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить работу' }).click();
  await expect(contentsOf(page)).toHaveText('Правки перед ошибкой');
  expect(state.calls).toBe(1);
});

test('an unavailable HUB retries before opening exactly one working document', async ({ page }) => {
  const state = {
    handler: (route, current) => current.calls === 1
      ? route.fulfill({ status: 503, json: { detail: 'Временно недоступно' } })
      : route.fulfill({ json: configFor('version-one') }),
  };
  await openEditor(page, state);
  await contentsOf(page).fill('Документ открыт после повтора');
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', '1');
  expect(state.calls).toBe(2);
});

test('duplicate refresh requests and editing during a config request cannot discard new input', async ({ page }) => {
  const state = await openEditor(page);
  let release;
  state.handler = async (route) => {
    if (state.calls === 2) await new Promise((resolve) => { release = resolve; });
    return route.fulfill({ json: configFor('version-two') });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect.poll(() => state.calls).toBe(2);
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await contentsOf(page).fill('Новая правка во время запроса');
  release();
  await expect(page.getByText(/Есть неотправленные изменения/)).toBeVisible();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-one');
  expect(state.calls).toBe(2);
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-two');
  await expect(contentsOf(page)).toHaveText('Новая правка во время запроса');
});

test('the browser warns before leaving a page with unsent document changes', async ({ page }) => {
  await openEditor(page);
  await contentsOf(page).fill('Не уходить без предупреждения');
  await contentsOf(page).click();
  const prompt = page.waitForEvent('dialog');
  const navigation = page.goto('about:blank').catch(() => {});
  const dialog = await prompt;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await navigation;
  await expect(contentsOf(page)).toHaveText('Не уходить без предупреждения');
});

test('an initial config belonging to another account is never opened', async ({ page }) => {
  const state = await openEditor(page, { user: 2 }, false);
  await expect(page.getByText(/Учётная запись изменилась/)).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(state.calls).toBe(1);
});

test('a fatal SDK error fences an already pending version refresh', async ({ page }) => {
  const state = await openEditor(page);
  let release;
  state.handler = async (route) => {
    await new Promise((resolve) => { release = resolve; });
    return route.fulfill({ json: configFor('version-two') });
  };
  await frameOf(page).getByRole('button', { name: 'Запросить новую версию' }).click();
  await expect.poll(() => state.calls).toBe(2);
  await frameOf(page).getByRole('button', { name: 'Ошибка редактора' }).click();
  await expect(page.getByText(/Не удалось продолжить работу/)).toBeVisible();
  release();
  await expect(frameOf(page).getByLabel('Ключ документа')).toHaveText('version-one');
  await expect(page.getByText(/Не удалось продолжить работу/)).toBeVisible();
});

test('Escape in the fallback dialog also asks the editor before dropping unsent changes', async ({ page }) => {
  await openEditor(page, { dialog: true });
  await contentsOf(page).fill('Правки внутри диалога');
  await page.getByText('План.docx', { exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(contentsOf(page)).toHaveText('Правки внутри диалога');
  await frameOf(page).getByRole('button', { name: 'Отправить правки' }).click();
  await page.getByText('План.docx', { exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Редактор закрыт', { exact: true })).toBeVisible();
});
