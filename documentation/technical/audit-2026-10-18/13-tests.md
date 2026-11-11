# Аудит тестов HUB-IT (read-only)

Область: `tests/` (498 py-файлов, ~147k строк), `WEB-itinvent/backend/tests/` (6 py), `WEB-itinvent/frontend/src/**/*.test.*` (666), `WEB-itinvent/frontend/e2e/` (24 spec.js), конфиги pytest/vitest/playwright.

Метод: статический анализ. Python-интерпретатор в этой среде не запускается (путь к `python.exe` содержит кириллицу, процесс не создаётся), поэтому AST-проход выполнен через Node-сканер (эвристика по блокам функций) плюс `grep`/`git ls-files`/`git status`. Ни один тест не запускался. Отдельно проверено, что `.gitignore` и git-статус соответствуют заявленному.

Легенда: серьёзность High/Medium/Low; уверенность High/Medium/Low.

---

## Итог

- 42 находки: баги и риски запуска 13, конфликты 3, дублирование 6, оптимизация 4, мёртвый/запрещённый код 6, пробелы покрытия 10 (ниже, в разделе «Coverage gaps»).
- Самые опасные для запуска: B1 (`test_agent.py` может остановить реальные процессы агента), B2 (PG-тесты делают DDL на БД из `.env`), B5 (Playwright по умолчанию бьёт в продакшен).
- Для процесса критичны B3/B4: 22 из 24 e2e-спеков и все тесты `WEB-itinvent/backend/tests/` не отслеживаются git, и это расходится с `scripts/pytest-chat-backend-gate.ps1`.
- Оценка удаляемого мёртвого кода: ~1 100 строк (F2 ~518, F1 ~150, F5 ~90, D1 ~54, D2 ~16, плюс ~320 строк sys.path-шаблона, который заменяется conftest).

---

## Bugs

### B1. test_agent.py запускает реальный PowerShell с неполной подменой, возможна остановка реальных процессов агента
- **Файл:** `tests/test_agent.py:894-975` (подмены 934-945, запуск `subprocess.run` 958)
- **Описание:** Тест строит скрипт из `agent/setup.py` и подменяет в нём пути и имена на временные. Подмена списка служб `@('ITInventAgent','ITInventScanAgent','ITInventOutlookProbe')` (строки 943-945) не совпадает ни с одной строкой `agent/setup.py` (grep: 0 совпадений), поэтому подмена молча не срабатывает. Реальный скрипт в `agent/setup.py:335-339` делает `Stop-Process -Force` по `ITInventAgent`, `ITInventScanAgent`, `ITInventOutlookProbe` и т.д. и `schtasks /End` по задаче `'HUB-IT Agent'`, которую тест не подменяет.
- **Доказательство:** подмена на `'IT-Invent Agent'` (942) есть, на `'HUB-IT Agent'` и на процессы - нет; `assert` на факт подмены отсутствует.
- **Серьёзность:** High. **Уверенность:** High.

### B2. PG-тесты выполняют DDL на БД, адрес которой берётся из боевого `.env`
- **Файлы:** `tests/test_one_c_catalog_compact_gate_pg.py:64-82` (`_resolve_test_dsn`, fallback на `.env`), `:91-108` (`pg_url`), `:111-129` (`gate_store`: `CREATE SCHEMA`, `CREATE EXTENSION`, `initialize_app_schema(pg_url, force=True)` на строке 129, `ALTER TABLE ... ALTER COLUMN TYPE` на строке 142, `DROP INDEX`).
- **Описание:** DSN берётся из `ONE_C_SEARCH_TEST_DATABASE_URL`/`TEST_DATABASE_URL`, затем из `.env` (хост и учётные данные боевого конфига), а имя БД подменяется на тестовое. Единственная защита - regex имени `ALLOWED_RE` (строка 25). Это прямо противоречит AGENTS.md (production read-only, никакого DDL на продакшене).
- **Доказательство:** та же схема в `test_one_c_catalog_compact_search_pg.py:107`, `..._incremental_pg.py:128`, `..._final_closure_pg.py:126`.
- **Серьёзность:** High. **Уверенность:** Medium (риск зависит от наличия `tmp/one_c_search_benchmark/results/chosen_test_db.txt` и `.env` на машине и от того, на каком сервере лежит тестовая БД).

