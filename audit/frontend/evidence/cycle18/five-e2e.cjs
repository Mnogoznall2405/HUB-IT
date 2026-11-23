#!/usr/bin/env node
/*
 * Cycle 18 — asserted E2E suite with negative controls.
 *
 * Normal run (positive control):
 *   BASE_URL=http://127.0.0.1:5228 NODE_PATH=<frontend>/node_modules \
 *   SHOT_DIR=<audit>/audit/frontend/evidence/cycle18/shots node five-e2e.cjs
 *
 * Negative control (must exit 1):
 *   ONLY=feed NEGATIVE_CONTROL=feed_api_error ... node five-e2e.cjs
 *
 * A scenario is PASS only when every explicit expectation is true. A Playwright
 * call that merely returns without throwing is not enough.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5228';
const SHOT_DIR = process.env.SHOT_DIR || path.join(process.cwd(), 'cycle18-shots');
const USER = process.env.E2E_USER || 'e2e_admin';
const PASS = process.env.E2E_PASS || 'e2e-local-admin-pass';
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chrome';
const PYTHON_BIN = process.env.PREVIEW_PYTHON || 'C:/Project/HUB-IT-main/.venv/Scripts/python.exe';
const PNG_64_RED = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAgUlEQVR4nNXOMREAIBDAsFIhzPhXgSxE/MA1CrLuPpRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMRJnMT5OzD1ACX1AY6ZEfHAAAAAAElFTkSuQmCC';
const CONTROL = String(process.env.NEGATIVE_CONTROL || '').split(',').map((s) => s.trim()).filter(Boolean);
const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const state = {};
const results = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class AssertionError extends Error {}

function makeExpect(checks) {
  return function expect(name, condition, detail, options) {
    const ok = Boolean(condition);
    const mandatory = !options || options.mandatory !== false;
    checks.push({ name, ok, detail: detail === undefined ? null : detail, mandatory });
    return ok;
  };
}

async function login(page) {
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username', { timeout: 15000 });
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForTimeout(500);
}

async function api(page, pathname) {
  return page.evaluate(async (p) => {
    const res = await fetch(p, { credentials: 'include' });
    let json = null;
    try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }, pathname);
}

function itemsOf(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.items)) return json.items;
  return [];
}

async function pollApi(page, pathname, predicate, timeoutMs = 15000) {
  const started = Date.now();
  let last = { status: 0, json: null };
  while (Date.now() - started < timeoutMs) {
    last = await api(page, pathname);
    try {
      if (predicate(last.json)) return last;
    } catch (e) {}
    await sleep(300);
  }
  return last;
}

function countBy(items, field, value) {
  return items.filter((item) => String(item?.[field] ?? '') === String(value)).length;
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

async function installControls(context) {
  if (!CONTROL.length) return;
  const has = (name) => CONTROL.includes(name);

  if (has('login_timeout')) {
    await context.route('**/api/v1/auth/login', async () => {
      await new Promise(() => {});
    });
  }
  if (has('feed_api_error')) {
    await context.route('**/api/v1/hub/announcements', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'cycle18 injected feed failure' }) });
      } else {
        await route.continue();
      }
    });
  }
  if (has('feed_wrong_record')) {
    await context.route('**/api/v1/hub/announcements*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      let text = await response.text();
      if (state.feedToken) text = text.split(state.feedToken).join(`CORRUPTED-${state.feedToken}`);
      await route.fulfill({ response, body: text });
    });
  }
  if (has('tasks_save_noop')) {
    await context.route('**/api/v1/hub/tasks/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      } else {
        await route.continue();
      }
    });
  }
  if (has('tasks_duplicate')) {
    await context.route('**/api/v1/hub/tasks*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.pathname !== '/api/v1/hub/tasks') return route.continue();
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (json && Array.isArray(json.items) && state.taskToken) {
        const found = json.items.find((i) => i.title === state.taskToken);
        if (found) json.items = [...json.items, { ...found, id: `${found.id}-duplicate` }];
      }
      await route.fulfill({ response, json });
    });
  }
  if (has('chat_duplicate')) {
    await context.route('**/api/v1/chat/conversations/*/messages*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (json && Array.isArray(json.items)) {
        const wanted = [state.chatToken, state.chatToken2].filter(Boolean);
        const found = json.items.find((m) => wanted.includes(m.body));
        if (found) json.items = [...json.items, { ...found, id: `${found.id}-duplicate` }];
      }
      await route.fulfill({ response, json });
    });
  }
  if (has('myfiles_hide') || has('myfiles_duplicate')) {
    await context.route('**/api/v1/my-files*', async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET' || url.pathname !== '/api/v1/my-files') return route.continue();
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (json && Array.isArray(json.items) && state.myFileName) {
        if (has('myfiles_hide')) {
          json.items = json.items.filter((i) => i.original_file_name !== state.myFileName);
        } else {
          const found = json.items.find((i) => i.original_file_name === state.myFileName);
          if (found) json.items = [...json.items, { ...found, id: `${found.id}-duplicate` }];
        }
      }
      await route.fulfill({ response, json });
    });
  }
  if (has('admin_hide') || has('admin_duplicate')) {
    await context.route('**/api/v1/auth/users', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (Array.isArray(json) && state.adminLogin) {
        if (has('admin_hide')) {
          const filtered = json.filter((u) => u.username !== state.adminLogin);
          await route.fulfill({ response, json: filtered });
          return;
        }
        const found = json.find((u) => u.username === state.adminLogin);
        if (found) json.push({ ...found, id: `${found.id}-duplicate` });
      }
      await route.fulfill({ response, json });
    });
  }
}

