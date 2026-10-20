import { test, expect } from '@playwright/test';

// Task create flow through the real UI: /tasks?create=1 opens the lazy-loaded
// dialog (the same path hubCommands uses), title + live assignee autocomplete +
// inline project creation satisfy the submit gate, and the task lands in the
// list. Writes data — runs on the local stack (E2E_LOCAL=1 auto-fills
// credentials) or anywhere when E2E_SEND=1 is set deliberately.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const CAN_WRITE = process.env.E2E_LOCAL === '1' || process.env.E2E_SEND === '1';

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(!CAN_WRITE, 'write flow — run with E2E_LOCAL=1 or E2E_SEND=1');
test.skip(process.env.E2E_LOCAL !== '1', 'seeded task flows require the isolated local stack');

async function login(page) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(USERNAME);
  await form.locator('input[name="password"]').fill(PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function createTask(page, { title, description = '', projectName, validate = false, dueTomorrow = false }) {
  const expectedAssigneeIds = [];
  for (const username of [USERNAME, USERNAME2]) {
    const response = await page.request.get('/api/v1/hub/users/assignees', { params: { q: username } });
    expect(response.status()).toBe(200);
    const directory = await response.json();
    const row = (directory.items || []).find((item) => String(item.username) === username);
    expect(row).toBeTruthy();
    expect(Number(row.id)).toBeGreaterThan(0);
    expectedAssigneeIds.push(String(row.id));
  }
  expectedAssigneeIds.sort();

  // ?create=1 is the deep link the command palette and dashboard use.
  await page.goto('/tasks?task_mode=list&task_view=all&create=1');
  const dialog = page.getByRole('dialog');
  const titleInput = dialog.getByLabel('Что нужно сделать');
  await expect(titleInput).toBeVisible({ timeout: 15_000 });

  // Assignee: server-driven search against /hub/users/assignees — options
  // appear only after TASK_ASSIGNEE_SEARCH_MIN_CHARS (2) typed characters.
  // The seeded e2e_* usernames match the "e2e" query.
  for (const [username, optionName] of [[USERNAME, /E2E Админ/], [USERNAME2, /E2E Пользователь/]]) {
    await dialog.getByLabel('Исполнители').fill(username);
    const option = page.getByRole('option', { name: optionName });
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();
    // The multi-select listbox stays open after a pick.
    await page.keyboard.press('Escape');
  }

  // Project: the submit gate needs one; the fresh stack has none, so create
  // it inline through the "Проект" optional section.
  await dialog.locator('.MuiChip-root', { hasText: 'Проект' }).first().click();
  await dialog.getByLabel('Новый проект').fill(projectName);
  const projectResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/hub\/task-projects/.test(response.url()),
  );
  await dialog.getByRole('button', { name: 'Добавить' }).click();
  const projectResponse = await projectResponsePromise;
  expect(projectResponse.ok()).toBeTruthy();
  const project = await projectResponse.json();
  const projectId = String(project?.id || '');
  expect(projectId).not.toBe('');

  const submit = dialog.getByRole('button', { name: 'Создать задачу' });
  if (validate) {
    await titleInput.fill('ab');
    await expect(dialog.getByText('Минимум 3 символа')).toBeVisible();
    await expect(submit).toBeDisabled();
  }
  await titleInput.fill(title);
  if (description) {
    await dialog.getByLabel('Описание').fill(description);
  }

  if (dueTomorrow) {
    await dialog.getByTestId('create-due-open').click();
    const popover = page.getByTestId('create-due-desktop-popover');
    await expect(popover).toBeVisible();
    await popover.getByTestId('create-due-desktop-preset-tomorrow').click();
    await expect(popover).toBeHidden();
    await expect(dialog.getByTestId('create-due-open')).toContainText(/завтра/i);
  }

  // protocol_date is prefilled with today, so the created project unlocks
  // the submit button.
  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/hub\/tasks$/.test(response.url()),
  );
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(200);
  const body = await createResponse.json();
  expect(body.created).toBe(1);
  expect(body.items).toHaveLength(1);

  const task = body.items[0];
  expect(String(task.project_id)).toBe(projectId);
  expect(task.assignee_user_ids.map(String).sort()).toEqual(expectedAssigneeIds);

  await expect(dialog).toBeHidden({ timeout: 15_000 });
  return task;
}

