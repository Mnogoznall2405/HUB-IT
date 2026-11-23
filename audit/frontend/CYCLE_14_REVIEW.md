# CYCLE 14 — runtime-покрытие и критические сценарии

- Дата: 2026-11-23
- База: PR #9, audit-коммит `d2fe61a7`; проверка кода на HEAD `5513db68` (main после merge PR #11).
- Изолированный стенд: `e2e/stack/local_backend.py` (SQLite `.state-cycle14`, 18002), отдельный 2FA-стенд (`.state-cycle14-2fa`, 18004), vite 5219/5222, trial-сборка вне `dist` + локальный прокси 5223.
- Production, IIS, PM2, `.env` и реальные данные не затрагивались.

## 1. Итог

| Показатель | Значение |
|---|---|
| Записей в реестре | **323** |
| Статусы | Confirmed 269 / Suspected 11 / Fixed-externally 2 / Rejected 41 |
| Severity | High 12 / Medium 123 / Low 173 / Info 15 |
| Новые подтверждённые дефекты | 0 новых ID; FE-0253 **опровергнут** |
| High с новым browser/API-доказательством | **4** (FE-0197, FE-0198, FE-0083, FE-0023) |
| Дефектов проверено в браузере за цикл | **7** подтверждены/опровергнуты + 2 попытки заблокированы |
| Новых маршрутов с функциональными сценариями | **12** (всего 24/36 = 66.7%) |
| Осталось Suspected | 11 |

## 2. Исправления схемы и предыдущих неточностей

### 2.1. FE-0253 — опровергнут

12 раундов × 8 SPA-маршрутов, `HeapProfiler.collectGarbage` перед каждым чтением:

`37.1 → 47.7 → 49.0 → 49.5 → 50.3 → 50.6 → 50.7 → 50.9 → 23.3 → 44.6 → 48.3 → 49.2 MB`

Плато ~49–51 MB, после полного GC — 23 MB. Монотонного роста нет; исходные 85→143 MB были GC/lazy-chunk шумом. Статус переведён в **Rejected**.

### 2.2. FE-0194, FE-0300, FE-0324 — почему не Confirmed

У всех трёх положительный статический вердикт, но нет пользовательского эффекта в доступной среде:

- **FE-0194** — краш требует частичного `patchTarget({id, summary})` без `name` при рассинхронизации списка и детали; в БД `name NOT NULL`, сценарий не воспроизведён.
- **FE-0300** — усечение требует >200 диалогов на хост; такого набора данных нет, бэкенд не отдаёт total/hasMore.
- **FE-0324** — усечение требует >1000 отделов или >500 movements; production-объём не запрашивался.

Для каждой записи добавлено поле `statusRationale`; статус остаётся **Suspected**.

### 2.3. Схема verification

Введён `verificationProtocol` (v2) и очищены `verification[]`:

- `static-code` — чтение исходников/контрактов;
- `local-browser` — браузер с реальным backend/SQLite;
- `local-browser-mock` — браузер с перехваченными API;
- `local-api` — HTTP-пробы к изолированному backend;
- `test-harness` — Vitest/Node/Playwright-обвязка, замеры, синтетика;
- `production-observer` — историческое read-only наблюдение production.

Старые значения сохранены в `verificationLegacy[]`; ни один ID не менялся.

## 3. High: новые runtime-доказательства

### FE-0197 — реальный 2FA setup (подтверждено)

Отдельный backend с `AUTH_2FA_ENFORCED=1`, `AUTH_2FA_POLICY=all`, loopback вне internal CIDR. Playwright без route-mocking:

- login -> `2fa_setup_required`;
- `/auth/enable-2fa` вернул реальный otpauth secret;
- TOTP вычислен из secret, `/auth/verify-2fa` -> authenticated;
- URL сразу `/dashboard`, экран «Сохраните backup-коды» и сами коды не появились.

### FE-0198 — реальный повторный вход и trusted-device (подтверждено)

После включения 2FA: logout -> login -> `2fa_required` -> реальный TOTP -> verify.

- `network_zone=external`, `discoverable_trusted_devices_count=0`;
- URL сразу `/dashboard`;
- `[data-testid="login-remember-device-dialog"]` не появился.

### FE-0083 — две вкладки + валидность нового refresh (подтверждено)

Две страницы одного browser context (общие cookies), 18002/5219:

- три параллельных `POST /auth/refresh` -> `[200, 401, 200]`;
- `/auth/me` -> 401;
- **новый** refresh-cookie после гонки -> 401 `Refresh token has been revoked`;
- обе вкладки после reload -> `/login`.

Это доказывает отзыв всей family, а не только отказ старой cookie.

### FE-0023 — 10 000 портов на мобильном (подтверждено)

390×844, route-mocked 10 000 портов, переход на «Оборудование»:

