import { test, expect } from '@playwright/test';

// Ticket request create flow through the real UI: open the dialog, pick the
// seeded employee and object from the live autocomplete options, save, and
// see the request in the list. Writes data — runs on the local stack
// (E2E_LOCAL=1 auto-fills credentials) or anywhere when E2E_SEND=1 is set
// deliberately.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const CAN_WRITE = process.env.E2E_LOCAL === '1' || process.env.E2E_SEND === '1';

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(!CAN_WRITE, 'write flow — run with E2E_LOCAL=1 or E2E_SEND=1');

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

async function createTicket(page) {
  await page.goto('/tickets');
  await page.getByRole('button', { name: 'Создать заявку' }).click();
  const dialog = page.getByRole('dialog');

  // Employee: search hits both ZUP and the local tickets directory — the
  // seeded "Иванов Иван Иванович" is the local hit on the test stack.
  await dialog.getByLabel('Сотрудник').fill('Иван');
  const employeeOption = page.getByRole('option', { name: /Иванов Иван Иванович/ });
  await expect(employeeOption).toBeVisible({ timeout: 15_000 });
  await employeeOption.click();

  // Object: the seeded "Москва" object from the live autocomplete.
  await dialog.getByLabel('Объект').click();
  await page.getByRole('option', { name: /Москва/ }).click();

  const createResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/tickets\/requests$/.test(response.url()),
  );
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json();
  expect(created.id).toBeTruthy();

  await expect(dialog).toBeHidden({ timeout: 15_000 });
  return created;
}

const rowButton = (page, id) => page.getByRole('button', { name: `Открыть заявку ${id}: Иванов Иван Иванович` });

test('ticket request created through the UI is persisted and listed', async ({ page }) => {
  await login(page);
  const created = await createTicket(page);
  const requestId = created.id;

  // The request lands in the list and its detail card opens with the employee.
  const card = page.locator('.MuiDrawer-paperAnchorRight');
  await expect(card.getByRole('heading', { name: `Заявка #${requestId}` })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText('Иванов Иван Иванович').first()).toBeVisible();

  await card.getByLabel('Закрыть').click();
  await expect(card).toBeHidden();

  await expect(rowButton(page, requestId)).toBeVisible({ timeout: 15_000 });
});

test('ticket status can be changed through the request card', async ({ page }) => {
  await login(page);
  // Create a request first so the card has real data to transition.
  const created = await createTicket(page);
  const requestId = created.id;

  // Creating a request auto-opens its detail card in the drawer.
  const card = page.locator('.MuiDrawer-paperAnchorRight');
  await expect(card.getByRole('heading', { name: `Заявка #${requestId}` })).toBeVisible({ timeout: 15_000 });

  // Status select → «В кассах», a comment, save.
  await card.locator('.MuiSelect-select').click();
  await page.getByRole('option', { name: 'В кассах' }).click();
  await card.getByLabel('Комментарий к смене статуса').fill('e2e: принято в работу');
  const patchResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && new RegExp(`/api/v1/tickets/requests/${requestId}/status$`).test(response.url()),
  );
  await card.getByRole('button', { name: 'Сохранить' }).click();
  const patchResponse = await patchResponsePromise;
  expect(patchResponse.status()).toBe(200);

  const detailResponse = await page.request.get(`/api/v1/tickets/requests/${requestId}`);
  expect(detailResponse.status()).toBe(200);
  expect((await detailResponse.json()).status).toBe('at_cashier');

  const historyResponse = await page.request.get(`/api/v1/tickets/requests/${requestId}/history`);
  expect(historyResponse.status()).toBe(200);
  const history = await historyResponse.json();
  expect(history.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ field_name: 'status', new_value: 'at_cashier', comment: 'e2e: принято в работу' }),
  ]));

  await card.getByLabel('Закрыть').click();
  await expect(card).toBeHidden();
  await page.goto('/tickets');
  await rowButton(page, requestId).click();
  await expect(card.getByRole('heading', { name: `Заявка #${requestId}` })).toBeVisible({ timeout: 15_000 });
  // The card reloads and shows the new status chip.
  await expect(card.locator('.MuiChip-root', { hasText: 'В кассах' })).toBeVisible({ timeout: 15_000 });
});

test('ticket request opens as a card on mobile while the full table stays available', async ({ page }) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'seeded ticket flows require the isolated local stack');
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  const created = await createTicket(page);
  const requestId = created.id;

  const card = page.locator('.MuiDrawer-paperAnchorRight');
  await expect(card.getByRole('heading', { name: `Заявка #${requestId}` })).toBeVisible({ timeout: 15_000 });
  await card.getByLabel('Закрыть').click();
  await expect(card).toBeHidden();

  await expect(page.getByTestId('ticket-mobile-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('table')).toBeHidden();

  await rowButton(page, requestId).click();
  await expect(card.getByRole('heading', { name: `Заявка #${requestId}` })).toBeVisible({ timeout: 15_000 });
  await card.getByLabel('Закрыть').click();
  await expect(card).toBeHidden();

  await page.getByRole('button', { name: 'Таблица' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(rowButton(page, requestId)).toBeVisible();

  const filtersButton = page.getByRole('button', { name: 'Фильтры' });
  await filtersButton.click();
  await expect(filtersButton).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#ticket-extra-filters')).toBeVisible();

  await page.getByRole('button', { name: 'Карточки' }).click();
  await expect(page.getByTestId('ticket-mobile-list')).toBeVisible();
  await expect(page.getByRole('table')).toBeHidden();
});