test('task created through the UI is persisted and listed', async ({ page }) => {
  await login(page);
  const tomorrowKey = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const stamp = Date.now();
  const title = `E2E задача ${stamp}`;
  const description = `E2E описание ${stamp}`;
  const projectName = `E2E проект ${stamp}`;
  const task = await createTask(page, { title, description, projectName, validate: true, dueTomorrow: true });
  const taskId = String(task.id);

  expect(task.title).toBe(title);
  expect(task.description).toBe(description);
  expect(String(task.project_id || '')).not.toBe('');
  expect(task.assignee_user_ids).toHaveLength(2);

  const detailResponse = await page.request.get(`/api/v1/hub/tasks/${encodeURIComponent(taskId)}`);
  expect(detailResponse.status()).toBe(200);
  const persisted = await detailResponse.json();
  expect(persisted.title).toBe(title);
  expect(persisted.description).toBe(description);
  expect(String(persisted.project_id)).toBe(String(task.project_id));
  expect(persisted.assignee_user_ids.map(String).sort()).toEqual(task.assignee_user_ids.map(String).sort());
  expect(String(persisted.protocol_date || '')).not.toBe('');
  expect(String(persisted.due_at || '')).not.toBe('');
  expect(String(persisted.due_at).slice(0, 10)).toBe(tomorrowKey);

  await page.goto('/tasks?task_mode=list&task_view=all');
  const row = page.getByTestId(`tasks-list-row-${taskId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText(title);
});

test('task edited through the UI persists title and description', async ({ page }) => {
  await login(page);
  const stamp = Date.now();
  const title = `E2E задача до правки ${stamp}`;
  const description = `E2E описание до правки ${stamp}`;
  const task = await createTask(page, { title, description, projectName: `E2E проект ${stamp}` });
  const taskId = String(task.id);
  const assigneeIds = task.assignee_user_ids.map(String).sort();
  const projectId = String(task.project_id);

  await page.goto('/tasks?task_mode=list&task_view=all');
  const row = page.getByTestId(`tasks-list-row-${taskId}`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(page.getByTestId('task-detail-workspace-content')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();

  const dialog = page.getByRole('dialog');
  const titleInput = dialog.getByLabel('Что нужно сделать');
  await expect(titleInput).toHaveValue(title, { timeout: 15_000 });
  await expect(dialog.getByLabel('Описание')).toHaveValue(description);
  await expect(dialog.locator('.MuiChip-label', { hasText: 'E2E Админ' })).toBeVisible();
  await expect(dialog.locator('.MuiChip-label', { hasText: 'E2E Пользователь' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Создать задачу' })).toBeHidden();

  const newTitle = `E2E задача после правки ${stamp}`;
  const newDescription = `E2E описание после правки ${stamp}`;
  await titleInput.fill(newTitle);
  await dialog.getByLabel('Описание').fill(newDescription);

  const patchResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && new RegExp(`/api/v1/hub/tasks/${taskId}$`).test(response.url()),
  );
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  const patchResponse = await patchResponsePromise;
  expect(patchResponse.status()).toBe(200);
  await expect(dialog).toBeHidden({ timeout: 15_000 });

  await page.goto('/tasks?task_mode=list&task_view=all');
  const persistedResponse = await page.request.get(`/api/v1/hub/tasks/${encodeURIComponent(taskId)}`);
  expect(persistedResponse.status()).toBe(200);
  const persisted = await persistedResponse.json();
  expect(persisted.title).toBe(newTitle);
  expect(persisted.description).toBe(newDescription);
  expect(persisted.assignee_user_ids.map(String).sort()).toEqual(assigneeIds);
  expect(String(persisted.project_id)).toBe(projectId);

  const persistedRow = page.getByTestId(`tasks-list-row-${taskId}`);
  await expect(persistedRow).toBeVisible({ timeout: 15_000 });
  await expect(persistedRow).toContainText(newTitle);

  await persistedRow.click();
  await expect(page.getByTestId('task-detail-workspace-content')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  const dialogAgain = page.getByRole('dialog');
  await expect(dialogAgain.getByLabel('Что нужно сделать')).toHaveValue(newTitle, { timeout: 15_000 });
  await expect(dialogAgain.getByLabel('Описание')).toHaveValue(newDescription);
  await expect(dialogAgain.locator('.MuiChip-label', { hasText: 'E2E Админ' })).toBeVisible();
  await expect(dialogAgain.locator('.MuiChip-label', { hasText: 'E2E Пользователь' })).toBeVisible();
});
