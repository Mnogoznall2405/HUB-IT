#!/usr/bin/env node
/*
 * Cycle 17 reproducible E2E suite.
 *
 * Prerequisites:
 *   - isolated backend from the same SHA (e2e/stack/local_backend.py)
 *   - static frontend build from the same SHA
 *   - Playwright available via NODE_PATH or PLAYWRIGHT_MODULE
 *
 * Run (from WEB-itinvent/frontend):
 *   $env:BASE_URL='http://127.0.0.1:5227'
 *   $env:NODE_PATH='C:\path\to\frontend\node_modules'
 *   $env:SHOT_DIR='C:\path\to\audit\frontend\evidence\cycle17\shots'
 *   node audit/frontend/evidence/cycle17/five-e2e.cjs
 *
 * Only local test credentials are used. No production calls.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5227';
const SHOT_DIR = process.env.SHOT_DIR || path.join(process.cwd(), 'cycle17-shots');
const USER = process.env.E2E_USER || 'e2e_admin';
const PASS = process.env.E2E_PASS || 'e2e-local-admin-pass';
const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const results = [];

fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(context) {
  const page = await context.newPage();
  await page.goto('/login', { waitUntil: 'load' });
  await page.waitForSelector('#login-username', { timeout: 15000 });
  await page.fill('#login-username', USER);
  await page.fill('#login-password', PASS);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForTimeout(600);
  return page;
}

async function shot(page, name) {
  const file = path.join(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

async function scenario(name, fn) {
  const started = Date.now();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const record = { name, pass: false, ms: 0, details: {}, error: null };
  try {
    record.details = (await fn(context, record)) || {};
    record.pass = true;
  } catch (error) {
    record.error = String(error && error.message ? error.message : error).slice(0, 500);
    const pages = context.pages();
    if (pages.length) record.details.failureShot = await shot(pages[pages.length - 1], `fail-${name}`);
  } finally {
    record.ms = Date.now() - started;
    await browser.close();
    results.push(record);
    console.log(JSON.stringify(record));
  }
  return record;
}

async function feed(ctx) {
  const token = `AUDIT-C17-FEED-${runId}`;
  const page = await login(ctx);
  await page.goto('/feed', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.getByText('Создать запись', { exact: true }).first().click();
  const dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel(/Заголовок/).first().fill(token);
  await dialog.getByPlaceholder(/Расскажите подробнее/).first().fill(`Cycle17 body ${token}`);
  await dialog.getByRole('button', { name: 'Опубликовать' }).first().click();
  await page.waitForTimeout(3500);
  const afterPublish = await page.locator('body').innerText();
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const afterReload = await page.locator('body').innerText();
  const shotFile = await shot(page, `feed-${runId}`);
  return {
    token,
    visibleAfterPublish: afterPublish.includes(token),
    visibleAfterReload: afterReload.includes(token),
    dialogClosed: (await page.getByRole('dialog').count()) === 0,
    shot: shotFile,
  };
}

async function tasks(ctx) {
  const token = `AUDIT-C17-TASK-${runId}`;
  const edited = `edited-${token}`;
  const page = await login(ctx);
  await page.goto('/tasks', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Новая задача' }).click();
  let dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel('Что нужно сделать').fill(token);
  await dialog.getByLabel('Описание').first().fill(`initial ${token}`);
  await dialog.getByLabel('Исполнители').first().fill(USER);
  await page.waitForTimeout(1500);
  const option = page.getByRole('option').first();
  if (await option.count()) await option.click().catch(() => {});
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  await page.waitForTimeout(3500);
  const created = (await page.locator('body').innerText()).includes(token);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const afterReload = (await page.locator('body').innerText()).includes(token);
  await page.getByText(token).first().click();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Редактировать' }).first().click();
  dialog = page.getByRole('dialog').first();
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByLabel('Описание').first().fill(edited);
  await dialog.getByRole('button', { name: 'Сохранить изменения' }).click();
  await page.waitForTimeout(3000);
  const editedVisible = (await page.locator('body').innerText()).includes(edited);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const editedAfterReload = (await page.locator('body').innerText()).includes(edited);
  const shotFile = await shot(page, `tasks-${runId}`);

  // checklist task
  const chkToken = `AUDIT-C17-CHK-${runId}`;
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
  await page.waitForTimeout(600);
  const item = dialog.locator('input[placeholder="Пункт 1"]').first();
  await item.fill(stepText);
  await item.press('Enter');
  await page.waitForTimeout(500);
  await dialog.getByRole('button', { name: 'Создать задачу' }).click();
  await page.waitForTimeout(3500);
  await page.getByText(chkToken).first().click();
  await page.waitForTimeout(2200);
  const checklistVisible = (await page.locator('body').innerText()).includes(stepText);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const checklistAfterReload = (await page.locator('body').innerText()).includes(stepText);
  return {
    token,
    created,
    afterReload,
    editedVisible,
    editedAfterReload,
    chkToken,
    checklistVisible,
    checklistAfterReload,
    shot: shotFile,
  };
}

async function chat(ctx) {
  const token = `AUDIT-C17-CHAT-${runId}`;
  const token2 = `${token}-B`;
  const page = await login(ctx);
  await page.goto('/chat', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByTitle('Заметки').first().click();
  await page.waitForTimeout(1200);
  const composer = page.getByLabel('Сообщение').first();
  await composer.fill(token);
  await composer.press('Enter');
  await page.waitForTimeout(2200);

  const page2 = await ctx.newPage();
  await page2.goto('/chat', { waitUntil: 'load' });
  await page2.waitForTimeout(2200);
  await page2.getByTitle('Заметки').first().click();
  await page2.waitForTimeout(1800);
  const secondTabSees = (await page2.locator('body').innerText()).includes(token);
  const composer2 = page2.getByLabel('Сообщение').first();
  await composer2.fill(token2);
  await composer2.press('Enter');
  await page2.waitForTimeout(2200);
  const firstTabSeesSecond = (await page.locator('body').innerText()).includes(token2);

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByTitle('Заметки').first().click();
  await page.waitForTimeout(2000);
  const body = await page.locator('body').innerText();
  const shotFile = await shot(page, `chat-${runId}`);

  const conv = await page.evaluate(async () => {
    const res = await fetch('/api/v1/chat/conversations', { credentials: 'include' });
    return { status: res.status, json: await res.json().catch(() => null) };
  });
  const notes = ((conv.json && conv.json.items) || []).find((c) => c.kind === 'notes');
  let apiBodies = [];
  let messagesStatus = null;
  if (notes) {
    const msg = await page.evaluate(async (id) => {
      const res = await fetch(`/api/v1/chat/conversations/${id}/messages?limit=200`, { credentials: 'include' });
      return { status: res.status, json: await res.json().catch(() => null) };
    }, notes.id);
    messagesStatus = msg.status;
    const arr = msg.json && Array.isArray(msg.json.items) ? msg.json.items : [];
    apiBodies = arr.map((m) => m.body || '');
  }
  const occurrences = apiBodies.filter((b) => b === token || b === token2).length;
  const duplicates = apiBodies.filter((b, i) => apiBodies.indexOf(b) !== i && (b === token || b === token2)).length;
  return {
    token,
    token2,
    secondTabSees,
    firstTabSeesSecond,
    visibleAfterReloadA: body.includes(token),
    visibleAfterReloadB: body.includes(token2),
    conversationsStatus: conv.status,
    messagesStatus,
    apiOccurrences: occurrences,
    apiDuplicates: duplicates,
    shot: shotFile,
  };
}

async function myFiles(ctx) {
  const name = `audit-c17-${runId}.txt`;
  const content = `cycle17 upload ${runId}`;
  const localFile = path.join(SHOT_DIR, name);
  fs.writeFileSync(localFile, content + '\n', 'utf8');
  const page = await login(ctx);
  await page.goto('/my-files', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.locator('input[type=file]').first().setInputFiles(localFile);
  await page.waitForTimeout(1200);
  const dialog = page.getByRole('dialog').first();
  await dialog.getByRole('button', { name: 'Загрузить' }).click();
  await page.waitForTimeout(4500);
  const dialogClosed = (await page.getByRole('dialog').count()) === 0;
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const search = page.getByLabel(/Поиск файла или папки по всему диску/).first();
  await search.fill(name);
  await page.waitForTimeout(1800);
  const visibleAfterReload = (await page.locator('body').innerText()).includes(name);
  let previewHasContent = false;
  if (visibleAfterReload) {
    await page.getByText(name, { exact: true }).first().click();
    await page.waitForTimeout(1800);
    previewHasContent = (await page.locator('body').innerText()).includes(content);
  }
  const shotFile = await shot(page, `myfiles-${runId}`);
  return { name, dialogClosed, visibleAfterReload, previewHasContent, shot: shotFile };
}

async function adminUsers(ctx) {
  const loginName = `audit_c17_${runId.replace('-', '_')}`;
  const password = 'AuditC17!pass123';
  const page = await login(ctx);
  await page.goto('/admin/users', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Новый пользователь' }).click();
  await page.waitForTimeout(1200);
  const drawer = page.locator('.MuiDrawer-paper').filter({ hasText: 'Логин' }).last();
  await drawer.getByLabel('Логин', { exact: true }).fill(loginName);
  await drawer.getByLabel('Пароль', { exact: true }).fill(password);
  await drawer.getByLabel('ФИО', { exact: true }).fill('Audit C17 User');
  await drawer.getByRole('button', { name: 'Сохранить' }).first().click();
  await page.waitForTimeout(3500);
  const created = (await page.locator('body').innerText()).includes(loginName);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const search = page.getByLabel('Поиск пользователя').first();
  if (await search.count()) {
    await search.fill(loginName);
    await page.waitForTimeout(1500);
  }
  const visibleAfterReload = (await page.locator('body').innerText()).includes(loginName);
  const shotFile = await shot(page, `admin-${runId}`);
  return { loginName, created, visibleAfterReload, shot: shotFile };
}

(async () => {
  console.log(JSON.stringify({ base: BASE, runId, shotDir: SHOT_DIR }));
  const only = process.env.ONLY ? process.env.ONLY.split(',').map((s) => s.trim()) : null;
  const scenarios = [
    ['feed', feed],
    ['tasks', tasks],
    ['chat', chat],
    ['myFiles', myFiles],
    ['adminUsers', adminUsers],
  ].filter(([name]) => !only || only.includes(name));
  for (const [name, fn] of scenarios) await scenario(name, fn);
  const summary = results.map((r) => ({ name: r.name, pass: r.pass, ms: r.ms, error: r.error }));
  fs.writeFileSync(path.join(SHOT_DIR, `results-${runId}.json`), JSON.stringify({ base: BASE, runId, results }, null, 2));
  console.log('SUMMARY ' + JSON.stringify(summary));
  const failed = summary.filter((s) => !s.pass);
  process.exit(failed.length ? 1 : 0);
})();