### B3. WEB-itinvent/backend/tests не отслеживаются git (правило .gitignore)
- **Файлы:** `.gitignore:223` (`test_*.py`; исключение `!tests/test_*.py` только для корневого `tests/`), `WEB-itinvent/backend/tests/*.py` (6 файлов, `git ls-files` отдаёт только `__init__.py`), `scripts/pytest-chat-backend-gate.ps1:30-33` ссылается на них.
- **Описание:** На чистом checkout chat-gate не может запуститься: файлы отсутствуют в репозитории. В `pytest.ini` `testpaths = tests`, поэтому эти файлы не запускаются обычным `pytest`.
- **Серьёзность:** High. **Уверенность:** High.

### B4. 22 из 24 e2e-спеков не закоммичены
- **Файлы:** `WEB-itinvent/frontend/e2e/*.spec.js` (например `address-book.spec.js`, `chat-realtime.spec.js`, `tasks-write.spec.js`).
- **Описание:** `git ls-files WEB-itinvent/frontend/e2e` отдаёт только `screens-smoke.spec.js`, `sidebar-pin.spec.js` и `chat-smoke.BACKLOG.md`. Остальные спеки и `e2e/stack/local_backend.py` существуют только в рабочем дереве (`git status`: `??`). Это риск потери и невоспроизводимости E2E-покрытия.
- **Серьёзность:** High. **Уверенность:** High.

### B5. Playwright по умолчанию направлен на продакшен, write-поток запускается без проверки E2E_LOCAL
- **Файлы:** `WEB-itinvent/frontend/playwright.config.js:73` (`baseURL` = `https://hubit.zsgp.ru` при отсутствии `E2E_LOCAL=1`), `WEB-itinvent/frontend/e2e/chat-write.spec.js:19` (`test.skip(!(U1 && P1 && U2 && P2))` без проверки `E2E_LOCAL`/`E2E_SEND`).
- **Описание:** Если в окружении заданы E2E_USERNAME/PASSWORD и *2, `chat-write.spec.js` создаёт реальную переписку на продакшене. Для `tasks-write`, `tickets-write`, `files-write` защита есть (`E2E_SEND=1`), но она сама по себе разрешает запись в прод.
- **Серьёзность:** High (для write-спека), Medium для конфига. **Уверенность:** High.

### B6. Импорт chat_main проглатывается через pytest.skip
- **Файл:** `tests/test_chat_runtime_split.py:47-55` (строки 52-53: `except Exception as exc: pytest.skip(f"chat_main import skipped: {exc}")`).
- **Описание:** Любая поломка импорта chat-приложения превращается в skip, а не в падение. Тест, который должен ловить именно такие регрессии, молча пропускается.
- **Серьёзность:** Medium. **Уверенность:** High.

### B7. Тест без проверок при отсутствии ресурса
- **Файл:** `tests/test_russian_settlements_service.py:35-42` (строка 38: `if not service.index_path.exists(): return`).
- **Описание:** Если индекс `WEB-itinvent/backend/resources/geo/russian_settlements.json.gz` отсутствует, тест проходит без проверок. Сейчас файл есть (1.3 МБ, tracked), так что в текущем дереве тест работает.
- **Серьёзность:** Medium. **Уверенность:** High.

### B8. Фоновые задачи не отменяются, тайминг по wall-clock
- **Файл:** `tests/test_chat_send_path_optimization.py:286-322` (функция с 286).
- **Описание:** `sender_task` для `fast` и `slow` создаются через `create_task`, но не отменяются (нет `finally`/`cancel`). `slow_ws` ждёт `asyncio.sleep(30)` и остаётся живым после теста. Проверка `elapsed < 0.5` зависит от загрузки машины.
- **Серьёзность:** Medium. **Уверенность:** High.