async function scenario(name, fn) {
  const started = Date.now();
  const checks = [];
  const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const record = { name, pass: false, ms: 0, checks, details: {}, error: null };
  try {
    await installControls(context);
    record.details = (await fn(context, makeExpect(checks))) || {};
  } catch (error) {
    record.error = String(error && error.message ? error.message : error).slice(0, 700);
    const pages = context.pages();
    if (pages.length) record.details.failureShot = await shot(pages[pages.length - 1], `fail-${name}`);
  } finally {
    const failed = checks.filter((c) => c.mandatory && !c.ok);
    record.pass = !record.error && failed.length === 0 && checks.some((c) => c.mandatory);
    record.failedChecks = failed;
    record.observations = checks.filter((c) => !c.mandatory && !c.ok);
    record.ms = Date.now() - started;
    await browser.close();
    results.push(record);
    console.log(JSON.stringify({ name: record.name, pass: record.pass, checks: checks.length, failed: failed.length, failedChecks: failed.map((c) => c.name), controls: CONTROL, observations: record.observations.length, error: record.error, details: record.details }));
  }
  return record;
}

async function feed(ctx, expect) {
  const token = `AUDIT-C18-FEED-${runId}`;
  state.feedToken = token;
  const page = await ctx.newPage();
  await login(page);
  await page.goto('/feed', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.getByText('Создать запись', { exact: true }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel(/Заголовок/).first().fill(token);
  await dialog.getByPlaceholder(/Расскажите подробнее/).first().fill(`Cycle18 body ${token}`);
  await dialog.getByRole('button', { name: 'Опубликовать' }).first().click();
  try { await dialog.waitFor({ state: 'detached', timeout: 15000 }); } catch (e) {}
  expect('feed.dialogClosed', (await page.getByRole('dialog').count()) === 0);
  const afterPublish = await page.locator('body').innerText();
  expect('feed.visibleAfterPublish', afterPublish.includes(token));

  const listPath = '/api/v1/hub/announcements?limit=50';
  const polled = await pollApi(page, listPath, (json) => countBy(itemsOf(json), 'title', token) >= 1);
  const items = itemsOf(polled.json);
  const matches = items.filter((i) => i.title === token);
  expect('feed.apiCreated', matches.length === 1, { count: matches.length });
  expect('feed.apiUnique', matches.length === 1, { count: matches.length });
  expect('feed.apiRecordId', Boolean(matches[0]?.id), { id: matches[0]?.id || null });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const afterReload = await page.locator('body').innerText();
  expect('feed.visibleAfterReload', afterReload.includes(token));
  const polledReload = await pollApi(page, listPath, (json) => countBy(itemsOf(json), 'title', token) === 1);
  const matchesReload = itemsOf(polledReload.json).filter((i) => i.title === token);
  expect('feed.persistedAfterReload', matchesReload.length === 1, { count: matchesReload.length });
  const kept = itemsOf(polledReload.json).filter((i) => i.title === token);
  expect('feed.sameRecordAfterReload', kept.length === 1 && kept[0].id === matches[0]?.id, { before: matches[0]?.id, after: kept[0]?.id });
  const shotFile = await shot(page, `feed-${runId}`);
  return { token, matches: matches.length, afterReload: matchesReload.length, shot: shotFile };
}

async function tasks(ctx, expect) {
  const token = `AUDIT-C18-TASK-${runId}`;
  const edited = `edited-${token}`;
  state.taskToken = token;
  const page = await ctx.newPage();
  await login(page);
  await page.goto('/tasks', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Новая задача' }).click();
  let dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel('Что нужно сделать').fill(token);
  await dialog.getByLabel('Описание').first().fill(`initial ${token}`);
  await dialog.getByLabel('Исполнители').first().fill(USER);
  await page.waitForTimeout(1400);
  const option = page.getByRole('option').first();
  if (await option.count()) await option.click().catch(() => {});
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 });

  const listPath = '/api/v1/hub/tasks?limit=100';
  const createdPoll = await pollApi(page, listPath, (json) => countBy(itemsOf(json), 'title', token) >= 1);
  const createdItems = itemsOf(createdPoll.json).filter((i) => i.title === token);
  expect('tasks.createdInApi', createdItems.length === 1, { count: createdItems.length });
  expect('tasks.uniqueAfterCreate', createdItems.length === 1, { count: createdItems.length });
  expect('tasks.createdId', Boolean(createdItems[0]?.id), { id: createdItems[0]?.id || null });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const afterReloadBody = await page.locator('body').innerText();
  expect('tasks.visibleAfterReload', afterReloadBody.includes(token));
  const reloadPoll = await pollApi(page, listPath, (json) => countBy(itemsOf(json), 'title', token) === 1);
  const reloadItems = itemsOf(reloadPoll.json).filter((i) => i.title === token);
  expect('tasks.persistedAfterReload', reloadItems.length === 1, { count: reloadItems.length });

  await page.getByText(token).first().click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Редактировать' }).first().click();
  dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel('Описание').first().fill(edited);
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 });
  const editedVisible = (await page.locator('body').innerText()).includes(edited);
  expect('tasks.editedVisible', editedVisible);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2300);
  const editedAfterReload = (await page.locator('body').innerText()).includes(edited);
  expect('tasks.editedAfterReload', editedAfterReload);
  const detail = await api(page, `/api/v1/hub/tasks/${encodeURIComponent(createdItems[0].id)}`);
  expect('tasks.descriptionPersisted', detail.status === 200 && detail.json?.description === edited, { status: detail.status, description: detail.json?.description || null });

  const chkToken = `AUDIT-C18-CHK-${runId}`;
  const stepText = `step ${chkToken}`;
  await page.goto('/tasks', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Новая задача' }).click();
  dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel('Что нужно сделать').fill(chkToken);
  await dialog.getByLabel('Исполнители').first().fill(USER);
  await page.waitForTimeout(1400);
  const opt2 = page.getByRole('option').first();
  if (await opt2.count()) await opt2.click().catch(() => {});
  await dialog.getByRole('button', { name: 'Чек-листы' }).click();
  await page.waitForTimeout(500);
  const item = dialog.locator('input[placeholder="Пункт 1"]').first();
  await item.fill(stepText);
  await item.press('Enter');
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 15000 });
  const chkPoll = await pollApi(page, listPath, (json) => countBy(itemsOf(json), 'title', chkToken) >= 1);
  const chkItems = itemsOf(chkPoll.json).filter((i) => i.title === chkToken);
  expect('tasks.checklistTaskCreated', chkItems.length === 1, { count: chkItems.length });
  const chkDetail = chkItems[0] ? await api(page, `/api/v1/hub/tasks/${encodeURIComponent(chkItems[0].id)}`) : { status: 0, json: null };
  const steps = Array.isArray(chkDetail.json?.checklist_items) ? chkDetail.json.checklist_items : [];
  const stepMatches = steps.filter((s) => s.text === stepText);
  expect('tasks.checklistPersistedInApi', stepMatches.length === 1, { count: stepMatches.length, total: steps.length });
  await page.getByText(chkToken).first().click();
  await page.waitForTimeout(2000);
  expect('tasks.checklistVisibleInCard', (await page.locator('body').innerText()).includes(stepText));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2300);
  expect('tasks.checklistAfterReload', (await page.locator('body').innerText()).includes(stepText));
  const chkDetail2 = chkItems[0] ? await api(page, `/api/v1/hub/tasks/${encodeURIComponent(chkItems[0].id)}`) : { status: 0, json: null };
  const steps2 = Array.isArray(chkDetail2.json?.checklist_items) ? chkDetail2.json.checklist_items : [];
  expect('tasks.checklistUniqueAfterReload', steps2.filter((s) => s.text === stepText).length === 1);
  expect('tasks.noTaskDuplicates', itemsOf(reloadPoll.json).filter((i) => i.title === token).length === 1 && chkItems.length === 1);
  const shotFile = await shot(page, `tasks-${runId}`);
  return { token, created: createdItems.length, editedAfterReload, checklist: stepMatches.length, shot: shotFile };
}

