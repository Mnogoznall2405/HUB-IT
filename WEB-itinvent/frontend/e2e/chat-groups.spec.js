import { test, expect } from '@playwright/test';

// Group rules and invite links against the local stack (E2E_LOCAL=1 seeds three
// users). Setup goes through the real API, assertions go through the real UI:
//
//   owner switches posting rules -> a member sees the plaque instead of the composer
//   owner creates an invite link -> a third user joins through /chat?join=<token>
//
// Browser-level twin of tests/test_e2e_chat_groups.py.

const U1 = process.env.E2E_USERNAME;
const P1 = process.env.E2E_PASSWORD;
const U2 = process.env.E2E_USERNAME2;
const P2 = process.env.E2E_PASSWORD2;
const U3 = process.env.E2E_USERNAME3;
const P3 = process.env.E2E_PASSWORD3;

test.skip(
  !(U1 && P1 && U2 && P2 && U3 && P3),
  'need three users: run with E2E_LOCAL=1 or set E2E_USERNAME2/3 and E2E_PASSWORD2/3',
);

async function login(page, username, password) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

// The portal tries to hand the session over to HUB Desktop (hubit://) outside the chat; the
// browser's external-protocol prompt would swallow every click of the test.
async function newContext(browser) {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem('hubit:desktop-handoff', 'never'));
  return context;
}

async function findUserId(page, username) {
  const response = await page.request.get('/api/v1/chat/users');
  expect(response.ok()).toBeTruthy();
  const users = await response.json();
  const user = (users.items || users).find((item) => item.username === username);
  expect(user, `user ${username} not in chat users`).toBeTruthy();
  return user.id;
}

