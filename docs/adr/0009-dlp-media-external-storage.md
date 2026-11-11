# ADR 0009: DLP probe media — payload на диске, метаданные в БД

## Контекст

`app.browser_probe_media` (~8.5 ГБ bytea за ~21k строк), `telegram_probe_media` (~2.3 ГБ),
`max_probe_media` (~1 ГБ) растут ~4 ГБ/сутки без retention. `bytea` раздувает таблицы/TOAST,
бэкапы и стоимость `count(*)`/seq-scan операций; гигантские base64-payload'ы в инжесте
усиливают давление на пул соединений.

## Решение

- Новые payload'ы пишутся content-addressed файлами
  `<DLP_MEDIA_STORAGE_DIR>/<table>/<sha256[0:2]>/<sha256>.<ext>`; в БД — `storage_path`,
  `content=NULL`. Пустой `DLP_MEDIA_STORAGE_DIR` = прежний bytea-режим (обратная совместимость).
- Чтение прозрачное: `content IS NULL` → файл по `storage_path` (path-traversal guard, только
  внутри корня). Двоичный контракт `get_*_media` не меняется — фронтенд/UI не затронуты.
- Retention-воркер (`itinvent-dlp-media-retention-worker`) удаляет строки батчами и после
  коммита best-effort чистит файлы; осиротевшие файлы допустимы и безвредны.
- `storage_path` — nullable колонка (Alembic `20261110_0164`); идемпотентный
  `ADD COLUMN IF NOT EXISTS` продублирован в postgres startup-maintenance для самолечения
  при пропущенной миграции.
- Агент: `browser_probe` пишет JPEG q75 с downscale до 1600px (`ITINV_BROWSER_PROBE_SHOT_*`),
  sync шлёт корректный `content_type` по расширению; PNG остаётся поддерживаемым форматом.

## Последствия

- Размер БД перестаёт расти пропорционально медиа; инжест-нагрузка на пул не меняется
  (запись файла до сессии, один батч-сессия на набор).
- Миграция существующих ~12 ГБ bytea → файлы — отдельная операция (батчевый backfill с
  dry-run); до неё старые строки остаются bytea и обслуживаются тем же чтением/retention.
- Агенты без обновления продолжают слать PNG — сервер принимает любой формат.