### B9. Глобальные побочные эффекты между тестами (порядок-зависимость)
- **Файлы:** `os.environ` без восстановления: `tests/test_one_c_catalog_compact_gate_pg.py:112-122` (около 44 присваиваний в module-scope фикстуре), `..._final_closure_pg.py:126` (+13), `..._search_pg.py:107` (+12), `..._incremental_pg.py:128` (+8). Нет `monkeypatch`, нет `del`/`pop` (grep: 0). Также `sys.modules[...] = module` без восстановления: `tests/test_chat_cross_node_realtime_script.py:21`, `tests/test_hub_chat_loadtest_script.py:21`, `tests/test_mail_loadtest_script.py:17`, `tests/test_mail_sqlite_migration_script.py:16`.
- **Описание:** Значения вроде `WAREHOUSE_1C_CATALOG_SEARCH_ENGINE=tokens` и `..._SEARCH_SHADOW=0` остаются в процессе pytest и влияют на тесты, которые идут после них.
- **Серьёзность:** Medium. **Уверенность:** High.

### B10. Временные каталоги не удаляются
- **Файл:** `tests/conftest.py:49-58` (`temp_dir`: `shutil.rmtree(..., ignore_errors=True)`).
- **Описание:** В `.pytest_runtime/` лежат 956 каталогов `run_*` и 204 файла `pytest_app_*.sqlite3`. Удаление молча не срабатывает (ошибки глушатся), диск засоряется, утечки не видны.
- **Серьёзность:** Low. **Уверенность:** High (по количеству файлов; причину не проверял).

### B11. Миграционные тесты без assert (только «не упало»)
- **Файлы:** `tests/test_ai_memory_migration.py:53-61` (`upgrade()` без проверки схемы/данных), `tests/test_alembic_env_explicit_url.py:25-45` (`command.current(...)` без проверки).
- **Серьёзность:** Low. **Уверенность:** High.

### B12. Слабые проверки (toBeDefined / callable вместо поведения)
- **Файлы:** `WEB-itinvent/frontend/src/pages/voice-video/VoiceVideoPage.test.jsx:759` (`waitFor(() => expect(countSignal).toBeDefined())` - ожидание не ждёт события), `WEB-itinvent/frontend/src/pages/tasks/useTasksPageController.test.jsx:130`, `WEB-itinvent/frontend/src/pages/About.test.jsx:112`; Python: `tests/test_voice_diarization_chunk.py:147` и `:248`, `tests/test_warehouse_1c_construction_requests.py:132` (`assert callable(...)` на аргумент, поведение не проверяется).
- **Серьёзность:** Low. **Уверенность:** High.

### B13. Документация ссылается на отсутствующий тест
- **Файл:** `documentation/technical/CHAT_WEB_STABILITY_PLAN_2026-09-30.md:1007`, `:1022`, `:1040` («test_chat_thread_read_store.py 8/8 passed», «8 passed»).
- **Описание:** Файл `WEB-itinvent/backend/tests/test_chat_thread_read_store.py` не существует ни в git (никогда не коммитился), ни в дереве; остался только `.pyc` в `__pycache__`. Модуль `WEB-itinvent/backend/chat/chat_thread_read_store.py` не покрыт тестом. Документ заявляет результат, которого нет.
- **Серьёзность:** Medium. **Уверенность:** High.

---

## Conflicts

### C1. Политика E2E по умолчанию не соблюдается
- **Файлы:** `AGENTS.md` (раздел «Test quality»: по умолчанию только E2E для важных сценариев, unit - исключение), факт: `WEB-itinvent/frontend/src` - 666 unit-файлов `*.test.js/jsx` против 24 e2e-спеков; `tests/` - 498 py-файлов, из них 12 `test_e2e*`, остальные - unit/модульные.
- **Серьёзность:** High (процессный риск, объём). **Уверенность:** High.