async function chat(ctx, expect) {
  const token = `AUDIT-C18-CHAT-${runId}`;
  const token2 = `${token}-B`;
  state.chatToken = token;
  state.chatToken2 = token2;
  const page = await ctx.newPage();
  await login(page);
  await page.goto('/chat', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByTitle('Заметки').first().click();
  await page.waitForTimeout(900);
  const composer = page.getByLabel('Сообщение').first();
  await composer.fill(token);
  await composer.press('Enter');
  await page.waitForFunction((t) => document.body.innerText.includes(t), token, { timeout: 15000 });
  expect('chat.firstTabSeesFirst', (await page.locator('body').innerText()).includes(token));

  const page2 = await ctx.newPage();
  await page2.goto('/chat', { waitUntil: 'load' });
  await page2.waitForTimeout(2200);
  await page2.getByTitle('Заметки').first().click();
  await page2.waitForFunction((t) => document.body.innerText.includes(t), token, { timeout: 15000 });
  expect('chat.secondTabSeesFirst', (await page2.locator('body').innerText()).includes(token));
  const composer2 = page2.getByLabel('Сообщение').first();
  await composer2.fill(token2);
  await composer2.press('Enter');
  await page.waitForFunction((t) => document.body.innerText.includes(t), token2, { timeout: 15000 });
  expect('chat.firstTabSeesSecond', (await page.locator('body').innerText()).includes(token2));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByTitle('Заметки').first().click();
  await page.waitForTimeout(1800);
  const body = await page.locator('body').innerText();
  expect('chat.firstAfterReload', body.includes(token));
  expect('chat.secondAfterReload', body.includes(token2));

  const conv = await api(page, '/api/v1/chat/conversations');
  const notes = itemsOf(conv.json).find((c) => c.kind === 'notes');
  expect('chat.notesConversationFound', Boolean(notes));
  const messages = notes ? await api(page, `/api/v1/chat/conversations/${encodeURIComponent(notes.id)}/messages?limit=200`) : { status: 0, json: null };
  const bodies = itemsOf(messages.json).map((m) => m.body || '');
  const firstCount = bodies.filter((b) => b === token).length;
  const secondCount = bodies.filter((b) => b === token2).length;
  expect('chat.apiFirstCount', firstCount === 1, { count: firstCount });
  expect('chat.apiSecondCount', secondCount === 1, { count: secondCount });
  expect('chat.apiDuplicatesZero', bodies.filter((b, i) => bodies.indexOf(b) !== i && (b === token || b === token2)).length === 0);
  const shotFile = await shot(page, `chat-${runId}`);
  return { token, firstCount, secondCount, shot: shotFile };
}

async function myFiles(ctx, expect) {
  const name = `audit-c18-${runId}.png`;
  const localFile = path.join(SHOT_DIR, name);
  fs.writeFileSync(localFile, Buffer.from(PNG_64_RED, 'base64'));
  state.myFileName = name;
  const page = await ctx.newPage();
  await login(page);
  await page.goto('/my-files', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.locator('input[type=file]').first().setInputFiles(localFile);
  await page.waitForTimeout(900);
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByRole('button', { name: 'Загрузить' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 20000 });
  expect('myfiles.uploadDialogClosed', (await page.getByRole('dialog').count()) === 0);

  const previewPoll = await pollApi(
    page,
    '/api/v1/my-files',
    (json) => {
      const found = itemsOf(json).filter((i) => i.original_file_name === name);
      return found.length === 1 && found[0].preview_available === true;
    },
    30000,
  );
  const uploaded = itemsOf(previewPoll.json).filter((i) => i.original_file_name === name);
  expect('myfiles.createdInApi', uploaded.length === 1, { count: uploaded.length });
  expect('myfiles.uniqueAfterUpload', uploaded.length === 1, { count: uploaded.length });
  const item = uploaded[0];
  state.myFileId = item?.id || '';
  expect('myfiles.previewReady', Boolean(item?.preview_available), { status: item?.preview_status || null });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const search = page.getByLabel(/Поиск файла или папки по всему диску/).first();
  await search.fill(name);
  await page.waitForTimeout(1800);
  const body = await page.locator('body').innerText();
  expect('myfiles.visibleAfterReload', body.includes(name));
  expect('myfiles.searchFindsFile', body.includes(name));
  const list = await api(page, '/api/v1/my-files');
  const afterReload = itemsOf(list.json).filter((i) => i.original_file_name === name);
  expect('myfiles.apiUniqueAfterReload', afterReload.length === 1, { count: afterReload.length });

  let previewApi = { status: 0, type: '', bytes: [] };
  let previewPixels = null;
  if (item?.id) {
    await page.getByTestId(`my-files-menu-file-${item.id}`).click({ force: true });
    await page.waitForTimeout(500);
    await page.getByRole('menuitem', { name: 'Просмотр' }).first().click();
    const previewDialog = page.getByRole('dialog').first();
    await previewDialog.waitFor({ timeout: 15000 });
    expect('myfiles.previewDialogOpened', (await page.getByRole('dialog').count()) >= 1);
    const previewImg = await previewDialog.locator('img').first().getAttribute('alt').catch(() => null);
    expect('myfiles.previewImageShown', Boolean(previewImg), { alt: previewImg || null });

    previewApi = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/my-files/${id}/preview/content`, { credentials: 'include' });
      const buf = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, type: res.headers.get('content-type') || '', bytes: Array.from(buf) };
    }, item.id);
    expect('myfiles.previewApiImage', previewApi.status === 200 && previewApi.type.startsWith('image/'), { status: previewApi.status, type: previewApi.type, bytes: previewApi.bytes.length });
    const previewImgLocator = previewDialog.locator('img').first();
    await previewImgLocator.waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('[role="dialog"] img');
      return Boolean(img && img.complete && img.naturalWidth > 0);
    }, { timeout: 10000 });
    const pixel = await previewImgLocator.evaluate((img) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      const p = g.getImageData(32, 32, 1, 1).data;
      return { width: img.naturalWidth, height: img.naturalHeight, rgba: [p[0], p[1], p[2], p[3]] };
    });
    previewPixels = { width: pixel.width, height: pixel.height, rgb: pixel.rgba.slice(0, 3) };
    const pixelOk = pixel.width === 64 && pixel.height === 64
      && Math.abs(pixel.rgba[0] - 200) <= 5 && Math.abs(pixel.rgba[1] - 30) <= 5 && Math.abs(pixel.rgba[2] - 40) <= 5;
    expect('myfiles.previewHasFactualContent', pixelOk, previewPixels);
    if (previewApi.bytes.length) {
      const previewPath = path.join(SHOT_DIR, `preview-${runId}.bin`);
      fs.writeFileSync(previewPath, Buffer.from(previewApi.bytes));
      const py = [
        'from PIL import Image',
        `im=Image.open(r"${previewPath.replace(/\\/g, '/')}")`,
        'im.load()',
        'print("ok")',
      ].join('\n');
      try {
        const out = execFileSync(PYTHON_BIN, ['-c', py], { encoding: 'utf8' }).trim();
        expect('myfiles.previewArtifactDecodes', out === 'ok', out, { mandatory: false });
      } catch (error) {
        expect('myfiles.previewArtifactDecodes', false, String(error.stderr || error.message).slice(-160), { mandatory: false });
      }
    }
  }
  const shotFile = await shot(page, `myfiles-${runId}`);
  return { name, apiCount: afterReload.length, previewReady: Boolean(item?.preview_available), previewPixels, shot: shotFile };
}

async function adminUsers(ctx, expect) {
  const loginName = `audit_c18_${runId.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
  state.adminLogin = loginName;
  const password = 'AuditC18!pass123';
  const page = await ctx.newPage();
  await login(page);
  await page.goto('/admin/users', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await page.waitForTimeout(1000);
  const drawer = page.locator('.MuiDrawer-paper').filter({ hasText: 'Логин' }).last();
  await drawer.getByLabel('Логин', { exact: true }).fill(loginName);
  await drawer.getByLabel('Пароль', { exact: true }).fill(password);
  await drawer.getByLabel('ФИО', { exact: true }).fill('Audit C18 User');
  await drawer.getByRole('button', { name: 'Сохранить' }).first().click();

  const poll = await pollApi(page, '/api/v1/auth/users', (json) => countBy(itemsOf(json), 'username', loginName) >= 1);
  const users = itemsOf(poll.json).filter((u) => u.username === loginName);
  expect('admin.createdInApi', users.length === 1, { count: users.length });
  expect('admin.uniqueAfterCreate', users.length === 1, { count: users.length });
  expect('admin.createdId', Boolean(users[0]?.id), { id: users[0]?.id || null });

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const search = page.getByLabel('Поиск пользователя').first();
  if (await search.count()) {
    await search.fill(loginName);
    await page.waitForTimeout(1500);
  }
  const body = await page.locator('body').innerText();
  expect('admin.visibleAfterReload', body.includes(loginName));
  expect('admin.searchReturnsCreated', body.includes(loginName));
  const list = await api(page, '/api/v1/auth/users');
  const afterReload = itemsOf(list.json).filter((u) => u.username === loginName);
  expect('admin.apiUniqueAfterReload', afterReload.length === 1, { count: afterReload.length });
  const shotFile = await shot(page, `admin-${runId}`);
  return { loginName, apiCount: afterReload.length, shot: shotFile };
}

(async () => {
  console.log(JSON.stringify({ base: BASE, runId, shotDir: SHOT_DIR, controls: CONTROL }));
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
  const scenarios = [
    ['feed', feed],
    ['tasks', tasks],
    ['chat', chat],
    ['myFiles', myFiles],
    ['adminUsers', adminUsers],
  ].filter(([name]) => !only || only.includes(name));
  for (const [name, fn] of scenarios) await scenario(name, fn);
  const summary = results.map((r) => ({ name: r.name, pass: r.pass, ms: r.ms, checks: r.checks.length, failed: r.failedChecks.length, observations: (r.observations || []).length, error: r.error }));
  fs.writeFileSync(path.join(SHOT_DIR, `results-${runId}.json`), JSON.stringify({ base: BASE, runId, controls: CONTROL, results }, null, 2));
  console.log('SUMMARY ' + JSON.stringify(summary));
  process.exit(summary.some((s) => !s.pass) ? 1 : 0);
})();



