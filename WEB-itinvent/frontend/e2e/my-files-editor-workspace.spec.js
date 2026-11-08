import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

const sdk = fileURLToPath(new URL('./fixtures/my-files-office-sdk.fixture.js', import.meta.url));
const frame = (page, id) => page.locator(`#document-panel-${id}`).frameLocator('[data-testid="my-files-office-editor"] iframe');
const text = (page, id) => frame(page, id).getByRole('textbox', { name: 'Содержимое документа' });

async function setup(page, state = {}) {
  state.configs = [];
  await page.route('**/e2e/fixtures/office-sdk/web-apps/apps/api/documents/api.js', route => route.fulfill({ path: sdk, contentType: 'text/javascript' }));
  await page.route(/\/api\/v1\/my-files\/file-[abc]\/office\/config$/, async route => {
    const id = route.request().url().match(/(file-[abc])/)[1];
    state.configs.push(id);
    const config = { role: 'owner', can_rename: true, can_manage_access: true, can_view_history: true, public_path: '/e2e/fixtures/office-sdk', config: {
      documentType: 'word', document: { key: `${id}-key`, fileType: 'docx', title: `${id}.docx`, url: '/saved.docx', permissions: { edit: true } },
      editorConfig: { mode: 'edit', user: { id: String(state.user || 1) }, customization: { close: { visible: true } } }, token: 'fixture-token',
    } };
    if (state.config) return state.config(route, config, id);
    return route.fulfill({ json: config });
  });
  await page.goto('/e2e/fixtures/my-files-workspace-harness.html' + (state.single ? '?single=1' : ''));
  if (state.single) await expect(page.frameLocator('iframe').getByRole('textbox', { name: 'Содержимое документа' })).toBeVisible();
  else await expect(text(page, 'file-a')).toBeVisible();
  return state;
}

test('several documents stay in one workspace and switching tabs keeps the same unsent editor', async ({ page }, testInfo) => {
  const state = await setup(page);
  await text(page, 'file-a').fill('Неотправленный текст A');
  const instance = await page.locator('#document-panel-file-a iframe').getAttribute('data-editor-instance');
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('#document-panel-file-a')).toHaveAttribute('inert', '');
  await expect(page.locator('#document-panel-file-a iframe')).toBeHidden();
  await page.getByRole('tab', { name: /file-a.docx/ }).click();
  await expect(text(page, 'file-a')).toHaveText('Неотправленный текст A');
  await expect(page.locator('#document-panel-file-a iframe')).toHaveAttribute('data-editor-instance', instance);
  await expect(page).toHaveTitle('file-a.docx');
  expect(state.configs).toEqual(['file-a', 'file-b']);
  await page.screenshot({ path: testInfo.outputPath('document-tabs.png'), animations: 'disabled' });
});

test('opening an existing document activates it without another frame or config request', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть A', exact: true }).click();
  await expect(text(page, 'file-a')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть A', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('iframe')).toHaveCount(2);
  expect(state.configs).toEqual(['file-a', 'file-b']);
});

test('the visible history button opens the selected document and keeps both live editors', async ({ page }) => {
  const calls = [];
  await page.route(/\/api\/v1\/my-files\/file-[abc]\/office\/history(?:\/.*)?$/, route => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path.endsWith('/config')) return route.fulfill({ json: { public_path: '/e2e/fixtures/office-sdk', config: {
      documentType: 'word', document: { key: 'history-b', fileType: 'docx', title: 'file-b.docx', url: '/saved.docx', permissions: { edit: false } },
      editorConfig: { mode: 'view', user: { id: '1' }, customization: { close: { visible: true } } }, token: 'fixture-history',
    } } });
    if (path.endsWith('/history')) return route.fulfill({ json: { currentVersion: 2, history: [
      { version: 2, key: 'b-v2', created: '2026-11-06 10:00:00', user: { id: '2', name: 'Борис' }, serverVersion: '10.0.0', changes: [{ user: { id: '2', name: 'Борис' } }] },
    ] } });
    return route.fulfill({ json: { data: { version: 2, key: 'b-v2', url: '/saved.docx', token: 'fixture-history', changesUrl: '/changes.zip' }, changes_available: true } });
  });
  await setup(page);
  await text(page, 'file-a').fill('Неотправленные правки A');
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await text(page, 'file-b').fill('Неотправленные правки B');
  const instance = await page.locator('#document-panel-file-b iframe').getAttribute('data-editor-instance');
  await page.getByRole('button', { name: 'История изменений документа', exact: true }).click();
  const history = page.locator('#document-panel-file-b').getByTestId('my-files-native-history').frameLocator('iframe');
  await history.getByRole('button', { name: 'Версия 2 · Борис' }).click();
  await expect(history.getByLabel('Показанная версия')).toHaveText('2');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(calls.length).toBeGreaterThanOrEqual(3);
  expect(calls.every(path => path.includes('/file-b/'))).toBe(true);
  await history.getByRole('button', { name: 'Вернуться из истории' }).click();
  await expect(text(page, 'file-b')).toHaveText('Неотправленные правки B');
  await expect(page.locator('#document-panel-file-b iframe')).toHaveAttribute('data-editor-instance', instance);
  await page.getByRole('tab', { name: /file-a.docx/ }).click();
  await expect(text(page, 'file-a')).toHaveText('Неотправленные правки A');
});