### C2. Тесты фиксируют контракт удалённого APK/Capacitor
- **Файлы:** `WEB-itinvent/frontend/src/lib/useWebAuthnAvailability.test.js:69-73` (`it('is always false after APK removal')`), `WEB-itinvent/frontend/src/lib/mobileIncomingShare.test.js:26-33` (`'consumes ... only inside the APK WebView'`).
- **Описание:** AGENTS.md запрещает восстанавливать Capacitor/mobile-android, live-приложение - Expo `mobile-hub/`. В исходниках `mobile-hub/` и `desktop/` глобал `__HUBIT_MOBILE_APP__` не выставляется (Grep по исходникам: 0 совпадений, без dist/.expo/artifacts). Он встречается только в собранных Hermes-бандлах `mobile-hub/dist`, `mobile-hub/.expo`, `mobile-hub/artifacts` (`*.hbc`), и там это потребитель (проверка чтения), а не установка. Потребители (`lib/mobileIncomingShare.js:34`, `lib/mobileOfflineCache.js:32`, `components/layout/MainLayout.jsx:626`) могут быть мёртвым кодом, если нативная оболочка глобал не выставляет; в репозитории это не проверяется.
- **Серьёзность:** Medium. **Уверенность:** Low.

### C3. Конфиг pytest для бота: порог покрытия 1%
- **Файл:** `pytest.bot.ini` (`--cov-fail-under=1`).
- **Описание:** Порог фактически отключён; при этом `testpaths` ограничен двумя файлами. Конфиг создаёт видимость контроля покрытия без реального ограничения.
- **Серьёзность:** Low. **Уверенность:** High.

---

## Duplication

### D1. Идентичная фикстура chat_env в шести файлах
- **Файлы:** группа A (тело побайтно одинаково): `tests/test_chat_assets_summary_service.py:44`, `tests/test_chat_presence_and_receipts_service.py:70`, `tests/test_chat_unread_mentions.py:276`; группа B: `tests/test_chat_mark_read_fast_path.py:39`, `tests/test_chat_message_edit_delete_service.py:25`, `tests/test_chat_send_path_optimization.py:43`. Всего 13 определений `chat_env`.
- **Оценка:** ~54 строки, которые можно вынести в `conftest.py`.
- **Серьёзность:** Medium. **Уверенность:** High.

### D2. Идентичная фикстура service для тестов тикетов
- **Файлы:** `tests/test_tickets_comments_history.py:58`, `tests/test_tickets_object_management.py:46`, `tests/test_tickets_prop_encryption.py:52`, `tests/test_tickets_service_requests.py:52` (одинаковое тело), ещё две пары. Всего 24 определения `def service`.
- **Оценка:** ~16-20 строк.
- **Серьёзность:** Low. **Уверенность:** High.

### D3. Регистрация сетевых инструментов проверяется в трёх файлах
- **Файлы:** `tests/test_network_tools_unit.py:40-64` (класс `TestToolRegistration`, 5 тестов), `tests/test_network_dns_lookup.py:20` (`test_dns_tool_registered`), `tests/test_network_host_ping.py:20` (`test_ping_tool_registered`).
- **Серьёзность:** Medium. **Уверенность:** High.

### D4. Шаблон sys.path в 314 файлах
- **Файлы:** в 314 файлах `tests/` (322 строки) `sys.path.insert(0, str(WEB_ROOT))`. `tests/conftest.py:19-20` уже добавляет `WEB-itinvent` в `sys.path`.
- **Серьёзность:** Low. **Уверенность:** High.

