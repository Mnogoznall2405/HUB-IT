# Техническая документация HUB-IT

Этот файл — индекс технических документов. Детали реализации и операционные процедуры хранятся в профильных документах ниже.

## Быстрый индекс

### Архитектура и runtime

- [HUB Desktop release runbook](./HUB_DESKTOP_RELEASE_RUNBOOK.md), [матрица совместимости](./HUB_DESKTOP_COMPATIBILITY_MATRIX.md) и [ротация ключа update manifest](./HUB_DESKTOP_UPDATE_KEY_ROTATION.md)
- [PostgreSQL app/chat schema](./POSTGRES_APP_SCHEMA.md) и [DDL snapshot](./POSTGRES_APP_SCHEMA_DDL.md)
- [Chat backend architecture](./CHAT_BACKEND_ARCHITECTURE.md)
- [Support chat architecture](./SUPPORT_CHAT_ARCHITECTURE.md)
- [Chat performance и observability](./CHAT_PERF_OBSERVABILITY.md)
- [Native Chat gap roadmap](./MOBILE_HUB_NATIVE_CHAT_GAP_ROADMAP.md) — web ↔ native ↔ жесты/папки Telegram
- [Scan architecture](./SCAN_ARCHITECTURE.md) и [Scan PostgreSQL migration](./SCAN_POSTGRES_MIGRATION.md)
- [IIS deployment](./IIS_DEPLOYMENT_WEB.md)
- [Request metrics](./REQUEST_METRICS.md)

### Безопасность и интеграции

- [Auth / 2FA / passkeys](./AUTH_SECURITY_STACK.md)
- [HUB Desktop: постоянный Windows-вход](./WINDOWS_SSO_FUTURE.md) и [threat model](./WINDOWS_SSO_THREAT_MODEL.md)
- [1С integration](./ONE_C_INTEGRATION.md) и [1С document flow](./DOCFLOW_1C_INTEGRATION.md)
- [Mobile-hub checklist](./MOBILE_HUB_CHECKLIST.md)
- [My Files security review](./MY_FILES_SECURITY_REVIEW.md)

### Нагрузочные проверки и эксплуатация

- [Chat load test](./HUB_CHAT_LOAD_TEST.md)
- [Mail load test](./MAIL_LOAD_TEST.md)
- [Scan GPO deployment](./SCAN_GPO_DEPLOYMENT.md)
- [Windows Chat PostgreSQL setup](./POSTGRES_CHAT_WINDOWS_SETUP.md)

## Telegram-бот: актуальные подсистемы

- поиск оборудования
- поиск по сотруднику
- перемещение оборудования с актами
- управление базами данных
- экспорт данных
- регистрация работ:
  - замена батареи ИБП
  - замена компонентов ПК
  - чистка ПК

## Telegram-бот: текущее состояние

Бот больше не содержит пользовательского runtime-потока для замены комплектующих МФУ и не регистрирует соответствующий экспорт. Исторические JSON-файлы этого сценария сохранены только как архив.

## Telegram-бот: основные модули

- `bot/main.py` — регистрация handler-ов
- `bot/config.py` — конфигурация и состояния
- `bot/handlers/` — Telegram-сценарии
- `bot/services/` — бизнес-логика
- `bot/utils/` — вспомогательные функции

## Telegram-бот: хранилища данных

- [POSTGRES_APP_SCHEMA.md](./POSTGRES_APP_SCHEMA.md) — обзор схем `app` / `chat` / `system`
- [POSTGRES_APP_SCHEMA_DDL.md](./POSTGRES_APP_SCHEMA_DDL.md) — колонки, PK/FK, индексы (live introspection)
- `data/equipment_transfers.json`
- `data/battery_replacements.json`
- `data/pc_cleanings.json`
- `data/component_replacements.json`
- `data/cartridge_replacements.json` — архив, не используется в UI
