import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';

// Personal-files write flows through the real UI: upload a file and create a
// folder, then see both in the drive list. Writes data — on the local stack
// (E2E_LOCAL=1) all file bytes land in e2e/stack/.state/ via MY_FILES_* env
// overrides in local_backend.py; elsewhere requires deliberate E2E_SEND=1.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;
const PASSWORD2 = process.env.E2E_PASSWORD2;
const CAN_WRITE = process.env.E2E_LOCAL === '1' || process.env.E2E_SEND === '1';

test.skip(!(USERNAME && PASSWORD), 'E2E_USERNAME/E2E_PASSWORD not set');
test.skip(!CAN_WRITE, 'write flow — run with E2E_LOCAL=1 or E2E_SEND=1');

async function login(page, username = USERNAME, password = PASSWORD) {
  await page.goto('/login');
  const form = page.getByTestId('password-auth-form');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
  await expect(page.getByTestId('password-auth-form')).toBeHidden();
  await expect(page.getByTestId('main-layout-content')).toBeVisible({ timeout: 30_000 });
}

async function uploadFileThroughUi(page, { fileName, payload }) {
  let uploadSessionCalls = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\/my-files\/upload-sessions(\?|$)/.test(request.url())) {
      uploadSessionCalls += 1;
    }
  });

  await page.getByTestId('my-files-input').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: payload,
  });

  // File selection opens the retention/confirm dialog — the file name shown
  // there must not satisfy the assertion; the drive row only exists after a
  // confirmed, completed upload.
  const dialog = page.getByRole('dialog', { name: 'Загрузка файлов' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(fileName)).toBeVisible();
  await expect(dialog.getByText(/Файлы будут удалены по окончании выбранного срока хранения/)).toBeVisible();
  expect(uploadSessionCalls).toBe(0);

  const sessionResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/my-files\/upload-sessions$/.test(response.url()),
  );
  const completeResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /^\/api\/v1\/my-files\/upload-sessions\/[^/]+\/complete$/.test(new URL(response.url()).pathname),
  );
  await dialog.getByRole('button', { name: 'Загрузить', exact: true }).click();

  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(201);
  const sessionBody = sessionResponse.request().postDataJSON();
  expect(sessionBody.retention_days).toBe(1);
  expect(sessionBody.folder_id).toBeNull();
  const session = await sessionResponse.json();
  const fileId = String(session?.file_id || '');
  expect(fileId).not.toBe('');

  const completeResponse = await completeResponsePromise;
  expect(new URL(completeResponse.url()).pathname).toBe(`/api/v1/my-files/upload-sessions/${fileId}/complete`);
  expect(completeResponse.ok()).toBeTruthy();
  const completed = await completeResponse.json();
  expect(String(completed.id)).toBe(fileId);
  expect(completed.retention_days).toBe(1);

  await expect(dialog).toBeHidden();
  return completed;
}

async function createFolderThroughUi(page, name, { parentId = null } = {}) {
  await page.getByTestId('my-files-create-button').click();
  await page.getByTestId('my-files-create-folder-button').click();
  await page.getByTestId('my-files-folder-name-input').fill(name);

  const folderResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && /\/api\/v1\/my-files\/folders$/.test(response.url()),
  );
  await page.getByTestId('my-files-create-folder-confirm').click();
  const folderResponse = await folderResponsePromise;
  expect(folderResponse.status()).toBe(201);
  const folder = await folderResponse.json();
  expect(folder.parent_id ?? null).toBe(parentId);
  const folderId = String(folder.id);
  expect(folderId).not.toBe('');

  await expect(page.getByTestId(`my-files-folder-${folderId}`)).toBeVisible({ timeout: 15_000 });
  return folder;
}

async function listDriveItems(page, folderId = null) {
  const listResponse = await page.request.get('/api/v1/my-files', {
    params: folderId ? { folder_id: folderId } : {},
  });
  expect(listResponse.status()).toBe(200);
  const list = await listResponse.json();
  return list.items || [];
}