### D5. client.test.js дублирует модульные тесты API
- **Файлы:** `WEB-itinvent/frontend/src/api/client.test.js:3023` (`describe('chatDirectoryAPI contract')`) и `WEB-itinvent/frontend/src/api/chatDirectory.test.js` (4 теста того же API); `client.test.js:1269-1285` (`adUsersAPI` проверяется дважды: через `./adUsers` и через `./client`).
- **Серьёзность:** Medium. **Уверенность:** High.

### D6. Пропущенный тест дублирует существующее покрытие
- **Файлы:** `WEB-itinvent/frontend/src/pages/Mail.test.jsx:2803` (`it.skip('keeps remote images blocked ...')`) - то же поведение покрыто в `components/mail/useMailRemoteImages.test.js` и `components/mail/MailConversationReader.test.jsx`.
- **Серьёзность:** Low. **Уверенность:** High.

---

## Optimization

### O1. Реальные sleep в Python-тестах (≥7 с суммарно)
- **Файлы:** `tests/test_chat_event_outbox_idle_backoff.py:48` (1.3 с), `:66` (0.9 с), `:90` (0.6 с); `tests/test_mail_runtime_cache.py:33` (1.1 с); `tests/test_mail_app_db_service.py:565` (1.1 с); `tests/test_e2e_smoke.py:198` (1.2 с); `tests/test_one_c_catalog_compact_search.py:219` (0.5 с), `:233` (0.6 с).
- **Рекомендация:** подменять `time.monotonic`/часы через monkeypatch или инжектировать clock.
- **Серьёзность:** Medium. **Уверенность:** High (значения - литералы в коде; фактическое время не замерено).

### O2. Фиксированные паузы в Playwright
- **Файлы:** `WEB-itinvent/frontend/e2e/chat-realtime.spec.js:165, 175 (2 с), 201 (2 с), 208 (1 с)`; `chat-long-history.spec.js:140, 177, 184, 195, 222 (1 с)`; `chat-calls.spec.js:511 (500 мс), 1169 (1500 мс)`; `address-book.spec.js:378 (400 мс)`.
- **Рекомендация:** `expect.poll` или ожидание ответа сети.
- **Серьёзность:** Medium. **Уверенность:** High.

### O3. Очень большие тестовые файлы
- **Файлы:** `WEB-itinvent/frontend/src/api/client.test.js` (6719 строк, ~1012 expect), `WEB-itinvent/frontend/src/pages/Mail.test.jsx` (4084), `WEB-itinvent/frontend/src/components/chat/ChatThread.test.jsx` (3813), `tests/test_ai_chat_runtime.py` (4976), `tests/test_scan_server_tables.py` (2810), `tests/test_hub_tasks.py` (2499).
- **Рекомендация:** разбить по предмету; снижает стоимость сбора и поиска.
- **Серьёзность:** Low. **Уверенность:** High.

### O4. Property-тесты с max_examples=100
- **Файлы:** 31 файл с `hypothesis`, например `tests/test_ad_account_type_props.py:62-128` (шесть `@settings(max_examples=100)`), `tests/test_ad_groups_props.py:114-159`.
- **Рекомендация:** для чистого парсинга оставить 20-30 примеров либо заменить несколькими явными кейсами.
- **Серьёзность:** Low. **Уверенность:** Medium (время не замерено).

---

## Dead code / forbidden tests

### F1. Тесты на регистрацию и существование (запрещённый класс)
- **Файлы:** `tests/test_network_tools_unit.py:40-64`; `tests/test_network_dns_lookup.py:20`; `tests/test_network_host_ping.py:20`; `tests/test_ai_new_tools.py:51` (проверка набора id в реестре); `tests/test_ai_voice_tools.py:43-46`; `tests/test_ad_tools_unit.py:86-94` (`test_tool_is_registered`), `:100-108` (`isinstance` по id); `tests/test_ai_jev_routing.py:309-311`; `tests/test_user_full_context_unit.py:120-130`.
- **Оценка:** ~150 строк. Часть из них - допустимые wiring-проверки, но они не проверяют поведение инструмента.
- **Серьёзность:** Medium. **Уверенность:** High.

