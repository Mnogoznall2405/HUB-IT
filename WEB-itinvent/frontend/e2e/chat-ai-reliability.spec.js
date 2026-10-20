import { test, expect } from '@playwright/test';

test.skip(process.env.E2E_LOCAL !== '1' || process.env.E2E_AI_RELIABILITY !== '1', 'requires local persisted AI fixtures');

async function session(loginPage) {
  await loginPage.goto('/login');
  const form = loginPage.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(process.env.E2E_USERNAME);
  await form.locator('input[name="password"]').fill(process.env.E2E_PASSWORD);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(loginPage.getByTestId('main-layout-content')).toBeVisible();
  return loginPage.context().newPage();
}

test('persisted draft survives refresh, editing and confirmation, then opens Sent', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  await page.goto('/chat?conversation=reliability-draft');
  const card = page.getByTestId('chat-ai-action-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText(/Письмо не отправлено/)).toBeVisible();
  await expect(card.getByText('Кому: recipient@example.test', { exact: true })).toBeVisible();
  await page.reload();
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Изменить', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Редактировать письмо', exact: true });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Текст', { exact: true }).fill('Подтверждённый пользователем текст письма.');
  await editor.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(card.getByText('Письмо отправлено', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(card.getByText('Письмо отправлено', { exact: true })).toBeVisible();
  const opened = page.context().waitForEvent('page');
  await card.getByRole('button', { name: 'Открыть в почте', exact: true }).click();
  const mail = await opened;
  await expect(mail).toHaveURL(/\/mail\?.*folder=sent/);
  expect(new URL(mail.url()).searchParams.get('message')).toMatch(/^e2e-sent-/);
  await expect(page.getByRole('dialog', { name: 'Редактировать письмо', exact: true })).toHaveCount(0);
});

test('an expired draft offers no send button after cold loading', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  await page.goto('/chat?conversation=reliability-expired');
  const card = page.getByTestId('chat-ai-action-card');
  await expect(card.getByText(/Срок подтверждения истёк/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
});

test('a saved answer is shown once while service completion is delayed', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  await page.goto('/chat?conversation=reliability-progress');
  await expect(page.getByTestId('chat-ai-action-card')).toBeVisible();
  const status = await page.request.get('/api/v1/chat/conversations/reliability-progress/ai-status');
  expect((await status.json()).status).toBe('running');
  await expect(page.getByTestId('chat-thread-content').getByText('Подготовил черновик письма. Проверьте карточку и подтвердите отправку.', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('chat-ai-run-status')).toHaveCount(0);
  await expect(page.getByTestId('ai-partial-response')).toHaveCount(0);
  await expect(page.getByText('Ответ готов. Завершаю обработку.', { exact: true })).toBeVisible();
});

test('an ambiguous mail outcome remains explicit after refresh and cannot be resent', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  await page.goto('/chat?conversation=reliability-unknown');
  const card = page.getByTestId('chat-ai-action-card');
  await card.getByRole('button', { name: 'Подтвердить и отправить', exact: true }).click();
  await expect(card.getByText('Результат отправки неизвестен', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Проверить в почте', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(card.getByText('Результат отправки неизвестен', { exact: true })).toBeVisible();
});

test('draft actions remain usable in a narrow dark layout', async ({ page: loginPage }, testInfo) => {
  const page = await session(loginPage);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/chat?conversation=reliability-progress');
  const card = page.getByTestId('chat-ai-action-card');
  await expect(card.getByText(/Письмо не отправлено/)).toBeVisible();
  await expect(page.getByText('Ответ готов. Завершаю обработку.', { exact: true })).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  await page.screenshot({ path: testInfo.outputPath('draft-dark-narrow.png') });
  await card.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Редактировать письмо', exact: true })).toBeVisible();
});

test('an unknown edited send closes the editor and offers only a status check', async ({ page: loginPage }) => {
  const page = await session(loginPage);
  await page.goto('/chat?conversation=reliability-unknown-editor');
  const card = page.getByTestId('chat-ai-action-card');
  await card.getByRole('button', { name: 'Изменить', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Редактировать письмо', exact: true });
  await editor.getByRole('button', { name: 'Отправить', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(card.getByText('Результат отправки неизвестен', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Проверить в почте', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
});

for (const edited of [false, true]) {
  test(`a lost ${edited ? 'edited' : 'direct'} confirmation response recovers without resend`, async ({ page: loginPage }) => {
    const page = await session(loginPage);
    await page.goto(`/chat?conversation=reliability-lost-${edited ? 'editor' : 'direct'}`);
    let requests = 0;
    let releaseResponse = () => {};
    const responseGate = edited ? new Promise((resolve) => { releaseResponse = resolve; }) : Promise.resolve();
    await page.route('**/api/v1/chat/ai/actions/*/confirm', async route => {
      requests += 1;
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      expect((await response.json()).status).toBe('confirmed');
      await responseGate;
      await route.abort('failed');
    });
    const card = page.getByTestId('chat-ai-action-card');
    if (edited) {
      await card.getByRole('button', { name: 'Изменить', exact: true }).click();
      await page.getByRole('dialog', { name: 'Редактировать письмо', exact: true }).getByRole('button', { name: 'Отправить', exact: true }).click();
      try {
        await expect(page.getByRole('dialog', { name: 'Редактировать письмо', exact: true }).getByLabel('Текст', { exact: true })).toBeDisabled();
      } finally { releaseResponse(); }
      await expect(page.getByRole('dialog', { name: 'Редактировать письмо', exact: true })).toHaveCount(0);
    } else {
      await card.getByRole('button', { name: 'Подтвердить и отправить', exact: true }).click();
    }
    await expect(card.getByText('Письмо отправлено', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Подтвердить и отправить', exact: true })).toHaveCount(0);
    expect(requests).toBe(1);
  });
}
