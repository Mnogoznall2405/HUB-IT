import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = '/e2e/fixtures/my-files-admin-harness.html';
const sdkPath = fileURLToPath(new URL('./fixtures/my-files-office-sdk.fixture.js', import.meta.url));
const file = (id, name, extra = {}) => ({ id, original_file_name: name, original_size_bytes: 1024, status: 'ready',
  security_scan_status: 'clean', owner_user_id: 42, owner_label: 'Анна', uploaded_by_user_id: 42,
  uploaded_by_username: 'anna', expires_at: '2099-01-01T00:00:00Z', can_open: true,
  can_manage_access: true, can_restore: false, deleted_at: null, ...extra });

async function setup(page, state = {}, query = '') {
  state.rows ||= [file('personal', 'План.docx'), file('library', 'Бюджет.xlsx', { owner_user_id: -1, owner_label: 'Финансы', library_id: 'lib', library_name: 'Финансы' })];
  state.calls = [];
  state.members ||= [{ user_id: 43, username: 'boris', full_name: 'Борис', role: 'edit' }];
  await page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copied.push(value); } } });
  });
  await page.route('**/e2e/fixtures/office-sdk/web-apps/apps/api/documents/api.js', route => route.fulfill({ path: sdkPath, contentType: 'text/javascript' }));
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\/api\//, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api(?:\/v1)?/, '');
    state.calls.push({ path, method: request.method(), query: Object.fromEntries(url.searchParams), body: request.postData() ? request.postDataJSON() : null });
    if (path === '/my-files/admin/user-stats') return route.fulfill({ json: { items: [{ user_id: 42, username: 'anna', full_name: 'Анна', files_count: 2 }], total: 1, totals: { files_count: 2 } } });
    if (path === '/my-files/office/status') return route.fulfill({ json: { enabled: true } });
    if (path === '/my-files/office/groups') return route.fulfill({ json: { items: [] } });
    if (path === '/my-files/admin/files') {
      if (state.list) return state.list(route, url);
      let items = state.rows.filter(row => url.searchParams.get('state') === 'all' || (url.searchParams.get('state') === 'trash' ? row.deleted_at : !row.deleted_at));
      if (url.searchParams.has('owner_user_id')) items = items.filter(row => String(row.owner_user_id) === url.searchParams.get('owner_user_id'));
      if (url.searchParams.get('scope') === 'library') items = items.filter(row => row.library_id);
      if (url.searchParams.get('scope') === 'personal') items = items.filter(row => !row.library_id);
      if (url.searchParams.get('q')) items = items.filter(row => row.original_file_name.toLowerCase().includes(url.searchParams.get('q').toLowerCase()));
      return route.fulfill({ json: { items: items.slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit'))), total: items.length } });
    }
    const id = path.split('/')[2];
    const row = state.rows.find(item => item.id === id);
    if (path.startsWith('/my-files/admin/files/')) return route.fulfill({ json: state.rows.find(item => item.id === path.split('/').pop()) });
    if (path.endsWith('/office/config')) return route.fulfill({ json: { role: 'owner', can_rename: true, can_manage_access: true,
      public_path: '/e2e/fixtures/office-sdk', config: { documentType: 'word', document: { key: 'admin-key', fileType: 'docx', title: row.original_file_name, url: '/fixture.docx', permissions: { edit: true } }, editorConfig: { user: { id: '1' }, mode: 'edit' }, token: 'fixture' } } });
    if (path.endsWith('/office/collaborators')) {
      if (request.method() === 'PUT') state.members = request.postDataJSON().members;
      return route.fulfill({ json: { items: state.members, owner: { user_id: 42, username: 'anna', full_name: 'Анна' }, owner_kind: row.library_id ? 'author' : 'owner', inherited_access: Boolean(row.library_id), library_name: row.library_name || '' } });
    }
    if (path.endsWith('/office/rename')) { row.original_file_name = `${request.postDataJSON().name}.docx`; return route.fulfill({ json: { file: row, editor_notified: true } }); }
    if (path.endsWith('/restore')) { const restored = state.rows.find(item => item.id === path.split('/').at(-2)); restored.deleted_at = null; restored.can_restore = false; restored.can_open = true; return route.fulfill({ status: 204 }); }
    if (request.method() === 'DELETE' && row) { row.deleted_at = new Date().toISOString(); row.can_restore = true; row.can_open = false; row.can_manage_access = false; return route.fulfill({ status: 204 }); }
    if (path.endsWith('/share')) {
      if (state.share) return state.share(route);
      row.is_shared = true; return route.fulfill({ json: { token: 'local-share', expires_at: row.expires_at } });
    }
    if (path.endsWith('/download-grant')) return state.download ? state.download(route) : route.fulfill({ json: { download_path: '/my-files/download-grants/local' } });
    if (path.endsWith('/audit')) return route.fulfill({ json: { items: [{ id: 1, action: 'office_collaborators_updated', actor_username: 'admin-one', details: 'Добавлен Борис', created_at: '2026-11-05T00:00:00Z' }], total: 1 } });
    return route.fulfill({ status: 500, json: { detail: `Unmocked local route: ${path}` } });
  });
  await page.goto(fixture + query);
  return state;
}
const openFiles = async page => { await page.getByRole('tab', { name: 'Все файлы', exact: true }).click(); await expect(page.getByRole('table', { name: 'Все файлы пользователей' })).toBeVisible(); };
const actions = async (page, name) => { await page.getByRole('button', { name: `Действия: ${name}`, exact: true }).click(); };