async function listTrashEntries(page) {
  const trashResponse = await page.request.get('/api/v1/my-files/trash');
  expect(trashResponse.status()).toBe(200);
  return trashResponse.json();
}

async function waitForReadyFile(page, fileId) {
  let readyRow = null;
  await expect.poll(async () => {
    const items = await listDriveItems(page);
    readyRow = items.find((item) => String(item.id) === String(fileId));
    expect(readyRow).toBeTruthy();
    expect(readyRow.status, String(readyRow.error_text || '')).not.toBe('failed');
    return readyRow.status;
  }, { timeout: 60_000 }).toBe('ready');
  return readyRow;
}

async function downloadAndCheck(page, clickDownload, { fileName, payload, path }) {
  const downloadPromise = page.waitForEvent('download');
  await clickDownload();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(fileName);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const downloaded = await readFile(path);
  expect(downloaded.equals(payload)).toBe(true);
}

test('file uploaded through the drive UI appears in the list', async ({ page }) => {
  await login(page);
  await page.goto('/my-files');
  await expect(page.getByTestId('my-files-create-button')).toBeVisible();
  await expect(page.getByText(/Файлы хранятся до 30 дней/)).toBeVisible();

  const fileName = `e2e-upload-${Date.now()}.txt`;
  const completed = await uploadFileThroughUi(page, {
    fileName,
    payload: Buffer.from('e2e upload payload\n'),
  });

  await expect(page.getByTestId(`my-files-card-${completed.id}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(fileName)).toBeVisible();

  await page.reload();
  await expect(page.getByTestId(`my-files-card-${completed.id}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(fileName)).toBeVisible();

  const persistedFile = (await listDriveItems(page)).find((item) => String(item.id) === String(completed.id));
  expect(persistedFile).toBeTruthy();
  expect(persistedFile.retention_days).toBe(1);
});

test('folder created through the create menu appears in the list', async ({ page }) => {
  await login(page);
  await page.goto('/my-files');

  const folderName = `e2e-folder-${Date.now()}`;
  const folder = await createFolderThroughUi(page, folderName);
  const folderId = String(folder.id);

  await page.reload();
  const persistedRow = page.getByTestId(`my-files-folder-${folderId}`);
  await expect(persistedRow).toBeVisible({ timeout: 15_000 });
  await expect(persistedRow).toContainText(folderName);
});

test('file rename, move and restore keep the original download bytes', async ({ page }, testInfo) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'file lifecycle requires the isolated local stack');
  test.skip(process.env.E2E_FILES_WORKER !== '1', 'file lifecycle requires the isolated inline worker');
  test.setTimeout(180_000);

  await login(page);
  await page.goto('/my-files');
  await expect(page.getByTestId('my-files-create-button')).toBeVisible();

  const fileName = `e2e-lifecycle-${Date.now()}.txt`;
  const payload = Buffer.from(`e2e lifecycle payload ${Date.now()}\n`);
  const completed = await uploadFileThroughUi(page, { fileName, payload });
  const fileId = String(completed.id);

  const readyRow = await waitForReadyFile(page, fileId);
  expect(readyRow.original_size_bytes).toBe(payload.length);

  const renamedName = `e2e-renamed-${Date.now()}.txt`;
  const fileCard = page.getByTestId(`my-files-card-${fileId}`);
  await fileCard.click({ button: 'right' });
  await page.getByTestId('file-action-rename').click();

  const renameDialog = page.getByRole('dialog', { name: 'Переименовать файл' });
  await expect(renameDialog).toBeVisible();
  await page.getByTestId('my-files-rename-input').fill(renamedName);

  const isFilePatch = (response) => response.request().method() === 'PATCH'
    && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}`;
  const renameResponsePromise = page.waitForResponse(isFilePatch);
  await page.getByTestId('my-files-rename-confirm').click();
  const renameResponse = await renameResponsePromise;
  expect(renameResponse.status()).toBe(200);
  const renamed = await renameResponse.json();
  expect(renamed.original_file_name).toBe(renamedName);
  expect(renamed.download_file_name).toBe(renamedName);
  await expect(renameDialog).toBeHidden();

  await page.reload();
  await expect(fileCard).toBeVisible({ timeout: 15_000 });
  await expect(fileCard).toContainText(renamedName);
  await expect(fileCard).not.toContainText(fileName);

  const renamedRow = (await listDriveItems(page)).find((item) => String(item.id) === fileId);
  expect(renamedRow?.original_file_name).toBe(renamedName);

  const folderName = `e2e-dest-${Date.now()}`;
  const folder = await createFolderThroughUi(page, folderName);
  const folderId = String(folder.id);

  await fileCard.click({ button: 'right' });
  await page.getByTestId('file-action-move').click();
  const moveDialog = page.getByRole('dialog', { name: 'Переместить в папку' });
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: folderName, exact: true }).click();

  const moveResponsePromise = page.waitForResponse(isFilePatch);
  await page.getByTestId('my-files-move-confirm').click();
  const moveResponse = await moveResponsePromise;
  expect(moveResponse.status()).toBe(200);
  const moved = await moveResponse.json();
  expect(String(moved.folder_id)).toBe(folderId);
  await expect(moveDialog).toBeHidden();
  await expect(fileCard).toBeHidden();

  const rootItems = await listDriveItems(page);
  expect(rootItems.some((item) => String(item.id) === fileId)).toBe(false);

  const folderItems = await listDriveItems(page, folderId);
  const movedRow = folderItems.find((item) => String(item.id) === fileId);
  expect(movedRow).toBeTruthy();
  expect(movedRow.original_file_name).toBe(renamedName);
  expect(movedRow.status).toBe('ready');
  expect(String(movedRow.folder_id)).toBe(folderId);

  await page.getByTestId(`my-files-folder-${folderId}`).click();
  await page.waitForURL((url) => url.searchParams.get('folder') === folderId);
  const breadcrumbs = page.getByTestId('my-files-breadcrumbs');
  await expect(breadcrumbs).toContainText('Мой диск');
  await expect(breadcrumbs).toContainText(folderName);
  await expect(fileCard).toBeVisible();

  await page.reload();
  await page.waitForURL((url) => url.searchParams.get('folder') === folderId);
  await expect(fileCard).toBeVisible({ timeout: 15_000 });
  expect((await listDriveItems(page, folderId)).some((item) => String(item.id) === fileId)).toBe(true);

  let deleteCalls = 0;
  page.on('request', (request) => {
    if (request.method() === 'DELETE' && new URL(request.url()).pathname === `/api/v1/my-files/${fileId}`) {
      deleteCalls += 1;
    }
  });
  await fileCard.hover();
  await page.getByTestId(`my-files-delete-${fileId}`).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Удалить файл' });
  await expect(deleteDialog).toBeVisible();
  await expect(deleteDialog.getByText(/перемещён в корзину/)).toBeVisible();

  expect((await listDriveItems(page, folderId)).some((item) => String(item.id) === fileId)).toBe(true);
  expect(deleteCalls).toBe(0);

  const deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}`,
  );
  await page.getByTestId('my-files-confirm-action').click();
  expect((await deleteResponsePromise).status()).toBe(204);
  expect(deleteCalls).toBe(1);
  await expect(deleteDialog).toBeHidden();
  await expect(fileCard).toBeHidden();

  expect((await listDriveItems(page, folderId)).some((item) => String(item.id) === fileId)).toBe(false);

  await page.getByTestId('my-files-nav-trash').click();
  await page.waitForURL((url) => url.searchParams.get('view') === 'trash');
  const trashCard = page.getByTestId(`my-files-card-${fileId}`);
  await expect(trashCard).toBeVisible();
  await expect(trashCard).toContainText(renamedName);
  await expect(page.getByTestId(`my-files-restore-${fileId}`)).toBeEnabled();

  const trash = await listTrashEntries(page);
  expect((trash.items || []).some((item) => String(item.id) === fileId)).toBe(true);

  await page.reload();
  await expect(trashCard).toBeVisible({ timeout: 15_000 });

  const restoreResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/trash/files/${fileId}/restore`,
  );
  await page.getByTestId(`my-files-restore-${fileId}`).click();
  expect((await restoreResponsePromise).status()).toBe(204);
  await expect(trashCard).toBeHidden();

  const trashAfterRestore = await listTrashEntries(page);
  expect((trashAfterRestore.items || []).some((item) => String(item.id) === fileId)).toBe(false);

  await page.goto('/my-files');
  await page.getByTestId(`my-files-folder-${folderId}`).click();
  await page.waitForURL((url) => url.searchParams.get('folder') === folderId);
  await expect(fileCard).toBeVisible();

  const restoredRow = (await listDriveItems(page, folderId)).find((item) => String(item.id) === fileId);
  expect(restoredRow).toBeTruthy();
  expect(restoredRow.original_file_name).toBe(renamedName);
  expect(restoredRow.status).toBe('ready');
  expect(restoredRow.original_size_bytes).toBe(payload.length);
  expect(String(restoredRow.folder_id)).toBe(folderId);

  await page.reload();
  await page.waitForURL((url) => url.searchParams.get('folder') === folderId);
  await expect(fileCard).toBeVisible({ timeout: 15_000 });

  const downloadButton = page.getByTestId(`my-files-download-${fileId}`);
  await expect(downloadButton).toBeEnabled();
  await fileCard.hover();
  await downloadAndCheck(page, () => downloadButton.click(), {
    fileName: renamedName,
    payload,
    path: testInfo.outputPath('restored-payload.txt'),
  });
});

test('folder can be trashed and restored through the drive UI', async ({ page }) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'folder lifecycle requires the isolated local stack');

  await login(page);
  await page.goto('/my-files');

  const folderName = `e2e-trash-folder-${Date.now()}`;
  const folder = await createFolderThroughUi(page, folderName);
  const folderId = String(folder.id);
  const folderRow = page.getByTestId(`my-files-folder-${folderId}`);

  await folderRow.click({ button: 'right' });
  await page.getByTestId('folder-action-delete').click();
  const deleteDialog = page.getByRole('dialog', { name: 'Удалить папку' });
  await expect(deleteDialog).toBeVisible();

  const foldersBeforeResponse = await page.request.get('/api/v1/my-files/folders');
  expect(foldersBeforeResponse.status()).toBe(200);
  const foldersBefore = await foldersBeforeResponse.json();
  expect((foldersBefore.items || []).some((entry) => String(entry.id) === folderId)).toBe(true);
  await expect(folderRow).toBeVisible();

  const deleteResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/my-files/folders/${folderId}`,
  );
  await page.getByTestId('my-files-confirm-action').click();
  expect((await deleteResponsePromise).status()).toBe(204);
  await expect(deleteDialog).toBeHidden();
  await expect(folderRow).toBeHidden();

  await page.getByTestId('my-files-nav-trash').click();
  await page.waitForURL((url) => url.searchParams.get('view') === 'trash');
  await expect(folderRow).toBeVisible();
  await expect(folderRow).toContainText(folderName);

  const trash = await listTrashEntries(page);
  expect((trash.folders || []).some((entry) => String(entry.id) === folderId)).toBe(true);

  await page.reload();
  await expect(folderRow).toBeVisible({ timeout: 15_000 });

  const restoreResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/trash/folders/${folderId}/restore`,
  );
  await page.getByTestId(`my-files-restore-folder-${folderId}`).click();
  expect((await restoreResponsePromise).status()).toBe(204);
  await expect(folderRow).toBeHidden();

  const trashAfter = await listTrashEntries(page);
  expect((trashAfter.folders || []).some((entry) => String(entry.id) === folderId)).toBe(false);

  await page.goto('/my-files');
  await expect(folderRow).toBeVisible({ timeout: 15_000 });
  await expect(folderRow).toContainText(folderName);

  const foldersAfterResponse = await page.request.get('/api/v1/my-files/folders');
  expect(foldersAfterResponse.status()).toBe(200);
  const foldersAfter = await foldersAfterResponse.json();
  const restoredFolder = (foldersAfter.items || []).find((entry) => String(entry.id) === folderId);
  expect(restoredFolder).toBeTruthy();
  expect(restoredFolder.parent_id).toBeNull();
});

test('public file link downloads without login and stops working after revoke', async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'public share lifecycle requires the isolated local stack');
  test.skip(process.env.E2E_FILES_WORKER !== '1', 'file lifecycle requires the isolated inline worker');
  test.setTimeout(180_000);

  await login(page);
  await page.goto('/my-files');

  const fileName = `e2e-share-${Date.now()}.txt`;
  const payload = Buffer.from(`e2e public share payload ${Date.now()}\n`);
  const completed = await uploadFileThroughUi(page, { fileName, payload });
  const fileId = String(completed.id);
  const readyRow = await waitForReadyFile(page, fileId);
  expect(readyRow.original_size_bytes).toBe(payload.length);

  const ownerOrigin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ownerOrigin });

  const shareResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}/share`,
  );
  const fileCard = page.getByTestId(`my-files-card-${fileId}`);
  await fileCard.hover();
  await page.getByTestId(`my-files-share-${fileId}`).click();
  const shareResponse = await shareResponsePromise;
  expect(shareResponse.status()).toBe(200);
  const share = await shareResponse.json();
  const shareToken = String(share?.token || '');
  expect(shareToken).not.toBe('');
  expect(String(share?.expires_at || '')).not.toBe('');

  const shareDialog = page.getByRole('dialog').filter({ has: page.getByTestId('my-files-share-url') });
  await expect(shareDialog).toBeVisible();
  const shareUrl = String(await shareDialog.getByTestId('my-files-share-url').textContent() || '').trim();
  const shareUrlParsed = new URL(shareUrl);
  expect(shareUrlParsed.origin).toBe(ownerOrigin);
  expect(shareUrlParsed.pathname).toBe(`/shared-files/${encodeURIComponent(shareToken)}`);
  await expect(shareDialog.getByText(fileName)).toBeVisible();

  await shareDialog.getByRole('button', { name: /Скопировать ссылку|Скопировано/ }).click();
  await expect(shareDialog.getByTestId('my-files-share-copied-alert')).toHaveText('Скопировано');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);

  const sharedRow = (await listDriveItems(page)).find((item) => String(item.id) === fileId);
  expect(sharedRow?.is_shared).toBe(true);

  await shareDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(shareDialog).toBeHidden();

  const publicContext = await browser.newContext({ baseURL: ownerOrigin, acceptDownloads: true });
  const anonymousPage = await publicContext.newPage();
  try {
    const authMeResponse = await publicContext.request.get('/api/v1/auth/me');
    expect(authMeResponse.status()).toBe(401);

    const publicMetaPromise = anonymousPage.waitForResponse(
      (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/my-files/public/${shareToken}`,
    );
    await anonymousPage.goto(shareUrl);
    const publicMetaResponse = await publicMetaPromise;
    expect(publicMetaResponse.status()).toBe(200);
    const publicMeta = await publicMetaResponse.json();
    expect(publicMeta.file_name).toBe(fileName);
    expect(publicMeta.size_bytes).toBe(payload.length);

    await expect(anonymousPage.getByTestId('shared-file-page')).toBeVisible();
    await expect(anonymousPage.getByRole('heading', { level: 1, name: fileName })).toBeVisible();
    expect(new URL(anonymousPage.url()).pathname).toBe(`/shared-files/${encodeURIComponent(shareToken)}`);

    const downloadLink = anonymousPage.getByRole('link', { name: 'Скачать', exact: true });
    await expect(downloadLink).toBeVisible();
    expect(await downloadLink.getAttribute('href')).toBe(`/api/v1/my-files/public/${shareToken}/download`);
    await downloadAndCheck(anonymousPage, () => downloadLink.click(), {
      fileName,
      payload,
      path: testInfo.outputPath('public-share-payload.txt'),
    });

    const authMeAfterDownload = await publicContext.request.get('/api/v1/auth/me');
    expect(authMeAfterDownload.status()).toBe(401);

    await page.reload();
    await expect(fileCard).toBeVisible({ timeout: 15_000 });
    const revokeResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}/share`,
    );
    await fileCard.click({ button: 'right' });
    await page.getByTestId('file-action-revoke-share').click();
    expect((await revokeResponsePromise).status()).toBe(204);

    const revokedRow = (await listDriveItems(page)).find((item) => String(item.id) === fileId);
    expect(revokedRow?.is_shared).toBe(false);

    const revokedMeta = await publicContext.request.get(`/api/v1/my-files/public/${shareToken}`);
    expect(revokedMeta.status()).toBe(404);
    const revokedDownload = await publicContext.request.get(`/api/v1/my-files/public/${shareToken}/download`);
    expect(revokedDownload.status()).toBe(404);

    const refetchPromise = anonymousPage.waitForResponse(
      (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/my-files/public/${shareToken}`,
    );
    await anonymousPage.reload();
    expect((await refetchPromise).status()).toBe(404);
    await expect(anonymousPage.getByRole('alert')).toContainText('Файл недоступен или срок хранения истёк.');
    await expect(anonymousPage.getByRole('link', { name: 'Скачать', exact: true })).toBeHidden();
    expect(new URL(anonymousPage.url()).pathname).toBe(`/shared-files/${encodeURIComponent(shareToken)}`);
  } finally {
    await publicContext.close();
  }

  const grantResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}/download-grant`,
  );
  await fileCard.click({ button: 'right' });
  await downloadAndCheck(page, () => page.getByTestId('file-action-download').click(), {
    fileName,
    payload,
    path: testInfo.outputPath('owner-after-revoke.txt'),
  });
  const grantResponse = await grantResponsePromise;
  expect(grantResponse.status()).toBe(200);
  const grant = await grantResponse.json();
  expect(String(grant.download_path || '')).toMatch(/^\/my-files\/download-grant\/.+/);
});

test('another signed-in user cannot mutate or mint private downloads for the owner file', async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'ownership boundary requires the isolated local stack');
  test.skip(process.env.E2E_FILES_WORKER !== '1', 'file lifecycle requires the isolated inline worker');
  test.skip(!(USERNAME2 && PASSWORD2), 'E2E_USERNAME2/E2E_PASSWORD2 not set');
  test.setTimeout(180_000);

  await login(page);
  await page.goto('/my-files');

  const fileName = `e2e-iso-${Date.now()}.txt`;
  const payload = Buffer.from(`e2e isolation payload ${Date.now()}\n`);
  const completed = await uploadFileThroughUi(page, { fileName, payload });
  const fileId = String(completed.id);
  const readyRow = await waitForReadyFile(page, fileId);
  expect(readyRow.original_size_bytes).toBe(payload.length);

  const ownerOrigin = new URL(page.url()).origin;
  const otherContext = await browser.newContext({ baseURL: ownerOrigin, acceptDownloads: true });
  try {
    const otherPage = await otherContext.newPage();
    await login(otherPage, USERNAME2, PASSWORD2);

    const meResponse = await otherContext.request.get('/api/v1/auth/me');
    expect(meResponse.status()).toBe(200);
    const me = await meResponse.json();
    expect(me.username).toBe(USERNAME2);

    const otherListResponse = await otherContext.request.get('/api/v1/my-files');
    expect(otherListResponse.status()).toBe(200);
    const otherList = await otherListResponse.json();
    expect((otherList.items || []).some((item) => String(item.id) === fileId)).toBe(false);

    await otherPage.goto('/my-files');
    await expect(otherPage.getByTestId('my-files-create-button')).toBeVisible();
    await expect(otherPage.getByTestId(`my-files-card-${fileId}`)).toHaveCount(0);

    const renameAttempt = await otherContext.request.patch(`/api/v1/my-files/${fileId}`, {
      data: { name: 'unauthorized-rename.txt' },
    });
    expect(renameAttempt.status()).toBe(404);

    const grantAttempt = await otherContext.request.post(`/api/v1/my-files/${fileId}/download-grant`);
    expect(grantAttempt.status()).toBe(404);

    const shareAttempt = await otherContext.request.post(`/api/v1/my-files/${fileId}/share`);
    expect(shareAttempt.status()).toBe(404);

    const revokeAttempt = await otherContext.request.delete(`/api/v1/my-files/${fileId}/share`);
    expect(revokeAttempt.status()).toBe(404);

    const deleteAttempt = await otherContext.request.delete(`/api/v1/my-files/${fileId}`);
    expect(deleteAttempt.status()).toBe(404);
  } finally {
    await otherContext.close();
  }

  const ownerRow = (await listDriveItems(page)).find((item) => String(item.id) === fileId);
  expect(ownerRow).toBeTruthy();
  expect(ownerRow.status).toBe('ready');
  expect(ownerRow.original_file_name).toBe(fileName);
  expect(ownerRow.original_size_bytes).toBe(payload.length);
  expect(ownerRow.is_shared).toBe(false);

  await page.reload();
  const fileCard = page.getByTestId(`my-files-card-${fileId}`);
  await expect(fileCard).toBeVisible({ timeout: 15_000 });
  await expect(fileCard).toContainText(fileName);

  await fileCard.hover();
  await downloadAndCheck(page, () => page.getByTestId(`my-files-download-${fileId}`).click(), {
    fileName,
    payload,
    path: testInfo.outputPath('isolation-owner.txt'),
  });
});