test('closing an inactive dirty tab shows its editor confirmation and preserves other documents', async ({ page }) => {
  await setup(page);
  await text(page, 'file-a').fill('Не закрывать A без подтверждения');
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Закрыть документ «file-a.docx»' }).click();
  await expect(text(page, 'file-a')).toHaveText('Не закрывать A без подтверждения');
  await expect(page.getByRole('tab')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Закрыть документ «file-a.docx»' }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(text(page, 'file-b')).toBeVisible();
  await frame(page, 'file-b').getByRole('button', { name: 'Закрыть из редактора' }).click();
  await expect(page.getByText('Все документы закрыты', { exact: true })).toBeVisible();
});

test('a hidden document still protects the whole workspace from an unsaved page close', async ({ page }) => {
  await setup(page);
  await text(page, 'file-a').fill('Правки в фоне');
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  const allowed = await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  expect(allowed).toBe(false);
  await page.evaluate(() => { window.__unloadCount = 0; window.addEventListener('beforeunload', () => { window.__unloadCount++; }); });
  const nativeAllowed = await page.evaluate(() => window.dispatchEvent(new Event('hub:before-close', { cancelable: true })));
  expect(nativeAllowed).toBe(false);
  expect(await page.evaluate(() => window.__unloadCount)).toBe(0);
  await page.getByRole('tab', { name: /file-a.docx/ }).click();
  await frame(page, 'file-a').getByRole('button', { name: 'Отправить правки' }).click();
  await expect.poll(() => page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  expect(await page.evaluate(() => window.dispatchEvent(new Event('hub:before-close', { cancelable: true })))).toBe(true);
});

test('a rename error arriving in a background document never covers the active document', async ({ page }) => {
  let release;
  await page.route('**/api/v1/my-files/file-a/office/rename', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({ status: 400, json: { detail: 'Не удалось изменить имя A' } });
  });
  await setup(page);
  await frame(page, 'file-a').getByLabel('Новое имя в редакторе').fill('Новое имя A');
  await frame(page, 'file-a').getByRole('button', { name: 'Применить имя в редакторе' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('tab', { name: /file-a.docx/ }).click();
  await expect(page.getByRole('alert')).toHaveText('Не удалось изменить имя A');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('closing a document from its history checks its unsent live edits', async ({ page }) => {
  await page.route('**/api/v1/my-files/file-a/office/history/config', route => route.fulfill({ status: 503, json: { detail: 'История временно недоступна' } }));
  await setup(page);
  await text(page, 'file-a').fill('Сначала проверить эти правки');
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await page.getByRole('tab', { name: /file-a.docx/ }).click();
  await page.getByRole('button', { name: 'История изменений документа' }).click();
  await expect(page.getByRole('region', { name: /История изменений/ })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Закрыть документ «file-a.docx»' }).click();
  await expect(text(page, 'file-a')).toHaveText('Сначала проверить эти правки');
  await expect(page.getByRole('tab')).toHaveCount(2);
});

test('an account switch removes every old editor and starts only the requested file for the new account', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  state.user = 2;
  await page.getByRole('button', { name: 'Сменить аккаунт', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(frame(page, 'file-b').getByLabel('Пользователь документа')).toHaveText('2');
});

test('the document tabs support keyboard switching and deletion', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await page.getByRole('tab', { name: /file-a.docx/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /file-b.docx/ })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(text(page, 'file-a')).toBeVisible();
});

test('many document names fit a narrow window without page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
  await expect(text(page, 'file-b')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть C', exact: true }).click();
  await expect(text(page, 'file-c')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'История изменений документа' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('document-tabs-mobile.png'), animations: 'disabled' });
});

test('switching open tabs removes repeated config requests and editor starts', async ({ page }, testInfo) => {
  const results = {};
  for (const single of [true, false]) {
    const state = await setup(page, { single });
    await page.getByRole('button', { name: 'Открыть B', exact: true }).click();
    await expect(page.frameLocator(single ? 'iframe' : '#document-panel-file-b iframe').getByLabel('Ключ документа')).toHaveText('file-b-key');
    const requestsBefore = state.configs.length;
    const loadsBefore = await page.evaluate(() => performance.getEntriesByName('hub.office.total').length);
    const times = [];
    for (let index = 0; index < 20; index++) {
      const id = index % 2 ? 'file-b' : 'file-a';
      const started = Date.now();
      await page.getByRole('button', { name: index % 2 ? 'Открыть B' : 'Открыть A', exact: true }).click();
      await expect(page.frameLocator(single ? 'iframe' : `#document-panel-${id} iframe`).getByLabel('Ключ документа')).toHaveText(`${id}-key`);
      times.push(Date.now() - started);
    }
    const loadsAfter = await page.evaluate(() => performance.getEntriesByName('hub.office.total').length);
    const sorted = [...times].sort((a, b) => a - b);
    results[single ? 'before' : 'after'] = { switches: 20, config_requests: state.configs.length - requestsBefore,
      editor_starts: loadsAfter - loadsBefore, p50_ms: sorted[9], p95_ms: sorted[18], p99_ms: sorted[19] };
  }
  expect(results.before.config_requests).toBe(20);
  expect(results.before.editor_starts).toBe(20);
  expect(results.after.config_requests).toBe(0);
  expect(results.after.editor_starts).toBe(0);
  const path = testInfo.outputPath('tab-switch-benchmark.json');
  await writeFile(path, JSON.stringify({ ...results,
    notes: 'Local real UI with a fixture SDK, 20 identical route switches. Not Document Server conversion or production first-open latency.' }, null, 2));
  await testInfo.attach('tab-switch-benchmark', { path, contentType: 'application/json' });
});