test('an administrator filters all files and opens the selected user from statistics', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Открыть файлы', exact: true }).click();
  await expect(page.getByRole('button', { name: 'План.docx', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Бюджет.xlsx', exact: true })).toHaveCount(0);
  expect(state.calls.find(call => call.path === '/my-files/admin/files').query.owner_user_id).toBe('42');
  await page.getByRole('button', { name: 'Показать файлы всех пользователей' }).click();
  await expect(page.getByRole('button', { name: 'Бюджет.xlsx', exact: true })).toBeVisible();
  await page.getByLabel('Хранилище').click(); await page.getByRole('option', { name: 'Общие папки', exact: true }).click();
  await expect(page.getByRole('button', { name: 'План.docx', exact: true })).toHaveCount(0);
  await page.getByLabel('Поиск по файлу, пользователю или папке').fill('нет файла');
  await expect(page.getByText('Файлы по выбранным условиям не найдены.')).toBeVisible();
});

test('statistics permission alone exposes no cross-user file operations', async ({ page }) => {
  const state = await setup(page, {}, '?viewer=1');
  await expect(page.getByText('anna', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Все файлы' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Открыть файлы' })).toHaveCount(0);
  expect(state.calls.filter(call => call.path === '/my-files/admin/files')).toHaveLength(0);
});

test('admin access settings identify the real author and preserve inherited access explanation', async ({ page }) => {
  const state = await setup(page); await openFiles(page); await actions(page, 'Бюджет.xlsx');
  await page.getByRole('menuitem', { name: 'Совместный доступ', exact: true }).click();
  await expect(page.getByText('Анна (anna)', { exact: true })).toBeVisible();
  await expect(page.getByText('Автор файла', { exact: true })).toBeVisible();
  await expect(page.getByText(/Удаление приглашения не отменяет доступ через папку/)).toBeVisible();
  await page.getByLabel('Роль: Борис (boris)').click(); await page.getByRole('option', { name: /Просмотр/ }).click();
  const listsBefore = state.calls.filter(call => call.path === '/my-files/admin/files').length;
  await page.getByTestId('my-files-collaborators-save').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => state.calls.filter(call => call.path === '/my-files/admin/files/library').length).toBe(1);
  expect(state.calls.find(call => call.method === 'PUT').body.members).toEqual([{ user_id: 43, role: 'view' }]);
  expect(state.calls.filter(call => call.path === '/my-files/admin/files')).toHaveLength(listsBefore);
});

test('rename, trash and restore update the selected row and preserve the owner', async ({ page }) => {
  const state = await setup(page); await openFiles(page); await actions(page, 'План.docx');
  await page.getByRole('menuitem', { name: 'Переименовать', exact: true }).click();
  await page.getByLabel('Имя файла', { exact: true }).fill('Итог'); await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: 'Итог.docx', exact: true })).toBeVisible();
  await actions(page, 'Итог.docx'); await page.getByRole('menuitem', { name: /Удалить/ }).click();
  await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: 'Итог.docx', exact: true })).toHaveCount(0);
  await page.getByLabel('Состояние', { exact: true }).click(); await page.getByRole('option', { name: 'В корзине', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить Итог.docx' }).click(); await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: 'Восстановить Итог.docx' })).toHaveCount(0);
  expect(state.rows[0].owner_user_id).toBe(42);
  expect(state.calls.filter(call => call.path === '/my-files/admin/files')).toHaveLength(2);
});

test('blocked content stays unavailable while metadata and audit remain visible', async ({ page }) => {
  await setup(page, { rows: [file('blocked', 'Проверка.docx', { can_open: false, can_manage_access: false, security_scan_status: 'infected' })] });
  await openFiles(page); await expect(page.getByRole('button', { name: 'Проверка.docx', exact: true })).toBeDisabled();
  await actions(page, 'Проверка.docx');
  for (const name of ['Скачать', 'Совместный доступ', 'Редактировать онлайн', 'Переименовать']) await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: /Журнал/ }).click();
  await expect(page.getByText('Добавлен Борис', { exact: true })).toBeVisible();
});

