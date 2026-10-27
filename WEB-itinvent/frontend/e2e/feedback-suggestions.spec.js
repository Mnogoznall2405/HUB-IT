import { test, expect } from '@playwright/test';

// «Предложить улучшение HUB» на главной: отправка формы, список «Мои предложения» и лимит сервера.
// Админский раздел «Предложения» в «Настройках»: смена статуса. Все API-ответы — изолированные фикстуры.
test.skip(process.env.E2E_LOCAL !== '1', 'Feedback suggestions run against isolated API fixtures (E2E_LOCAL=1)');
test.use({ serviceWorkers: 'block' });

const user = { id: 11, username: 'feedback-e2e', full_name: 'Фидбек Тестов', role: 'operator', is_active: true, permissions: ['dashboard.read'] };
const adminUser = { id: 1, username: 'feedback-admin', full_name: 'Админ Фидбека', role: 'admin', is_active: true, permissions: [] };

const emptyDashboard = {
  announcements: { items: [], total: 0 },
  my_tasks: { items: [], total: 0 },
  unread_counts: {},
  summary: {},
  absences_today: { count: 0, items: [] },
};

async function prepare(page, identity, { postError = null } = {}) {
  const ctrl = { items: [], posted: [], patched: [], postError, adminItems: [] };
  await page.addInitScript((value) => {
    localStorage.setItem('user', JSON.stringify(value));
    localStorage.setItem('hubit:desktop-handoff', 'never');
  }, identity);
  // Ни один запрос не уходит за пределы локального стека.
  await page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.fallback() : route.abort()));
  await page.route('**/api/v1/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/auth/me*', (route) => route.fulfill({ json: identity }));
  await page.route('**/api/v1/hub/dashboard*', (route) => route.fulfill({ json: emptyDashboard }));
  // Более поздние правила перекрывают ранние: списки и действия регистрируются последними.
  await page.route('**/api/v1/feedback/mine*', (route) => route.fulfill({
    json: { items: [...ctrl.items].reverse(), total: ctrl.items.length },
  }));
  await page.route(/\/api\/v1\/feedback\/\d+(\?.*)?$/, async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const body = route.request().postDataJSON();
    ctrl.patched.push({ id, ...body });
    const current = ctrl.adminItems.find((item) => item.id === id);
    const updated = { ...current, ...body, updated_at: '2026-10-27T10:00:00+03:00' };
    ctrl.adminItems = ctrl.adminItems.map((item) => (item.id === id ? updated : item));
    await route.fulfill({ json: updated });
  });
  await page.route(/\/api\/v1\/feedback(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      ctrl.posted.push(body);
      if (ctrl.postError) {
        await route.fulfill({ status: ctrl.postError.status, json: { detail: ctrl.postError.detail } });
        return;
      }
      const item = {
        id: ctrl.items.length + 1,
        category: body.category,
        title: body.title,
        message: body.message,
        section: body.section || null,
        status: 'new',
        admin_note: null,
        created_at: '2026-10-27T09:30:00+03:00',
        updated_at: '2026-10-27T09:30:00+03:00',
      };
      ctrl.items.push(item);
      await route.fulfill({ status: 201, json: item });
      return;
    }
    const counts = { new: 0, in_progress: 0, accepted: 0, declined: 0, done: 0 };
    ctrl.adminItems.forEach((item) => { counts[item.status] += 1; });
    const requestedStatus = new URL(request.url()).searchParams.get('status');
    const items = ctrl.adminItems.filter((item) => !requestedStatus || item.status === requestedStatus);
    await route.fulfill({ json: { items, total: items.length, counts } });
  });
  return ctrl;
}

async function openSuggestionDialog(page) {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Предложить улучшение HUB', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Что улучшить в HUB?' })).toBeVisible();
  return dialog;
}

async function fillSuggestion(dialog, { title, message }) {
  await dialog.getByLabel('Заголовок').fill(title);
  await dialog.getByLabel('Описание').fill(message);
}

test('suggestion sent from the dashboard shows up as «Новое» in «Мои предложения»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ctrl = await prepare(page, user);
  const dialog = await openSuggestionDialog(page);

  await fillSuggestion(dialog, {
    title: 'Тёмная тема для таблиц',
    message: 'Хочу, чтобы таблицы в тёмной теме были читаемее.',
  });
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();

  await expect(dialog.getByTestId('feedback-success')).toBeVisible();
  expect(ctrl.posted).toEqual([{
    category: 'idea',
    title: 'Тёмная тема для таблиц',
    message: 'Хочу, чтобы таблицы в тёмной теме были читаемее.',
  }]);
  // Форма сброшена после отправки.
  await expect(dialog.getByLabel('Заголовок')).toHaveValue('');

  await dialog.getByRole('tab', { name: 'Мои предложения' }).click();
  const mine = dialog.getByTestId('feedback-mine-item').filter({ hasText: 'Тёмная тема для таблиц' });
  await expect(mine).toHaveCount(1);
  await expect(mine.getByTestId('feedback-status-chip')).toHaveText('Новое');
});

test('daily limit from the server is shown in the dialog and the draft is kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ctrl = await prepare(page, user, {
    postError: { status: 429, detail: 'Лимит: не более 5 предложений в сутки.' },
  });
  const dialog = await openSuggestionDialog(page);
  await fillSuggestion(dialog, {
    title: 'Быстрый поиск по задачам',
    message: 'Добавить поиск по всем задачам сразу, без выбора отдела.',
  });
  await dialog.getByRole('button', { name: 'Отправить', exact: true }).click();

  await expect(dialog.getByText('Лимит: не более 5 предложений в сутки.', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('feedback-success')).toHaveCount(0);
  await expect(dialog.getByLabel('Заголовок')).toHaveValue('Быстрый поиск по задачам');
  await expect(dialog.getByRole('button', { name: 'Отправить', exact: true })).toBeEnabled();
  expect(ctrl.posted).toHaveLength(1);
});

test('admin changes the status of a suggestion in «Настройки → Администрирование → Предложения по HUB»', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const ctrl = await prepare(page, adminUser);
  ctrl.adminItems = [{
    id: 1,
    category: 'idea',
    title: 'Быстрый поиск по задачам',
    message: 'Добавить поиск по всем задачам сразу.',
    section: 'Задачи',
    status: 'new',
    admin_note: null,
    created_at: '2026-10-26T09:00:00+03:00',
    updated_at: '2026-10-26T09:00:00+03:00',
    author: { id: 5, username: 'ivanov', full_name: 'Иван Иванов' },
  }];

  await page.goto('/admin/feedback');
  const card = page.getByTestId('feedback-admin-item-1');
  await expect(card.getByText('Быстрый поиск по задачам', { exact: true })).toBeVisible();

  await card.getByLabel('Статус').click();
  await page.getByRole('option', { name: 'В работе', exact: true }).click();
  await card.getByRole('button', { name: 'Сохранить', exact: true }).click();

  await expect(card.getByTestId('feedback-status-chip')).toHaveText('В работе');
  // Отправлено только изменённое поле.
  expect(ctrl.patched).toEqual([{ id: 1, status: 'in_progress' }]);
});
