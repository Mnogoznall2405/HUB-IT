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

test('join requests: the link leaves a request, the owner approves it in the group panel', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const contextB = await newContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    await login(pageA, U1, P1);
    await login(pageB, U2, P2);

    const insiderId = await findUserId(pageA, U3);
    const title = `E2E заявки ${Date.now()}`;
    const group = await createGroup(pageA, title, [insiderId]);
    const invite = await pageA.request.post(`/api/v1/chat/conversations/${group.id}/invite-link`);
    expect(invite.ok()).toBeTruthy();
    const { token } = await invite.json();

    // Owner: switch the group to join by approval.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    await pageA.getByTestId('chat-group-join-requests-button').click();
    await pageA.getByTestId('chat-join-approval-switch').click();
    await expect(pageA.getByTestId('chat-join-approval-switch')).toBeChecked({ timeout: 15_000 });
    await pageA.keyboard.press('Escape');

    // Outsider: the link asks for a request, the group does not open.
    await pageB.goto(`/chat?join=${encodeURIComponent(token)}`);
    await expect(pageB.getByText(`Отправить заявку в беседу «${title}»?`)).toBeVisible({ timeout: 30_000 });
    await pageB.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(pageB.getByText('Заявка отправлена.')).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByTestId('chat-composer-textarea')).toHaveCount(0);

    // Owner: the request waits in the panel; approving lets the person in.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    const requestsButton = pageA.getByTestId('chat-group-join-requests-button');
    await expect(requestsButton).toContainText('Заявки (1)', { timeout: 30_000 });
    await requestsButton.click();
    await expect(pageA.getByTestId('chat-group-join-request-item')).toHaveCount(1);
    await pageA.getByTestId('chat-join-request-approve').click();
    await expect(pageA.getByText('Заявок нет.')).toBeVisible({ timeout: 15_000 });

    await openGroup(pageB, group.id);
    await expect(pageB.getByTestId('chat-composer-textarea')).toBeVisible({ timeout: 30_000 });
  } finally {
    await contextA.close();
    await contextB.close();
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

test('search filters: the author and the message type narrow the in-chat search without any text', async ({
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
    const users = await (await pageA.request.get('/api/v1/chat/users')).json();
    const memberUser = (users.items || users).find((item) => item.id === memberId);
    const memberName = memberUser.full_name || memberUser.username;
    const group = await createGroup(pageA, `E2E поиск ${Date.now()}`, [memberId]);
    const stamp = Date.now();
    const send = async (page, body, id) => {
      const response = await page.request.post(`/api/v1/chat/conversations/${group.id}/messages`, {
        data: { body, client_message_id: `${id}-${stamp}` },
      });
      expect(response.ok()).toBeTruthy();
    };
    await send(pageA, `owner note ${stamp}`, 'sf-1');
    await send(pageB, `member note ${stamp}`, 'sf-2');
    await send(pageB, `member link https://example.com/${stamp}`, 'sf-3');

    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Поиск по сообщениям' }).first().click();
    const dialog = pageA.getByRole('dialog', { name: 'Поиск по сообщениям' });
    await expect(dialog.getByText(/Введите запрос или выберите фильтр/)).toBeVisible({ timeout: 15_000 });

    // Type alone: only the message with a link.
    await dialog.getByTestId('chat-search-kind-link').click();
    await expect(dialog.getByText(`member link https://example.com/${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(`member note ${stamp}`)).toHaveCount(0);

    // Author alone (type off): everything the member wrote, nothing of the owner.
    await dialog.getByTestId('chat-search-kind-link').click();
    await dialog.getByLabel('Автор').click();
    await pageA.getByRole('option', { name: memberName, exact: true }).click();
    await expect(dialog.getByText(`member note ${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(`owner note ${stamp}`)).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('several pins: the bar counts them, a tap moves to the older one, unpin removes the shown one', async ({
  browser,
}) => {
  const contextA = await newContext(browser);
  const pageA = await contextA.newPage();

  try {
    await login(pageA, U1, P1);
    const memberId = await findUserId(pageA, U2);
    const group = await createGroup(pageA, `E2E закрепы ${Date.now()}`, [memberId]);
    const stamp = Date.now();
    const ids = [];
    for (const index of [1, 2, 3]) {
      const response = await pageA.request.post(`/api/v1/chat/conversations/${group.id}/messages`, {
        data: { body: `pin text ${index} ${stamp}`, client_message_id: `pn-${index}-${stamp}` },
      });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).id);
    }
    for (const id of ids.slice(0, 2)) {
      const response = await pageA.request.put(`/api/v1/chat/conversations/${group.id}/pinned-messages/${id}`);
      expect(response.ok()).toBeTruthy();
    }

    await openGroup(pageA, group.id);
    const counter = pageA.getByTestId('chat-pinned-message-counter');
    await expect(counter).toContainText('1 из 2', { timeout: 30_000 });
    await expect(pageA.getByTestId('chat-pinned-message-open')).toContainText(`pin text 2 ${stamp}`);

    // A tap shows the older pin next.
    await pageA.getByTestId('chat-pinned-message-open').click();
    await expect(counter).toContainText('2 из 2');
    await expect(pageA.getByTestId('chat-pinned-message-open')).toContainText(`pin text 1 ${stamp}`);

    // Unpin removes the shown (older) pin only; the other one stays as the single pin.
    await pageA.getByTestId('chat-pinned-message-close').click();
    await expect(counter).toHaveText('Закрепленное сообщение', { timeout: 15_000 });
    await expect(pageA.getByTestId('chat-pinned-message-open')).toContainText(`pin text 2 ${stamp}`);
  } finally {
    await contextA.close();
  }
});

test('history export: the owner downloads the group history from the info panel, a member has no such button', async ({
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
    const group = await createGroup(pageA, `E2E выгрузка ${Date.now()}`, [memberId]);
    const text = `export me ${Date.now()}`;
    const sent = await pageA.request.post(`/api/v1/chat/conversations/${group.id}/messages`, {
      data: { body: text, client_message_id: `ex-${Date.now()}` },
    });
    expect(sent.ok()).toBeTruthy();

    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    await pageA.getByTestId('chat-export-history-button').click();
    const downloadPromise = pageA.waitForEvent('download', { timeout: 30_000 });
    await pageA.getByTestId('chat-export-history-txt').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf-8')).toContain(text);

    await openGroup(pageB, group.id);
    await pageB.getByRole('button', { name: 'Информация о чате' }).first().click();
    await expect(pageB.getByText('Информация', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByTestId('chat-export-history-button')).toHaveCount(0);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('reports: a member complains about a message, the owner sees it in the group panel and dismisses it', async ({
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
    const group = await createGroup(pageA, `E2E жалобы ${Date.now()}`, [memberId]);
    const text = `bad words ${Date.now()}`;
    const sent = await pageA.request.post(`/api/v1/chat/conversations/${group.id}/messages`, {
      data: { body: text, client_message_id: `rp-${Date.now()}` },
    });
    expect(sent.ok()).toBeTruthy();

    // Member: the message menu opens the complaint dialog.
    await openGroup(pageB, group.id);
    await pageB.getByText(text).last().click({ button: 'right' });
    await pageB.getByRole('menuitem', { name: 'Пожаловаться' }).click();
    await pageB.getByTestId('chat-report-submit').click();
    await expect(pageB.getByTestId('chat-report-sent')).toBeVisible({ timeout: 15_000 });

    // Owner: the panel shows the waiting complaint; dismissing it clears the counter.
    await openGroup(pageA, group.id);
    await pageA.getByRole('button', { name: 'Информация о чате' }).first().click();
    const reportsButton = pageA.getByTestId('chat-group-reports-button');
    await expect(reportsButton).toContainText('Жалобы (1)', { timeout: 30_000 });
    await reportsButton.click();
    const item = pageA.getByTestId('chat-group-report-item');
    await expect(item).toContainText(text);
    await pageA.getByTestId('chat-report-dismiss').click();
    await expect(pageA.getByText('Открытых жалоб нет.')).toBeVisible({ timeout: 15_000 });
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('reaction picker: the emoji are visible for the first message and a click adds the reaction', async ({
  browser,
}) => {
  const context = await newContext(browser);
  const page = await context.newPage();

  try {
    await login(page, U1, P1);
    const memberId = await findUserId(page, U2);
    const group = await createGroup(page, `E2E реакции ${Date.now()}`, [memberId]);
    const body = `первое сообщение ${Date.now()}`;
    const sent = await page.request.post(`/api/v1/chat/conversations/${group.id}/messages`, {
      data: { body, client_message_id: `react-${Date.now()}` },
    });
    expect(sent.ok()).toBeTruthy();

    // The only message sits at the very top of the thread: the picker must not be clipped there
    // and its emoji buttons must keep their size.
    await openGroup(page, group.id);
    await page.getByText(body).first().hover();
    await page.getByRole('button', { name: 'Реакция', exact: true }).first().click();
    const thumbsUp = page.getByRole('button', { name: 'Реакция 👍' });
    await expect(thumbsUp).toBeVisible();
    const box = await thumbsUp.boundingBox();
    expect(box.width).toBeGreaterThan(16);
    const scroller = await page.getByTestId('chat-thread-scroll').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(scroller.y);

    await thumbsUp.click();
    await expect(page.getByTestId('chat-reactions-bar')).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
});
