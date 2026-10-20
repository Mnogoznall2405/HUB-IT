# Тестовая инфраструктура HUB-IT

Справочник по запуску и устройству тестов. Обязательные правила (что и когда проверять, качество тестов) — в [AGENTS.md](../../AGENTS.md).

## Python / pytest

- Узкий запуск: `pytest -q tests/test_<area>_<feature>.py` или конкретный nodeid; bot — `pytest -q -c pytest.bot.ini`.
- `tests/conftest.py` подменяет `APP_DATABASE_URL` и `CHAT_DATABASE_URL` на sqlite; pytest всё равно запускать с явными sqlite-URL.
- Длительность: `--durations=10`, различать collection, setup, call и teardown. Сравнивать одинаковые сценарии и окружение, учитывать первую сборку шаблона БД; оборванный прогон не считать успешным.
- Маркеры `unit`, `integration`, `slow` ставить только на тесты, проверенные по зависимостям: маркирование существующего набора неполное.

### Готовая схема БД

- Фикстура `prebuilt_chat_db`: шаблон схемы строится один раз на pytest-процесс, каждый тест получает отдельную копию. Для поведенческих app/chat-тестов.
- Где фикстуру не внедрить (helpers, тела тестов), `import conftest` даёт:
  - `copy_app_schema_for_url(url)` — миграционная схема + пометка url инициализированным;
  - `copy_chat_schema_for_url(url)` — app + chat;
  - `copy_app_metadata_schema(path)` / `copy_app_metadata_schema_for_url(url)` — чистый `create_all` без миграций, для фикстур, которые строили схему через `AppBase.metadata.create_all`.
- Тесты создания схемы и миграций работают с пустой БД и настоящими initializer/Alembic: не заменять их шаблоном и не ослаблять assertions ради скорости.

### Backend E2E

`pytest -q tests/test_e2e_smoke.py tests/test_e2e_chat_flow.py tests/test_e2e_tickets_flow.py` — реальные роутеры на sqlite-копиях схемы. Образец для новых проверок HTTP-границ — `tests/test_e2e_smoke.py` (`TestClient` приложения).

## Web (из `WEB-itinvent/frontend`)

- `npm run test:unit` — проверенные pure-тесты в Node; `npm run test:ui` — DOM-тесты; `npm run test:run -- <путь>` — узкий запуск по файлам.
- В `vite.config.js` Node allowlist явный: новые тесты по умолчанию остаются в DOM-проекте; перед переносом в Node проверить всю цепочку импортов.
- Проверочная сборка — только `npx vite build --outDir <папка вне dist>`: `npm run build` пишет в `dist/`, который раздаёт production IIS.

### Playwright E2E

- Запускать только нужные файлы: `npx playwright test e2e/<file>.spec.js --reporter=line`. Весь набор (`npm run test:e2e` без пути) идёт десятки минут — только по явному запросу.
- Режим по умолчанию — read-only спеки против деплоя (`E2E_USERNAME`/`E2E_PASSWORD`); запись только под `E2E_SEND=1`.
- Локальный контур — `E2E_LOCAL=1`: Playwright поднимает `e2e/stack/local_backend.py` (настоящий `backend.main:app` на sqlite в `e2e/stack/.state/`) и `vite` на :5174. Креды и `E2E_SEND` подставляются автоматически, write-спеки (`chat-write`, `tickets-write`) работают без прода.
  - Сид: `e2e_admin` / `e2e-local-admin-pass`, `e2e_user` / `e2e-local-user-pass`; внешние фоновые синхронизации выключены.
  - `local_store` перенаправляется в `e2e/stack/.state/local_store/`, общий `data/local_store.unified.db` не трогается.
  - Inline-worker «Моего диска» включён по умолчанию (`E2E_FILES_WORKER=1`); `E2E_FILES_WORKER=0` отключает его и пропускает файловый lifecycle со скачиванием. Антивирусная политика не подменяется, обработка и скачивание используют только `.state/`.
  - Local stack не подключается к SQL Server/1С и не отправляет email; Scan/Voice smoke проверяет shell/недоступность API, их API покрыты отдельными TestClient-тестами.
  - APP/CHAT SQLite-БД в `.state/` используют WAL без снижения `synchronous`; latency-бюджет сравнивать на тех же сценариях и порядке запуска. Локальные SQLite-замеры не являются PostgreSQL production-SLO.
- Собранный frontend: `E2E_LOCAL=1 E2E_BUILD=1 npx playwright test <файлы>` — Vite build пишет в `output/e2e-frontend-built/`, Vite preview использует тот же HTTP/WS proxy; production `dist/` не меняется.

## Desktop

`dotnet test desktop/Hub.Desktop.sln -c Release`. Системный `dotnet` без SDK — использовать портативный `tools/dotnet-sdk-8/dotnet.exe`.

## Mobile

Из `mobile-hub/`: `npm run test:related -- <пути исходников>` (Jest `--findRelatedTests`); полный `test:ci` остаётся доступным. Остальное — в [mobile-hub/README.md](../../mobile-hub/README.md).
