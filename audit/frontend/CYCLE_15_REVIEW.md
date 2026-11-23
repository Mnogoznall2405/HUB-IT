# CYCLE 15 — оставшиеся High и глубокая функциональная проверка

- Дата: 2026-11-23
- База: PR #9, audit-коммит `eb83a0c0`, 323 записи.
- Проверенный код: trial-сборка от `5513db68`; текущий main `467512e5` меняет только MyFiles (Auth/Warehouse1C/http/main/sw/construction идентичны).
- Стенд: SQLite backend 18002 + static build proxy 5223; отдельный 2FA backend 18004 (цикл 14); production не затрагивался.

## 1. Реестр

- `verification[]` нормализован: 304 старых `static` → `static-code`; старые значения сохранены в `verificationLegacy[]`.
- Валидатор теперь проверяет **точный enum**: `static-code`, `local-browser`, `local-browser-mock`, `local-api`, `test-harness`, `production-observer`.
- **FE-0253**: статус Rejected относится к проверенному сценарию (8 маршрутов, 12 раундов, forced GC: плато 49–51 MB, 23 MB после GC). Это не доказывает отсутствие утечек в других маршрутах/компонентах; добавлен `statusRationale`.
- High разделены в `highBreakdown`:
  - исторические — 12;
  - актуальные — 11 (FE-0078 Fixed);
  - с runtime-доказательствами — 7: FE-0022, FE-0023, FE-0059, FE-0078, FE-0083, FE-0197, FE-0198;
  - unresolved runtime High — 6: FE-0022, FE-0023, FE-0059, FE-0083, FE-0197, FE-0198;
  - только статические — 5: FE-0215, FE-0230, FE-0232, FE-0239, FE-0259.

Статусы реестра: **Confirmed 269 / Suspected 11 / Fixed-externally 2 / Rejected 41**.

## 2. High: результаты цикла 15

### FE-0022 — Warehouse1C (подтверждено runtime)

Мокирован `GET /warehouse-1c/balances` (одна строка), поиск «кабель»:

- таблица отрендерена;
- clickable `td` номенклатуры: `tabindex=null`, `role=null`;
- `tr`: `tabindex=null`, `role=null`;
- на ячейке нет keyboard-focusable элемента.

Строка доступна только мышью. Скриншот: `evidence/cycle15/live-fe0022-warehouse-row.png`.

### FE-0059 — потеря ответа ротации refresh (подтверждено API)

- login → refresh (сервер ротировал), новый ответ потерян (cookies не сохранены);
- ожидание 185 с (> grace 180 с из root `.env`);
- повтор старой refresh-cookie → **401 `Refresh token has been revoked`**;
- старый access-cookie → `/auth/me` **401**.

Пользовательский эффект: принудительный logout после потерянного ответа ротации. Подтверждает связку с FE-0083.

### FE-0215 / FE-0230 / FE-0232 / FE-0239 / FE-0259 — остаются static-only

- **FE-0215**: локальный стек принудительно `MAIL_MODULE_ENABLED=0`; нет IMAP/SMTP тестового mailbox. Route-mocking проверяет только UI, не серверный autosave/вложения.
- **FE-0230**: нет Windows Desktop/WebView2 host; C# `DesktopBridgeHost` отправляет `desktop.hostReady` после инициализации bridge; браузерная симуляция не является доказательством WebView2.
- **FE-0232/FE-0239**: нет подготовленных users/departments fixtures и разрешённых мутаций.
- **FE-0259**: mocked construction page упирается в «сначала настройте объект»; нужен configured object/direction + 1C/SQL.

## 3. PWA / offline (FE-0325)

- Три цикла offline→online с существующей сессией: каждый offline render `/dashboard` + cached banner за ~2.6 с, online возвращает dashboard.
- Свежая офлайн-сессия: loader >50 с, 2 refresh-попытки (нет storm), reconnect ~2 с.
- Две вкладки: обе висят на loader.
- Stale SW: новый worker `waiting=true`, старый controller и кэши остаются; `/settings/app` не показал текст обновления.
- SW active/controller=true; shell/assets/push caches присутствуют.

## 4. Функциональные маршруты

Добавлены 12 маршрутов (Functional, не E2E создания):

`/help`, `/menu`, `/it/objects`, `/it/requests`, `/groups-access`, `/voice`, `/monitoring`, `/shared-files/:token`, `/admin`, `/file-egress`, `/dlp`, `/chat/open`.

Проверены действия: статья, навигация, retry/error, вкладки, refresh, empty state, отделы, DLP, возврат в чат.

Итого: **24 (циклы 13–14) + 12 (цикл 15) = 36 маршрутных сценариев**.  
Уровни:

- **Smoke** — все 36 открывались;
- **Functional** — 36 сценариев с действием/состоянием;
- **E2E** — 3: реальный 2FA setup/login (UI→API→SQLite), chat offline-send (UI/WS/DB), двухвкладочный refresh (UI/fetch/API).

Диалоги создания записей не считались E2E.

## 5. Риски

1. FE-0197/0198 — потеря backup-кодов и обход обязательного trusted-device.
2. FE-0059/FE-0083 — потеря ответа ротации/межвкладочная гонка → разлогин всех вкладок.
3. FE-0023 — мобильный freeze на 10k портов.
4. FE-0325 — вечный loader PWA без сети.
5. FE-0098 — большой публичный список.
6. FE-0215/FE-0232/FE-0259 — потенциальные потери данных (inline-изображения, делегаты, черновики), пока static-only.

## 6. Что проверить следующим

- Реальный test mailbox/IMAP для FE-0215.
- Windows Desktop/WebView2 host для FE-0230.
- Синтетические users/departments + разрешённые мутации для FE-0232/FE-0239.
- Настроенный construction object/direction для FE-0259.
- Stale-SW activation/prompt и offline с истёкшей сессией.
- Довести E2E-создание записей (не только диалоги) для ключевых маршрутов.

Валидатор: 0 ошибок. Merge/deploy/исправления приложения не выполнялись.
