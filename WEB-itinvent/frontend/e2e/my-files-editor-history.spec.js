import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = '/e2e/fixtures/my-files-editor-recovery-harness.html';
const sdkPath = fileURLToPath(new URL('./fixtures/my-files-office-sdk.fixture.js', import.meta.url));
const historyFrame = page => page.getByTestId('my-files-native-history').frameLocator('iframe');
const configFor = (state, viewer = false) => ({ can_view_history: true, role: 'owner', public_path: '/e2e/fixtures/office-sdk', config: {
  documentType: 'cell', document: { key: viewer ? 'history-key' : 'live-key', fileType: 'xlsx', title: 'Бюджет.xlsx', url: '/saved.xlsx', permissions: { edit: !viewer } },
  editorConfig: { mode: viewer ? 'view' : 'edit', user: { id: String(state.user || 1) }, customization: { close: { visible: true, text: viewer ? 'Вернуться к документу' : 'Закрыть документ' } } }, token: 'local-fixture',
} });

async function setup(page, state = {}) {
  state.calls = [];
  await page.route('**/e2e/fixtures/office-sdk/web-apps/apps/api/documents/api.js', route => route.fulfill({ path: sdkPath, contentType: 'text/javascript' }));
  await page.route('**/my-files/recovery-file/office/config', route => route.fulfill({ json: configFor(state) }));
  await page.route('**/my-files/recovery-file/office/history**', async route => {
    const path = new URL(route.request().url()).pathname;
    state.calls.push(path);
    if (path.endsWith('/config')) return state.config ? state.config(route) : route.fulfill({ json: configFor(state, true) });
    if (path.endsWith('/history')) {
      if (state.list) return state.list(route);
      return route.fulfill({ json: { currentVersion: 2, history: [
        { version: 1, key: 'v1', created: '2026-11-04 10:00:00', user: { id: '1', name: 'Анна' } },
        { version: 2, key: 'v2', created: '2026-11-05 10:00:00', user: { id: '1', name: 'Анна' }, serverVersion: '10.0.0', changes: [{ user: { id: '1', name: 'Анна' } }, { user: { id: '2', name: 'Борис' } }] },
      ] } });
    }
    const version = Number(path.split('/').pop());
    if (state.data) return state.data(route, version);
    return route.fulfill({ json: { data: { version, key: `v${version}`, url: `/saved-${version}.xlsx`, token: 'local-history-token', ...(version === 2 ? { changesUrl: '/changes.zip', previous: { key: 'v1', url: '/saved-1.xlsx' } } : {}) }, changes_available: version === 2 } });
  });
  await page.goto(fixture + (state.query || ''));
  await expect(page.locator('iframe')).toHaveCount(1);
  const live = page.frameLocator('iframe[title="Документ для проверки восстановления"]');
  await expect(live.getByRole('textbox', { name: 'Содержимое документа' })).toBeVisible();
  return { state, live };
}

async function openHistory(page) {
  await page.getByTestId('my-files-office-editor').frameLocator('iframe').getByRole('button', { name: 'История из меню редактора' }).click();
  await expect(historyFrame(page).getByRole('button', { name: 'Версия 2 · Анна', exact: true })).toBeVisible();
}

test('native history shows all authors and keeps unsent edits in the original live frame', async ({ page }, testInfo) => {
  const { live } = await setup(page);
  await live.getByRole('textbox', { name: 'Содержимое документа' }).fill('Несохранённая формула =SUM(A1:A3)');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await openHistory(page);
  await expect(historyFrame(page).getByLabel('Авторы правок')).toHaveText('Анна, Борис');
  await expect(page.getByTestId('my-files-live-surface')).toHaveAttribute('inert', '');
  await expect(page.getByTestId('my-files-live-surface')).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const editorArea = await page.locator('main').boundingBox();
  const historyArea = await page.getByTestId('my-files-native-history').boundingBox();
  expect(Math.abs(editorArea.height - historyArea.height)).toBeLessThan(2);
  await expect(historyFrame(page).getByRole('textbox')).toHaveAttribute('contenteditable', 'false');
  await historyFrame(page).getByRole('button', { name: 'Версия 2 · Анна' }).click();
  await expect(historyFrame(page).getByLabel('Показанная версия')).toHaveText('2');
  expect(await page.evaluate(() => window.__historyDataCalls[0].changesUrl)).toBe('/changes.zip');
  await page.screenshot({ path: testInfo.outputPath('native-history.png'), animations: 'disabled' });
  await historyFrame(page).getByRole('button', { name: 'Вернуться из истории' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(live.getByRole('textbox')).toHaveText('Несохранённая формула =SUM(A1:A3)');
  await expect(page.getByTestId('my-files-hub-toolbar')).toBeHidden();
  await expect(page.getByTestId('my-files-live-surface')).not.toHaveAttribute('inert', '');
});

test('an older version opens without a permanent informational banner', async ({ page }) => {
  await setup(page); await openHistory(page);
  await historyFrame(page).getByRole('button', { name: 'Версия 1 · Анна' }).click();
  await expect(historyFrame(page).getByLabel('Показанная версия')).toHaveText('1');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/История сохранённых версий|подробные данные правок не сохранены/)).toHaveCount(0);
  expect(await page.evaluate(() => 'changesUrl' in window.__historyDataCalls[0])).toBe(false);
});