test('list failures are errors and can be retried without showing stale content', async ({ page }) => {
  let broken = true;
  await setup(page, { list: route => broken ? route.fulfill({ status: 503, json: { detail: 'Хранилище недоступно' } }) : route.fulfill({ json: { items: [file('ok', 'После повтора.docx')], total: 1 } }) });
  await page.getByRole('tab', { name: 'Все файлы' }).click();
  await expect(page.getByText('Хранилище недоступно', { exact: true })).toBeVisible();
  await expect(page.getByText('Файлы по выбранным условиям не найдены.')).toHaveCount(0);
  broken = false; await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'После повтора.docx', exact: true })).toBeVisible();
});

test('a delayed previous query cannot replace the current results', async ({ page }) => {
  let release;
  const state = await setup(page, { list: async (route, url) => {
    const old = url.searchParams.get('q') === 'старый';
    if (old) await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { items: [file(old ? 'old' : 'new', old ? 'Старый ответ.docx' : 'Новый ответ.docx')], total: 1 } });
  } }); await openFiles(page);
  await page.getByLabel('Поиск по файлу, пользователю или папке').fill('старый');
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByLabel('Поиск по файлу, пользователю или папке').fill('новый');
  await expect.poll(() => state.calls.filter(call => call.query.q === 'новый').length).toBe(1);
  release(); await expect(page.getByRole('button', { name: 'Новый ответ.docx', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Старый ответ.docx', exact: true })).toHaveCount(0);
});

for (const operation of ['share', 'download']) test(`a pending ${operation} cannot deliver a private link after account change`, async ({ page }) => {
  let release;
  const state = await setup(page, { [operation]: async route => {
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: operation === 'share' ? { token: 'old-account-secret' } : { download_path: '/my-files/download-grants/old-account-secret' } });
  } }); await openFiles(page); await actions(page, 'План.docx');
  await page.getByRole('menuitem', { name: operation === 'share' ? /Поделиться/ : 'Скачать', exact: operation !== 'share' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.getByRole('button', { name: 'Сменить администратора' }).click();
  release();
  await expect.poll(() => state.calls.filter(call => call.path === '/my-files/admin/files').length).toBe(2);
  await expect(page.getByRole('button', { name: 'План.docx', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__copied)).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.calls.filter(call => call.path.includes('/download-grants/'))).toHaveLength(0);
});

test('mobile admin controls remain within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await openFiles(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('files-admin-mobile.png'), animations: 'disabled' });
});

test('pagination preserves the file filter and opens the next page', async ({ page }) => {
  const state = await setup(page, { rows: Array.from({ length: 27 }, (_, index) => file(`file-${index}`, `Отчёт ${index}.docx`)) });
  await openFiles(page);
  await expect(page.getByRole('button', { name: 'Отчёт 0.docx', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /next page/i }).click();
  await expect(page.getByRole('button', { name: 'Отчёт 25.docx', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отчёт 0.docx', exact: true })).toHaveCount(0);
  expect(state.calls.filter(call => call.path === '/my-files/admin/files').at(-1).query.offset).toBe('25');
});

test('the administrator opens another users editor and access settings without replacing its frame', async ({ page }) => {
  await setup(page); await openFiles(page);
  await page.getByRole('button', { name: 'План.docx', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Документ для проверки восстановления"]');
  await frame.getByRole('textbox', { name: 'Содержимое документа' }).fill('Правки администратора');
  const instance = await page.locator('iframe').getAttribute('data-editor-instance');
  await page.getByRole('button', { name: 'Совместный доступ', exact: true }).click();
  await expect(page.getByText('Анна (anna)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Содержимое документа' })).toHaveText('Правки администратора');
  await expect(page.locator('iframe')).toHaveAttribute('data-editor-instance', instance);
});

test('renaming a search result removes it when the new name no longer matches', async ({ page }) => {
  await setup(page); await openFiles(page);
  await page.getByLabel('Поиск по файлу, пользователю или папке').fill('План');
  await expect(page.getByRole('button', { name: 'Бюджет.xlsx', exact: true })).toHaveCount(0);
  await actions(page, 'План.docx'); await page.getByRole('menuitem', { name: 'Переименовать', exact: true }).click();
  await page.getByLabel('Имя файла', { exact: true }).fill('Итог'); await page.getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByText('Файлы по выбранным условиям не найдены.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Итог.docx', exact: true })).toHaveCount(0);
});
