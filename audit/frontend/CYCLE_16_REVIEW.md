# CYCLE 16 — реальное покрытие и глубокие E2E

- Дата: 2026-11-23
- База аудита: PR #9, `60dfe457` (323 записи).
- Проверенный код: чистый архив main **`4776ce5f`** (merge PR #14, files redesign), собранный с локальными `VITE_*`-флагами из корневого `.env` (содержимое не публикуется).
- Стенд: `e2e/stack/local_backend.py`, SQLite `.state-cycle16`, порт 18006 + static proxy 5224; production не затрагивался.
- Важно: в рабочем дереве владельца есть незакоммиченные правки. Финальные E2E выполнены на чистом `4776ce5f`; рабочее дерево не изменялось.

## 1. Полная карта маршрутов

Инвентаризация построена из `App.jsx` (не из числа сценариев):

| Категория | Кол-во |
|---|---|
| Всего route entry | **51** |
| Redirect/service (`/`, `/dashboard/news`, `/ad-users`, `/kb`, `*`) | 5 |
| Пользовательских | **46** |
| Публичные (`/login`, `/shared-files/:token`, `/shared-folders/:token`) | 3 |
| Standalone protected | 31 |
| Параметризованные/дочерние | 12 |
| Вложенных admin-разделов | 12 |
| Вкладок настроек | 6 |

Отдельно проверены:

- `/feed` — публикация поста (E2E);
- `/mail`, `/mail/compose` — corporate-password gate, почтового профиля нет (Blocked);
- `/my-files/edit/:fileId` — редактор отдаёт error-state «Доступ к документу изменён или файл больше недоступен» (Smoke);
- Construction: `/construction` → **502** «BUH20_1C_USER и BUH20_1C_PASSWORD не заданы в .env», 4 дочерних маршрута без fixture (Blocked);
- `/database` — shell и «Выберите филиал», без SQL-данных (Smoke);
- `/chat` — отправка/E2E; `/chat/open` — functional;
- admin: все 12 разделов открываются; E2E-мутация только `users`, остальные read-only/error-state;
- settings: все 6 вкладок открываются.

Полная таблица по каждому маршруту — `COVERAGE_MATRIX.md` (верхний блок цикла 16; исторические таблицы сохранены ниже).

## 2. Матрица Smoke / Functional / E2E

| Уровень | Кол-во | Доля от 46 |
|---|---|---|
| E2E | 6 route entry | 13.0% |
| Functional (без E2E) | 26 | 56.5% |
| Functional + E2E | 32 | **69.6%** |
| Smoke-only | 7 | 15.2% |
| Blocked (среда) | 7 | 15.2% |
| Redirect | 5 | — |

- **36 сценариев циклов 13–15 — это action-сценарии над 32 route entry, а не 36/46.** Прежняя формулировка «36 маршрутов» была оптимистичной; исправлено.
- 14 из 46 пользовательских entry не имеют functional/E2E-действия: 7 smoke-only и 7 blocked.
- Admin sections: 12/12 открываются, mutation-E2E — 1/12 (`users`).
- Settings: 6/6 открываются, mutation-E2E нет.

## 3. Новые полные E2E

Добавлено **5** сценариев (UI → API → SQLite → повторное открытие):

1. `/feed` — создание публикации, reload.
2. `/tasks` — создание задачи, редактирование описания, чек-лист, reload.
3. `/chat` — «Заметки»: отправка, вторая вкладка, reload, проверка API (4 сообщения, дублей нет).
4. `/my-files` — загрузка файла, reload, поиск, предпросмотр содержимого.
5. `/admin/users` — создание синтетического пользователя, reload, поиск.

Всего E2E-сценариев: **8** (2FA setup/login, chat offline-send, two-tab refresh + 5 новых). E2E route entry: 6.

Что не стало E2E и почему:

- почта — нет mailbox и `MAIL_MODULE_ENABLED=0`;
- Construction — нет 1С-кредов и настроенного объекта;
- `/database` — нет SQL-данных/филиала;
- `/my-files/edit` — редактор в error-state;
- admin-разделы, кроме users — read-only, без разрешённых мутаций.

## 4. Найденные ошибки и воспроизводимость

Новых дефектов приложения в цикле 16 не подтверждено. Уточнены два High:

### FE-0083 — подтверждён (family revocation)

- 3 параллельных `POST /auth/refresh` с одной cookie → **[200, 200, 401]**.
- Cookie из успешного ответа после серии → `/auth/me` **401**, `/auth/refresh` **401 `revoked`**.
- Контроль: 2 последовательных повтора внутри grace → **[200, 200]**, новый access **200**.

Вывод: семью отзывает именно повтор, превышающий `_REFRESH_GRACE_MAX_HITS`; параллельный refresh из нескольких вкладок — реальный триггер. Воспроизводится стабильно на изолированном backend.

### FE-0059 — уточнён (потеря ответа, не отзыв family)

- Внутри grace старый refresh → 200.
- Через 185 с (> факта grace 180 с) старый refresh → **401 revoked**, старый access → `/auth/me` 401.
- **Новый** токен, выданный той же ротацией, остаётся живым: `/auth/me` 200, `/auth/refresh` 200.

Вывод: при потере ответа клиент остаётся только со старой cookie и после grace вынужденно разлогинивается. Это клиентский сценарий потери ответа, а не отзыв family. Для исправления важно разделять эти случаи.

## 5. Статус оставшихся High

| ID | Статус | Доказательство | Блокировка |
|---|---|---|---|
| FE-0022 | Confirmed | runtime, mock Warehouse1C | — |
| FE-0023 | Confirmed | runtime, 10k портов mobile | — |
| FE-0059 | Confirmed | runtime API, уточнён | — |
| FE-0078 | Fixed-externally | — | — |
| FE-0083 | Confirmed | runtime API, family revoke | — |
| FE-0197 | Confirmed | runtime, 2FA | — |
| FE-0198 | Confirmed | runtime, 2FA | — |
| FE-0215 | Confirmed (static) | static-code | нет mailbox/IMAP-SMTP; `MAIL_MODULE_ENABLED=0` |
| FE-0230 | Confirmed (static) | static-code | нет Windows/WebView2 host |
| FE-0232 | Confirmed (static) | static-code | нет fixtures делегатов и разрешённых мутаций |
| FE-0239 | Confirmed (static) | static-code | нет fixtures отделов и разрешённых мутаций |
| FE-0259 | Confirmed (static) | static-code | Construction 502, нет объекта/направления |

Runtime-доказанных High: **7**; unresolved runtime: **6**; static-only: **5**. Разбиение сохранено в `highBreakdown`.

## 6. Несоответствия реестра

1. **Завышенное покрытие**: «36 сценариев» подавались как покрытие маршрутов, хотя это 32 route entry. Исправлено в `COVERAGE_MATRIX.md`; в отчёте указан реальный знаменатель 46.
2. **FE-0059, формулировка «>15 с»**: в заголовке остался исторический порог, фактический grace на стенде — 180 с (root `.env`, в код-дефолте иное). В `currentConclusion` добавлено фактическое значение и источник; содержимое `.env` не публикуется.
3. **FE-0059 vs FE-0083**: оба High описывали разлогин, но механизмы разные. Разделено: FE-0059 — потеря ответа ротации; FE-0083 — параллельный refresh и отзыв family. Взаимные ссылки сохранены.
4. **FE-0230**: статус Confirmed опирается на статический механизм, live-симуляция была inconclusive. Это не менялось; в отчёте явно указано, что live-доказательства нет.
5. **verification**: нормализация цикла 15 (304 `static` → `static-code`, точный enum) сохраняется; валидатор проходит, старые значения остаются в `verificationLegacy`.

## 7. План продолжения

1. **FE-0215**: поднять локальный IMAP/SMTP fixture (например, GreenMail/MailHog) с `MAIL_MODULE_ENABLED=1`, проверить autosave и inline-вложения на реальном backend.
2. **FE-0230**: собрать и запустить Windows Desktop/WebView2 host, проверить поздний `desktop.hostReady` и hooks.
3. **FE-0232/FE-0239**: синтетические пользователи/отделы/делегаты в одноразовой БД, разрешённые мутации, проверить гонки и потерю связей.
4. **FE-0259**: тестовый Construction object/direction + 1С-креды, проверить F5/close/unmount недельной сводки.
5. **E2E-создание записей** для `/tickets`, `/vcs`, `/passwords`, `/docflow` (сейчас только диалоги/refresh).
6. **Public shares**: `/shared-files/:token` и `/shared-folders/:token` с реальными токенами (скачивание, expiry, отзыв).
7. **PWA/stale SW**: активация waiting-worker, offline с истёкшей сессией (FE-0325/FE-0084/FE-0085).

Валидатор: 0 ошибок. Merge/deploy/исправления приложения не выполнялись.