test('public folder link downloads the whole subtree as a zip and dies with the share', async ({ page, browser }, testInfo) => {
  test.skip(process.env.E2E_LOCAL !== '1', 'public share lifecycle requires the isolated local stack');
  test.skip(process.env.E2E_FILES_WORKER !== '1', 'file lifecycle requires the isolated inline worker');
  test.setTimeout(240_000);

  await login(page);
  await page.goto('/my-files');

  const stamp = Date.now();
  const outerName = `e2e-share-outer-${stamp}`;
  const innerName = `e2e-share-inner-${stamp}`;
  const outer = await createFolderThroughUi(page, outerName);

  // Inner folder is created through the UI inside the outer folder so the
  // move dialog's folder state already knows it exists.
  await page.getByTestId(`my-files-folder-${outer.id}`).click();
  await page.waitForURL((url) => url.searchParams.get('folder') === String(outer.id));
  const inner = await createFolderThroughUi(page, innerName, { parentId: String(outer.id) });
  const innerId = String(inner.id);
  expect(innerId).not.toBe('');
  await page.goto('/my-files');
  await expect(page.getByTestId(`my-files-folder-${outer.id}`)).toBeVisible({ timeout: 15_000 });

  const fileName = `e2e-folder-share-${stamp}.txt`;
  const payload = Buffer.from(`e2e public folder share payload ${stamp}\n`);
  const completed = await uploadFileThroughUi(page, { fileName, payload });
  const fileId = String(completed.id);
  await waitForReadyFile(page, fileId);

  const fileCard = page.getByTestId(`my-files-card-${fileId}`);
  await fileCard.click({ button: 'right' });
  await page.getByTestId('file-action-move').click();
  const moveDialog = page.getByRole('dialog', { name: 'Переместить в папку' });
  await expect(moveDialog).toBeVisible();
  await moveDialog.getByRole('combobox').click();
  await page.getByRole('option', { name: `${outerName} / ${innerName}`, exact: true }).click();
  const moveResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/v1/my-files/${fileId}`,
  );
  await page.getByTestId('my-files-move-confirm').click();
  const moveResponse = await moveResponsePromise;
  expect(moveResponse.status()).toBe(200);
  const moved = await moveResponse.json();
  expect(String(moved.folder_id)).toBe(innerId);
  await expect(moveDialog).toBeHidden();

  const shareResponsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/folders/${outer.id}/share`,
  );
  await page.getByTestId(`my-files-folder-${outer.id}`).click({ button: 'right' });
  await page.getByTestId('folder-action-share').click();
  const shareResponse = await shareResponsePromise;
  expect(shareResponse.status()).toBe(200);
  const share = await shareResponse.json();
  const shareToken = String(share?.token || '');
  expect(shareToken).not.toBe('');

  const shareDialog = page.getByRole('dialog').filter({ has: page.getByTestId('my-files-share-url') });
  await expect(shareDialog).toBeVisible();
  const shareUrl = String(await shareDialog.getByTestId('my-files-share-url').textContent() || '').trim();
  expect(new URL(shareUrl).pathname).toBe(`/shared-folders/${encodeURIComponent(shareToken)}`);
  await shareDialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(shareDialog).toBeHidden();

  const ownerOrigin = new URL(page.url()).origin;
  const publicContext = await browser.newContext({ baseURL: ownerOrigin, acceptDownloads: true });
  const anonymousPage = await publicContext.newPage();
  try {
    const authMeResponse = await publicContext.request.get('/api/v1/auth/me');
    expect(authMeResponse.status()).toBe(401);

    const publicMetaPromise = anonymousPage.waitForResponse(
      (response) => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/v1/my-files/public-folders/${shareToken}`,
    );
    await anonymousPage.goto(shareUrl);
    expect((await publicMetaPromise).status()).toBe(200);
    await expect(anonymousPage.getByTestId('shared-folder-page')).toBeVisible();
    const sharedRow = anonymousPage.getByTestId(`shared-folder-file-${fileId}`);
    await expect(sharedRow).toBeVisible();
    await expect(sharedRow).toContainText(fileName);
    await expect(sharedRow).toContainText(innerName);

    const zipDownloadPromise = anonymousPage.waitForEvent('download');
    const archiveGrantPromise = anonymousPage.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/api/v1/my-files/public-folders/${shareToken}/archive-grant`,
    );
    await anonymousPage.getByTestId('shared-folder-download-all').click();
    const archiveGrantResponse = await archiveGrantPromise;
    expect(archiveGrantResponse.status()).toBe(200);
    const archiveGrant = await archiveGrantResponse.json();
    expect(String(archiveGrant.download_path || '')).toMatch(/^\/my-files\/download-grant\/.+/);
    const zipDownload = await zipDownloadPromise;
    expect(zipDownload.suggestedFilename()).toBe(`${outerName}.zip`);
    const zipPath = testInfo.outputPath('public-folder.zip');
    await zipDownload.saveAs(zipPath);
    expect(await zipDownload.failure()).toBeNull();
    const entries = unzipSync(await readFile(zipPath));
    expect(Object.keys(entries).sort()).toEqual([`${innerName}/${fileName}`]);
    expect(Buffer.from(entries[`${innerName}/${fileName}`]).equals(payload)).toBe(true);

    await downloadAndCheck(anonymousPage, () => anonymousPage.getByTestId(`shared-folder-download-${fileId}`).click(), {
      fileName,
      payload,
      path: testInfo.outputPath('public-folder-single.txt'),
    });

    const revokeResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/my-files/folders/${outer.id}/share`,
    );
    await page.getByTestId(`my-files-folder-${outer.id}`).click({ button: 'right' });
    await page.getByTestId('folder-action-revoke-share').click();
    expect((await revokeResponsePromise).status()).toBe(204);

    const revokedMeta = await publicContext.request.get(`/api/v1/my-files/public-folders/${shareToken}`);
    expect(revokedMeta.status()).toBe(404);
    const revokedArchiveGrant = await publicContext.request.post(`/api/v1/my-files/public-folders/${shareToken}/archive-grant`);
    expect(revokedArchiveGrant.status()).toBe(404);
    const revokedFileGrant = await publicContext.request.post(`/api/v1/my-files/public-folders/${shareToken}/files/${fileId}/download-grant`);
    expect(revokedFileGrant.status()).toBe(404);
  } finally {
    await publicContext.close();
  }

  const ownerRow = (await listDriveItems(page, innerId)).find((item) => String(item.id) === fileId);
  expect(ownerRow).toBeTruthy();
  expect(ownerRow.status).toBe('ready');
});