### F2. client.test.js: тесты-identity на re-export (запрещённый класс)
- **Файл:** `WEB-itinvent/frontend/src/api/client.test.js:1255`, `:2414`, `:3688` и ещё ~45 блоков `it('keeps ... compatible with the dedicated module and re-export')`.
- **Описание:** Каждый тест проверяет только `expect(clientX[m]).toBe(moduleX[m])` по списку имён методов. Это проверка проводки модулей, а не поведения. ~518 строк.
- **Рекомендация:** удалить; оставить один smoke, что `client.js` реэкспортирует модули.
- **Серьёзность:** High (объём, нарушение политики). **Уверенность:** High.

### F3. Константные тавтологии
- **Файлы:** `tests/test_chat_runtime_split.py:63-72` (`test_pool_budget_table_under_max_connections`: таблица пула объявлена внутри теста, код приложения не импортируется); `tests/test_user_full_context_unit.py:107-117` (константа == литерал); `WEB-itinvent/frontend/src/lib/useWebAuthnAvailability.test.js:69-73` (всегда `false`).
- **Серьёзность:** Medium. **Уверенность:** High.

### F4. Тесты, которые проверяют подстроки конфигов и скриптов
- **Файлы:** `tests/test_chat_runtime_split.py:110-200` (шесть функций, `read_text()` и `assert "..." in source`); в 42 файлах `tests/` есть `read_text` (`tests/test_agent.py` - 16 вызовов, `tests/test_pm2_runtime_recovery.py` - 9).
- **Описание:** Хрупкие контрактные тесты. Часть защищает инварианты (`tests/test_chat_runtime_split.py:131-135`, `"delete itinvent-backend" not in source`), но ломаются от любого переформатирования.
- **Серьёзность:** Medium. **Уверенность:** High.

### F5. Постоянно отключённые тесты
- **Файлы:** `WEB-itinvent/frontend/src/pages/Mail.test.jsx:2602` и `:2803` (`it.skip`, 90 строк; второй проверяет блокировку удалённых изображений); `tests/test_mail_async_api.py:175` (`@pytest.mark.skip(reason="... wait for live Exchange")`).
- **Серьёзность:** Medium. **Уверенность:** High.

### F6. Осиротевший тестовый файл
- **Файл:** `WEB-itinvent/backend/tests/test_settings_branch_filters.py` - не входит в `pytest.ini` (`testpaths = tests`), не входит в `scripts/pytest-chat-backend-gate.ps1`, игнорируется git (см. B3). Никогда не запускается.
- **Серьёзность:** Low. **Уверенность:** High.

### F7. Не обнаружено (проверено)
- Паттерны `typeof x === 'function'`, `toMatchSnapshot` без assert, `assert True`, тесты с `pass` в теле, `describe/it.skip(true)` - не найдено (кроме перечисленных выше).
- Mock-echo, найденный grep-ом: только 2 совпадения (`lib/mobileIncomingShare.test.js:19, 31`), и это тесты нормализации, а не mock-echo. Систематического mock-echo не обнаружено (проверка эвристическая).
- Реальных сетевых вызовов и подключений к SQL Server/LDAP/SMTP в тестах не найдено; HTTP-клиенты замоканы.
- Вызовы PM2 в `tests/test_pm2_runtime_recovery.py` изолированы (фиктивный `pm2.cmd`, `PM2_HOME` во временной папке).
- Битых импортов `backend.*` в `tests/` нет (0 отсутствующих модулей).
- Все 14 файлов `test:chat:gate` (`WEB-itinvent/frontend/package.json`) существуют.

---

## Coverage gaps (top 10)

Оценка по сопоставлению роутов (`WEB-itinvent/backend/api/v1/*.py`) и маршрутов фронтенда (`App.jsx`) с именами тестов и e2e-спеков.

