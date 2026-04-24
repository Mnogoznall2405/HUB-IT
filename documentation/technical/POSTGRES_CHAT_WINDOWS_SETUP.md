# PostgreSQL Chat Runbook

Этот runbook описывает подготовку встроенного корпоративного чата `WEB-itinvent` v1 на отдельном PostgreSQL, без миграции существующих SQLite-контуров `hub/mail/local runtime`.

## Что уже разделено

- `hub`, уведомления, задачи, mail-runtime и локальные настройки остаются на SQLite.
- новый chat-домен вынесен в отдельный backend-модуль `backend/chat/*`
- backend chat использует отдельный `CHAT_DATABASE_URL`
- frontend chat скрыт за `VITE_CHAT_ENABLED`

## Рекомендуемая схема

- PostgreSQL ставится отдельным Windows service на тот же сервер, где крутятся IIS/PM2/backend
- для чата используется отдельная БД, например `hubit_chat`
- для приложения используется отдельный DB-user, не `postgres`

## Минимальные переменные окружения

```env
CHAT_MODULE_ENABLED=1
CHAT_DATABASE_URL=postgresql+psycopg://hubit_chat_app:strong_password@127.0.0.1:5432/hubit_chat
CHAT_DB_POOL_SIZE=5
CHAT_DB_MAX_OVERFLOW=10
CHAT_CONVERSATION_PAGE_SIZE=50
CHAT_MESSAGE_PAGE_SIZE=100

VITE_CHAT_ENABLED=1
```

## Быстрая установка PostgreSQL на Windows

1. Скачать PostgreSQL 16+ с официального дистрибутива для Windows.
2. Установить как отдельный Windows service.
3. Зафиксировать:
   - версию PostgreSQL
   - каталог данных
   - пароль суперпользователя
   - имя Windows service
4. Создать отдельную БД и отдельного пользователя приложения:

```sql
CREATE ROLE hubit_chat_app WITH LOGIN PASSWORD 'strong_password';
CREATE DATABASE hubit_chat OWNER hubit_chat_app;
GRANT ALL PRIVILEGES ON DATABASE hubit_chat TO hubit_chat_app;
```

## Сетевые рекомендации

- не открывать PostgreSQL наружу без необходимости
- для текущего контура достаточно `127.0.0.1` или приватного интерфейса backend-хоста
- firewall открывать только для backend, если PostgreSQL вынесен на другой сервер

## Как включать модуль

1. Прописать `CHAT_*` переменные в корневой `.env`
2. Установить backend-зависимости:

```powershell
cd C:\Project\Image_scan\WEB-itinvent\backend
pip install -r requirements.txt
```

3. Пересобрать frontend с `VITE_CHAT_ENABLED=1`

```powershell
cd C:\Project\Image_scan\WEB-itinvent\frontend
npm run build
```

4. Перезапустить backend и frontend publication

## Что делает backend при старте

- если `CHAT_MODULE_ENABLED=0`, chat-router не подключается
- если `CHAT_MODULE_ENABLED=1`, backend пытается:
  - инициализировать SQLAlchemy engine
  - создать таблицы chat-домена
  - проверить доступность БД

Это позволяет поднять v1 без отдельной миграции всего проекта с SQLite.

## Таблицы chat v1

- `chat_conversations`
- `chat_members`
- `chat_messages`
- `chat_message_reads`
- `chat_conversation_user_state`

## Что входит в v1

- личные диалоги `1:1`
- групповые чаты
- список чатов
- список сообщений
- отправка текстовых сообщений
- unread counters
- mark-read
- поиск пользователей из текущих web-users

## Что не входит в v1

- звонки
- вложения
- reactions
- threads
- websocket/SSE realtime
- отдельный мобильный/Desktop client

## Проверка после запуска

1. Открыть `GET /api/v1/chat/health`
2. Убедиться, что:
   - `enabled=true`
   - `configured=true`
   - `available=true`
3. Открыть `WEB-itinvent`
4. Проверить, что в боковом меню появился `Chat`
5. Создать личный чат и отправить тестовое сообщение

## Резервное копирование

Базовый nightly backup:

```powershell
pg_dump -h 127.0.0.1 -U hubit_chat_app -d hubit_chat -Fc -f C:\Backups\hubit_chat_%DATE%.dump
```

Восстановление:

```powershell
pg_restore -h 127.0.0.1 -U hubit_chat_app -d hubit_chat --clean --if-exists C:\Backups\hubit_chat.dump
```

## Операционный смысл

- основной `WEB-itinvent` не обязан мигрировать с SQLite прямо сейчас
- chat растёт отдельно на PostgreSQL
- если chat-модуль выключен, остальная система продолжает работать как раньше
