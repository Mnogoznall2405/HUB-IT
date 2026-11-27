import { test, expect } from '@playwright/test';

// ВРЕМЕННЫЙ зонд issue #82 (не часть регрессионного гейта): эхо печати
// композера в двух путях В ОДНОЙ сессии — обычные символы (триггер-скан
// без совпадений) и печать внутри активного `:trigger` (полный reverse-
// поиск по 12k слов на каждый keystroke + рендер списка). Дельта между
// путями изолирует стоимость автоподсказки от машинного шума.
// Время измеряется ЦЕЛИКОМ в браузере: keydown t0 (capture) → rAF-цикл,
// увидевший символ в поле. Без playwright-polling в измерительном окне.

const USERNAME = process.env.E2E_USERNAME;
const PASSWORD = process.env.E2E_PASSWORD;
const USERNAME2 = process.env.E2E_USERNAME2;

test.skip(!USERNAME || !PASSWORD, 'E2E creds required');
test.use({ actionTimeout: 20_000 });

async function apiLogin(page) {
  const resp = await page.request.post('/api/v1/auth/login', {
    data: { username: USERNAME, password: PASSWORD },
  });
  expect(resp.ok()).toBeTruthy();
}

async function ensureDirectConversation(page, peerUsername) {
  const usersResp = await page.request.get('/api/v1/chat/users?limit=50');
  const usersJson = await usersResp.json();
  const users = usersJson.items || usersJson.users || [];
  const peerId = users.find((u) => u.username === peerUsername)?.id;
  const resp = await page.request.post('/api/v1/chat/conversations/direct', {
    data: { peer_user_id: peerId },
  });
  const json = await resp.json();
  return json.id || json.conversation_id;
}

// Один замер эха: вооружаем in-browser ожидание ДО keystroke, keystroke
// идёт через CDP, in-browser rAF-цикл возвращает метку появления символа.
async function echoSample(page, char) {
  await page.evaluate(() => {
    window.__echo = { t0: null, done: null };
    document.addEventListener('keydown', () => {
      if (window.__echo.t0 === null) window.__echo.t0 = performance.now();
    }, { capture: true, once: true });
    const target = document.querySelector('[data-testid="chat-composer-textarea"]');
    const len = target ? target.value.length : 0;
    const tick = () => {
      if (window.__echo.t0 !== null && target && target.value.length > len) {
        window.__echo.done = performance.now() - window.__echo.t0;
        return;
      }
      if (window.__echo.done === null) window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
  await page.keyboard.type(char, { delay: 0 });
  const value = await page.waitForFunction(() => window.__echo.done, null, { timeout: 4000, polling: 50 });
  return value.jsonValue();
}

const stats = (arr) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    n: arr.length,
    p50: Number(q(0.5).toFixed(1)),
    p95: Number(q(0.95).toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
  };
};

test('echo probe: plain typing vs active :trigger typing in one session', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiLogin(page);
  const convId = await ensureDirectConversation(page, USERNAME2);
  await page.goto(`/chat?conversation=${convId}`);
  const composer = page.getByTestId('chat-composer-textarea');
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.click();

  // Прогрев lazy-словаря (idle prefetch) и JIT: измеряем установившийся
  // путь, а не первую загрузку чанка/компиляцию.
  await composer.pressSequentially(':so', { delay: 50 });
  await expect(page.getByTestId('chat-emoji-suggestions')).toBeVisible({ timeout: 10_000 });
  await composer.fill('');
  await page.waitForTimeout(400);

  const SAMPLES = 30;
  // Путь 1: обычная печать — двоеточия в тексте нет, триггер-скан null.
  const plain = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const v = await echoSample(page, 'x');
    if (typeof v === 'number') plain.push(v);
  }
  await composer.fill('');

  // Путь 2: активный триггер — каждый символ гоняет reverse-поиск и
  // рендер списка. Цикл «в → Backspace»: запрос колеблется «:so»↔«:soв»,
  // оба состояния с НЕпустой выдачей — худший честный случай (пустая
  // выдача скрыла бы список и сделала путь дешевле). Замеряются только
  // keystroke'и вставки «в».
  await composer.pressSequentially(':so', { delay: 40 });
  await expect(page.getByTestId('chat-emoji-suggestions')).toBeVisible({ timeout: 10_000 });
  const active = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const v = await echoSample(page, 'c');
    if (typeof v === 'number') active.push(v);
    await page.keyboard.press('Backspace');
  }

  const result = { plain: stats(plain), activeTrigger: stats(active) };
  console.log(`[echo-probe] ${JSON.stringify(result)}`);
  console.log(`[echo-probe] plain raw: ${plain.map((v) => v.toFixed(0)).join(',')}`);
  console.log(`[echo-probe] active raw: ${active.map((v) => v.toFixed(0)).join(',')}`);
});