async function createGroup(page, title, memberIds) {
  const response = await page.request.post('/api/v1/chat/conversations/group', {
    data: { title, member_user_ids: memberIds },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function setPostingPolicy(page, conversationId, postingPolicy) {
  const response = await page.request.patch(`/api/v1/chat/conversations/${conversationId}/profile`, {
    data: { posting_policy: postingPolicy },
  });
  expect(response.ok()).toBeTruthy();
}

async function openGroup(page, conversationId) {
  await page.goto(`/chat?conversation=${encodeURIComponent(conversationId)}`);
}

test('posting rules: member sees a plaque instead of the composer, owner keeps writing', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextB = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const memberId = await findUserId(pageA, U2);
    const title = `E2E правила ${Date.now()}`;
    const group = await createGroup(pageA, title, [memberId]);
    await setPostingPolicy(pageA, group.id, 'managers');

    // Member: plaque, no composer.
    await openGroup(pageB, group.id);
    await expect(
      pageB.getByText('Писать в эту группу могут только владелец и модераторы.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId('chat-composer-textarea')).toHaveCount(0);

    // Owner: composer stays, message reaches the member.
    await openGroup(pageA, group.id);
    const text = `e2e group ${new Date().toISOString()}`;
    await pageA.getByTestId('chat-composer-textarea').fill(text);
    await pageA.getByTestId('chat-composer-send-button').click();
    await expect(pageA.getByText(text).last()).toBeVisible();
    await pageB.reload();
    await openGroup(pageB, group.id);
    await expect(pageB.getByText(text).last()).toBeVisible({ timeout: 30_000 });

    // Closed group stops everyone, owner included; the server refuses the send.
    await setPostingPolicy(pageA, group.id, 'closed');
    await pageA.reload();
    await openGroup(pageA, group.id);
    await expect(pageA.getByText('Группа закрыта: писать в неё нельзя.')).toBeVisible({
      timeout: 30_000,
    });
    await expect(pageA.getByTestId('chat-composer-textarea')).toHaveCount(0);
    const refused = await pageA.request.post(
      `/api/v1/chat/conversations/${group.id}/messages`,
      { data: { body: 'closed group write', client_message_id: `e2e-${Date.now()}` } },
    );
    expect(refused.status()).toBe(403);

    // The owner journal lists the change; a plain member may not read it.
    const journal = await pageA.request.get(`/api/v1/chat/conversations/${group.id}/activity`);
    expect(journal.ok()).toBeTruthy();
    const journalBody = await journal.json();
    expect((journalBody.items || []).some((item) => item.action === 'profile_updated')).toBeTruthy();
    const memberJournal = await pageB.request.get(`/api/v1/chat/conversations/${group.id}/activity`);
    expect(memberJournal.ok()).toBeFalsy();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('invite link: a third user joins through /chat?join= and the group opens', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextC = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageC = await contextC.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageC, U3, P3);

    const memberId = await findUserId(pageA, U2);
    const title = `E2E приглашение ${Date.now()}`;
    const group = await createGroup(pageA, title, [memberId]);

    const invite = await pageA.request.post(`/api/v1/chat/conversations/${group.id}/invite-link`);
    expect(invite.ok()).toBeTruthy();
    const { token } = await invite.json();
    expect(token).toBeTruthy();

    await pageC.goto(`/chat?join=${encodeURIComponent(token)}`);
    await expect(pageC.getByText(`Вступить в беседу «${title}»?`)).toBeVisible({ timeout: 30_000 });
    await pageC.getByRole('button', { name: 'Вступить', exact: true }).click();
    await expect(pageC.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    await expect(pageC.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
    // The token never stays in the address bar.
    expect(pageC.url()).not.toContain('join=');

    // A revoked link no longer works for anyone else.
    const revoked = await pageA.request.delete(`/api/v1/chat/conversations/${group.id}/invite-link`);
    expect(revoked.ok()).toBeTruthy();
    const second = await pageA.request.post(`/api/v1/chat/invite-links/${token}/join`);
    expect(second.ok()).toBeFalsy();
  } finally {
    await contextA.close();
    await contextC.close();
  }
});

test('slow mode: the owner turns it on in the group panel, a member waits between messages', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextB = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const memberId = await findUserId(pageA, U2);
    const title = `E2E медленный ${Date.now()}`;
    const group = await createGroup(pageA, title, [memberId]);

    // Owner: the button in the group panel opens the dialog; 30 seconds are saved.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    await pageA.getByTestId('chat-group-slow-mode-button').click();
    const dialog = pageA.getByTestId('chat-group-slow-mode');
    await dialog.getByLabel('30 секунд').check();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(pageA.getByTestId('chat-group-slow-mode-button')).toContainText('30 секунд', {
      timeout: 15_000,
    });

    // Member: the first message goes through, the second is refused with the reason.
    await openGroup(pageB, group.id);
    const first = `e2e slow one ${Date.now()}`;
    await pageB.getByTestId('chat-composer-textarea').fill(first);
    await pageB.getByTestId('chat-composer-send-button').click();
    await expect(pageB.getByText(first).last()).toBeVisible({ timeout: 30_000 });

    await pageB.getByTestId('chat-composer-textarea').fill(`e2e slow two ${Date.now()}`);
    await pageB.getByTestId('chat-composer-send-button').click();
    await expect(pageB.getByText(/Медленный режим/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('restriction: the owner bars a member from writing and lifts it, the member sees a plaque live', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextB = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const memberId = await findUserId(pageA, U2);
    const title = `E2E ограничение ${Date.now()}`;
    const group = await createGroup(pageA, title, [memberId]);

    // The member has the group open and can write.
    await openGroup(pageB, group.id);
    await expect(pageB.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });

    // Owner: member actions -> restrict -> dialog (1 day is preselected) -> the member row is marked.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    await pageA.getByRole('button', { name: /^Участники/ }).first().click();
    await pageA.getByRole('button', { name: /Действия участника/ }).first().click();
    await pageA.getByTestId('chat-member-restrict').click();
    const dialog = pageA.getByTestId('chat-group-restrict');
    await dialog.getByRole('button', { name: 'Ограничить' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(pageA.getByTestId('chat-member-restricted').first()).toBeVisible({ timeout: 15_000 });

    // Member: the composer is replaced by the plaque without reopening the group.
    await expect(pageB.getByTestId('chat-viewer-restricted')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId('chat-composer-textarea')).toHaveCount(0);

    // Owner lifts it; the member gets the composer back.
    await pageA.getByRole('button', { name: /Действия участника/ }).first().click();
    await pageA.getByTestId('chat-member-lift-restriction').click();
    await expect(pageA.getByTestId('chat-member-restricted')).toHaveCount(0, { timeout: 15_000 });
    await expect(pageB.getByTestId('chat-viewer-restricted')).toBeHidden({ timeout: 30_000 });
    await expect(pageB.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 15_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('file permission: the owner forbids files, a member is refused with the reason, the owner still sends', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextB = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const memberId = await findUserId(pageA, U2);
    const group = await createGroup(pageA, `E2E файлы ${Date.now()}`, [memberId]);

    // Owner: the toggle in the group panel flips its label once the server accepted the change.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    await pageA.getByTestId('chat-group-files-button').click();
    await expect(pageA.getByTestId('chat-group-files-button')).toContainText('Разрешить файлы', {
      timeout: 15_000,
    });

    // Member: the upload is refused with the reason the server gives.
    await openGroup(pageB, group.id);
    await pageB.getByTestId('chat-file-input').setInputFiles({
      name: `e2e-denied-${Date.now()}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from('denied payload\n'),
    });
    await expect(pageB.getByTestId('chat-file-upload-panel')).toBeVisible();
    await pageB.getByTestId('file-dialog-send').click();
    await expect(
      pageB.getByText(/файлы могут отправлять только владелец и модераторы/).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Owner is exempt.
    const ownerFile = `e2e-owner-${Date.now()}.txt`;
    await pageA.getByTestId('chat-file-input').setInputFiles({
      name: ownerFile,
      mimeType: 'text/plain',
      buffer: Buffer.from('owner payload\n'),
    });
    await pageA.getByTestId('file-dialog-send').click();
    await expect(pageA.getByText(ownerFile).last()).toBeVisible({ timeout: 30_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