- блокировка main thread ~**30.45 с**;
- **10 000** MUI Cards, **181 642** DOM-узла;
- body height **1 321 340 px**, JS heap **930 MB**.

### FE-0259, FE-0215, FE-0230, FE-0232, FE-0239, FE-0022 — заблокированы

- **FE-0259** — workspace требует настроенный объект/направление и 1C/SQL; стенд возвращает «сначала настройте объект».
- **FE-0215** — локальный стек `MAIL_MODULE_ENABLED=0`, нет mailbox/provider.
- **FE-0230** — нужен реальный WebView2 с поздним handshake; симуляция не дала React-ошибки.
- **FE-0232/FE-0239** — нет подготовленных users/departments fixtures и одобренного mutation-workflow.
- **FE-0022** — Warehouse1C balances/movements требуют 1C/SQL.

Статические доказательства сохранены; live-эффект не заявлен.

## 4. PWA/offline: FE-0325

Собранное приложение на :5223, реальный SW:

- **свежая офлайн-сессия**: loader >50 с; за 50 с только **2** запроса refresh — бесконечного storm нет;
- **восстановление сети**: возврат на `/login` за ~2 с;
- **существующая сессия офлайн**: `/dashboard` + «Нет подключения · Показываем сохранённые данные»;
- **две вкладки**: обе показывают loader;
- SW active/controller=true, кэши app-shell/assets/push-runtime.

Уточнение: зависание — это auth recovery при `status=0`, а не SW-навигация; запросы не бесконечные, но recovery не завершается без сети.

## 5. Функциональные маршруты

Новые 12 маршрутов (все ранее не входили в цикл 13):

| Маршрут | Действие | Результат |
|---|---|---|
| /about | «Перейти в HUB» | переход на /dashboard |
| /profile | «Служебные данные» | раскрытие, контент виден |
| /address-book | refresh + empty | empty-state, обновление |
| /company-structure | «Обзор» + «Обновить» | переключение, refresh |
| /docflow | «Подключить» | диалог |
| /tickets | «Создать заявку» | диалог |
| /scan-center | «Открыть очередь» | очередь |
| /passwords | «Новая запись» | диалог |
| /vcs | «Добавить терминал» | диалог |
| /construction | «Создать объект» | диалог |
| /warehouse-1c | «Остатки» | вкладка активна |
| /mfu | error/empty state | серверная ошибка отображена |

Дополнительно: back-navigation `/address-book → /tickets → back`; mobile 390px для `/address-book`, `/feed`, `/tickets` — overflow 0. `/feed` не засчитан: кнопка composer в этом проходе не открыла диалог.

Итого функционально покрыто: **24/36 маршрутов = 66.7%** (12 цикла 13 + 12 цикла 14).

## 6. Покрытие и метод

| Метрика | Значение | Метод |
|---|---|---|
| Статическое покрытие реестра | **323/323 = 100%** | каждая запись имеет file/lines или linesNote и вердикт |
| Перепроверка Suspected | **50/50 = 100%** (цикл 13) + 3 statusRationale (цикл 14) | 6 агентов + ручная сверка |
| Функциональные маршруты | **24/36 = 66.7%** | маршрут отрисован и выполнено основное действие |
| Runtime-покрытие находок | **8/323 = 2.5%** | FE-0078, FE-0083, FE-0098, FE-0197, FE-0198, FE-0023, FE-0253, FE-0325 |
| High live | **5/12 = 41.7%** | FE-0078, FE-0083, FE-0197, FE-0198, FE-0023 |

## 7. Самые опасные пользовательские сценарии

1. Потеря backup-кодов при первичной настройке 2FA (FE-0197).
2. Обход обязательной привязки trusted-device (FE-0198).
3. Массовый разлогин всех вкладок при гонке refresh (FE-0083).
4. Зависание мобильного Networks на 10 000 портов (FE-0023).
5. Вечный загрузчик PWA без сети (FE-0325).
6. Неограниченный рендер большой публичной папки (FE-0098).
7. Потеря inline-изображений письма после autosave (FE-0215, static).
8. Потеря связей делегатов при сбое bulk-загрузки (FE-0232, static).

## 8. Доказательства

- `evidence/cycle14/live-evidence.md` — протоколы.
- `evidence/cycle14/live-2fa-dashboard.png`, `live-fe0083-two-tabs.png`, `live-fe0023-10k-ports.png`.
- `evidence/cycle14/functional-routes.json`.
- `evidence/cycle14/registry_schema.mjs`, `live_updates.mjs`.
- `ISSUES.json`: `verificationProtocol`, `verification`, `verificationLegacy`, `statusRationale`, `reverificationHistory`.

Валидатор: 0 ошибок. Merge/deploy/исправления приложения не выполнялись.