1. **Почта `/mail`** (`WEB-itinvent/frontend/src/App.jsx:135, 667-671`). Нет e2e-спека, маршрут не входит в `screens-smoke.spec.js`. Единственное UI-покрытие - unit `pages/Mail.test.jsx` (4084 строки, с двумя `it.skip`). Backend почты (143 py-файла) покрыт хорошо, сквозного сценария нет. **High.**
2. **Сканирование `/scan-center`** (`screens-smoke.spec.js:49`, только smoke-заголовок). Агентские сценарии (`scan_now`, force-scan) только в unit `pages/ScanCenter.test.jsx` (991 строка). **High.**
3. **Docflow `/docflow`** (`screens-smoke.spec.js:43`, только smoke). 1C-хранилище файлов (`docflow_1c_client`) и выдача файлов покрыты в py (10 файлов), сквозного UI-сценария нет. **High.**
4. **Сети `/networks`** (`screens-smoke.spec.js:50`, только smoke). Сетевые инструменты (DNS, SSL, WOL, ping) проверяются только unit-тестами. **Medium.**
5. **Голос `/voice`** (`screens-smoke.spec.js:52`, только smoke). Конвейер `voice_video` покрыт 15+ py-файлами, UI-сценария совещаний нет. **Medium.**
6. **AD-пользователи** `WEB-itinvent/backend/api/v1/ad_users.py:31` (`/password-status`) и соседние маршруты (9 шт.) - 0 e2e; py-покрытие есть (26 файлов), но это в основном unit. **High** (затрагивает статус паролей и доступ).
7. **Приём логов клиента** `WEB-itinvent/backend/api/v1/debug_client_log.py:37` (`POST /client-log`) - 0 тестов. Вход без авторизации и с пользовательскими данными, риск PII/секретов в логах не проверяется. **High.**
8. **Идентификация рабочей области** `WEB-itinvent/backend/api/v1/discovery.py:33` (`GET /identify-workspace`) - 0 тестов. **Medium.**
9. **Матрица доступа групп и структура компании**: `WEB-itinvent/backend/api/v1/groups_access.py:22` (7 маршрутов, 2 py-файла, 0 e2e) и `company_structure.py:41` (17 маршрутов, 3 py-файла, 0 e2e). Permission matrix по AGENTS.md - критичный случай, где нужен E2E. **Medium-High.**
10. **Квоты почтовых ящиков и работы строительства**: `WEB-itinvent/backend/api/v1/mailbox_quota.py:62` (2 py-файла, 0 e2e) и `construction_work.py:50` (`PUT work-plan`, 3 py-файла, 0 e2e). **Medium.**

---

## Что проверено и в порядке (для контекста)

- `tests/conftest.py:23-45`: изоляция БД через sqlite и `.pytest_runtime`, `PYTEST_USE_LIVE_APP_DATABASE` для явного выхода.
- `WEB-itinvent/frontend/e2e/stack/local_backend.py`: состояние в `.state*`, принудительный `rmtree`, защита имени каталога.
- Vitest исключает `e2e/**` (`vite.config.js:108`).
- Большинство write-спеков защищены через `test.skip(!CAN_WRITE)` с `E2E_LOCAL`/`E2E_SEND`.
- Redis-тесты используют фейки.

## Не проверено (ограничения)

- Тесты не запускались (по правилам). Длительность и флаки оценены статически.
- Python AST-сканер не запустился (интерпретатор недоступен), эвристики взяты из Node-сканера и `grep`; возможны ложные срабатывания по no-assert (исключены вручную: `pytest.fail` в sentinel-лямбдах и `try/except/else` с `raise AssertionError` считаются проверками).
- Факт DDL на реальном сервере (B2) зависит от конфигурации машины: проверялись только имена переменных в `.env` (значения не читались и не выводились), сам сервер и его БД не проверялись.
- Серверный статус тестовых БД (`hubit_chat_retention_test_*`) не проверялся.