test('a late selected version cannot replace the newer selection', async ({ page }) => {
  let release;
  await setup(page, { data: async (route, version) => {
    if (version === 2) await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { data: { version, key: `v${version}`, url: '/snapshot.xlsx', token: 'local-token' }, changes_available: false } });
  } }); await openHistory(page);
  await historyFrame(page).getByRole('button', { name: 'Версия 2 · Анна' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await historyFrame(page).getByRole('button', { name: 'Версия 1 · Анна' }).click();
  await expect(historyFrame(page).getByLabel('Показанная версия')).toHaveText('1');
  release();
  await expect.poll(() => page.evaluate(() => window.__historyDataCalls.map(data => data.version))).toEqual([1]);
});

test('history list failure can be retried while the working document remains intact', async ({ page }) => {
  let broken = true;
  const { live } = await setup(page, { list: route => broken ? route.fulfill({ status: 503, json: { detail: 'Не удалось прочитать историю' } })
    : route.fulfill({ json: { currentVersion: 1, history: [{ version: 1, key: 'v1', user: { id: '1', name: 'Анна' } }] } }) });
  await live.getByRole('textbox').fill('Не терять при ошибке');
  const original = await page.locator('iframe').getAttribute('data-editor-instance');
  await page.getByTestId('my-files-office-editor').frameLocator('iframe').getByRole('button', { name: 'История из меню редактора' }).click();
  await expect(page.getByText('Не удалось прочитать историю', { exact: true })).toBeVisible();
  broken = false; await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(historyFrame(page).getByRole('button', { name: 'Версия 1 · Анна' })).toBeVisible();
  await historyFrame(page).getByRole('button', { name: 'Вернуться из истории' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', original);
  await expect(live.getByRole('textbox')).toHaveText('Не терять при ошибке');
});

test('closing history before a pending config finishes does not create a late viewer', async ({ page }) => {
  let release;
  await setup(page, { config: async route => { await new Promise(resolve => { release = resolve; }); return route.fulfill({ json: configFor({}, true) }); } });
  await page.getByTestId('my-files-office-editor').frameLocator('iframe').getByRole('button', { name: 'История из меню редактора' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Вернуться к документу' }).click();
  release();
  await expect(page.getByTestId('my-files-native-history')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(1);
});

test('the SDK history menu and close event return to the same working document', async ({ page }) => {
  const { live } = await setup(page);
  await live.getByRole('textbox').fill('Текст до просмотра истории');
  await live.getByRole('button', { name: 'История из меню редактора' }).click();
  await expect(historyFrame(page).getByRole('button', { name: 'Версия 2 · Анна' })).toBeVisible();
  await historyFrame(page).getByRole('button', { name: 'Вернуться из истории' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(live.getByRole('textbox')).toHaveText('Текст до просмотра истории');
});

test('history data denied after revocation clears only the history viewer', async ({ page }) => {
  const { live } = await setup(page, { data: route => route.fulfill({ status: 404, json: { detail: 'Доступ отозван' } }) });
  await live.getByRole('textbox').fill('Скопировать доступный текст');
  await openHistory(page); await historyFrame(page).getByRole('button', { name: 'Версия 2 · Анна' }).click();
  await expect(page.getByText('Доступ отозван', { exact: true })).toBeVisible();
  await expect(page.getByTestId('my-files-native-history').locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Вернуться к документу' }).click();
  await expect(live.getByRole('textbox')).toHaveText('Скопировать доступный текст');
});

test('an account change drops a pending history config from the previous account', async ({ page }) => {
  let release;
  const { state } = await setup(page, { config: async route => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: configFor({ user: 1 }, true) });
  } });
  await page.getByTestId('my-files-office-editor').frameLocator('iframe').getByRole('button', { name: 'История из меню редактора' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  state.user = 2;
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === 'Сменить пользователя').click());
  release();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.frameLocator('iframe').getByLabel('Пользователь документа')).toHaveText('2');
  await expect(page.getByTestId('my-files-native-history')).toHaveCount(0);
});

test('malformed history is an error and does not replace it with a fabricated empty history', async ({ page }) => {
  await setup(page, { list: route => route.fulfill({ json: { currentVersion: 0, history: [] } }) });
  await page.getByTestId('my-files-office-editor').frameLocator('iframe').getByRole('button', { name: 'История из меню редактора' }).click();
  await expect(page.getByText('История временно недоступна. Повторите загрузку.', { exact: true })).toBeVisible();
  await expect(historyFrame(page).getByRole('button', { name: /Версия [12]/ })).toHaveCount(0);
});

test('history fits a narrow viewport and returns focus to the live editor', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page); await openHistory(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('native-history-mobile.png'), animations: 'disabled' });
  await historyFrame(page).getByRole('button', { name: 'Вернуться из истории' }).click();
  await expect(page.getByTestId('my-files-office-editor').locator('iframe')).toBeFocused();
});


test('the native close control in history returns to the live document without closing it', async ({ page }) => {
  const { live } = await setup(page);
  await live.getByRole('textbox').fill('Продолжаем после просмотра');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await openHistory(page);
  await historyFrame(page).getByRole('button', { name: 'Закрыть из редактора' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(live.getByRole('textbox')).toHaveText('Продолжаем после просмотра');
  await expect(page.getByText('Редактор закрыт', { exact: true })).toHaveCount(0);
});

test('Escape while loading history in the HUB dialog only closes history and preserves unsent edits', async ({ page }) => {
  let release;
  const { live } = await setup(page, { query: '?dialog', config: async route => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: configFor({}, true) });
  } });
  await live.getByRole('textbox').fill('Не закрывать рабочую вкладку');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await live.getByRole('button', { name: 'История из меню редактора' }).click();
  await expect(page.getByRole('button', { name: 'Вернуться к документу' })).toBeFocused();
  await page.keyboard.press('Escape');
  release();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(live.getByRole('textbox')).toHaveText('Не закрывать рабочую вкладку');
});
