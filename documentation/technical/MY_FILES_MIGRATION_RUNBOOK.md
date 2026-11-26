# My Files — применение миграций 0178/0179 на production PostgreSQL + план отката

Дата: 2026-11-25. Миграции влиты в main merge-коммитом `a59bedbc` (PR #68). **Применение — только по отдельному разрешению, до перезапуска процессов с новым кодом.**

Общая конвенция: [scripts/pm2/README.md — миграции БД при релизе](../../scripts/pm2/README.md). Alembic не читает URL из `.env` — передавать явно. Production-процессы миграции не применяют (`initialize_app_schema` только сверяет версии).

## Что делают миграции

| Ревизия | Содержимое | Тяжесть |
|---|---|---|
| `20261124_0178` | Два covering-индекса на `app.my_files`: `ix_app_my_files_owner_live_folder (owner_user_id, deleted_at, folder_id, created_at)`, `ix_app_my_files_owner_quota_cover (owner_user_id, deleted_at, status, expires_at, original_size_bytes)` | `CREATE INDEX CONCURRENTLY` в autocommit-блоке, `lock_timeout=5s` — не блокирует записи; на большой таблице занимает минуты |
| `20261124_0179` | Колонка `updated_at` на `my_file_library_members`, `my_file_collaborators`, `my_file_folder_collaborators`: `ADD COLUMN` nullable → backfill `= created_at` → `SET NOT NULL` | `ADD COLUMN` metadata-only; backfill — UPDATE по всем строкам grant-таблиц (малые); `SET NOT NULL` — scan. Краткий ACCESS EXCLUSIVE на малых таблицах |

Обе идемпотентны: существующий валидный индекс/колонка пропускаются; индекс с неожиданными колонками или INVALID — ошибка с явным сообщением. Scope `chat` пропускается (это app-миграции).

## Предусловия (read-only)

1. Текущая ревизия БД должна быть `20261124_0177` (или содержать её в цепочке):
   ```sql
   SELECT version_num FROM system.alembic_version;
   ```
   После consolidation merge со Sticker V2 head кода: `python -m alembic -c backend/alembic.ini heads` → единственный `20261125_0182` (My Files 0178/0179 идут перед sticker chain 0180–0182).
2. Объём и активность `app.my_files`:
   ```sql
   SELECT pg_size_pretty(pg_total_relation_size('app.my_files'));
   SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query NOT ILIKE '%pg_stat_activity%';
   SELECT * FROM pg_locks WHERE NOT granted;
   ```
3. Нет INVALID-индексов с именами миграции (остатки прошлых обрывов):
   ```sql
   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_index i ON i.indexrelid = c.oid
   WHERE n.nspname = 'app' AND c.relname IN ('ix_app_my_files_owner_live_folder','ix_app_my_files_owner_quota_cover')
     AND NOT (i.indisvalid AND i.indisready);
   ```
   Если найдены — сначала `DROP INDEX CONCURRENTLY IF EXISTS app.<имя>;`
4. Свободное место: два covering-индекса ≈ 30–60 % размера таблицы `my_files` (колонки узкие, часть строк мёртвые исключается частично).
5. Бэкап/снапшот БД по штатной процедуре перед релизом.

## Применение

```powershell
cd WEB-itinvent
$env:SKIP_PG_SCHEMA_DOCS='1'
$env:ALEMBIC_DATABASE_URL = '<url production БД — явно, не из .env>'
python -m alembic -c backend/alembic.ini upgrade head
```

Ожидаемое время: 0178 — от секунд до минут (зависит от размера `my_files`, CONCURRENTLY не блокирует читателей/писателей); 0179 — секунды (grant-таблицы малы).

Если 0178 падает по `lock_timeout` (5s) — индекс ждёт начала построения за активной транзакцией: повторить в менее нагруженное время; сама миграция транзакционно чиста, обрыв до CREATE INDEX не оставляет следов.

## Проверка после применения

```sql
SELECT version_num FROM system.alembic_version;  -- 20261125_0182 после полного upgrade head
-- (0179 — ожидаемое промежуточное состояние сразу после My Files миграций)

SELECT c.relname, i.indisvalid, i.indisready
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_index i ON i.indexrelid = c.oid
WHERE n.nspname = 'app' AND c.relname IN ('ix_app_my_files_owner_live_folder','ix_app_my_files_owner_quota_cover');
-- оба: t, t

SELECT table_name FROM information_schema.columns
WHERE table_schema = 'app' AND column_name = 'updated_at'
  AND table_name IN ('my_file_library_members','my_file_collaborators','my_file_folder_collaborators');
-- 3 строки
```

```sql
ANALYZE app.my_files;
```

Затем — штатный перезапуск процессов с новым кодом; в логах не должно быть `schema_migration_check`. Smoke: открытие папки «Мои файлы», повторное открытие (304/быстрый ответ), счётчики файлов в подпапках, квота в UI.

## План отката

Откат схемы — только вместе с откатом кода на ревизию до PR #68 (код после 0179 пишет `updated_at`; без колонки он упадёт). **В consolidated release важно:** sticker chain 0180–0182 линейно стоит поверх My Files 0178/0179, поэтому `downgrade` до 0178/0177 сначала снимет и sticker-миграции (additive sticker tables/columns). Такой откат допустим только как откат всего consolidated release; точечный откат только My Files с сохранением sticker chain этой линейной цепочкой не поддерживается.

1. Откатить код (штатный откат релиза), остановить процессы с новым кодом.
2. Убедиться в валидности индексов перед downgrade (INVALID-индекс сломает drop):
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS app.ix_app_my_files_owner_live_folder;
   DROP INDEX CONCURRENTLY IF EXISTS app.ix_app_my_files_owner_quota_cover;
   ```
   (это уже и есть удаление индексов 0178 — после него downgrade 0178 станет no-op).
3. Явный downgrade, строго в порядке «сначала 0179»:
   ```powershell
   python -m alembic -c backend/alembic.ini downgrade 20261124_0178  # снимает 0179: DROP COLUMN updated_at ×3
   python -m alembic -c backend/alembic.ini downgrade 20261124_0177  # снимает 0178: DROP INDEX ×2
   ```
4. Проверка: `SELECT version_num FROM system.alembic_version;` → `20261124_0177`; индексы отсутствуют; колонок `updated_at` нет.

Потери данных при откате: только значения `updated_at` grant-таблиц (backfill был `= created_at`; реальные отметки правок ролей за время жизни релиза — не критичны, т.к. используются для ETag-инвалидации, а не для бизнес-логики). Пользовательские файлы, папки и права не затрагиваются ни upgrade, ни downgrade.

Частичный откат (только 0179, оставить индексы) — безопасен и дешевле: индексы не используются кодом явно, их наличие безопасно для старого кода.
